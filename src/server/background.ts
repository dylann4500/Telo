import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { config } from "./config";
import { db, ensureDb } from "./db/client";
import { appState, calls, tasks, webhookReceipts } from "./db/schema";
import { ACTIONABLE } from "./domain/state-machine";
import { syncPendingEvents } from "./memory/events";
import { notify } from "./notify";
import { isTaskBusy, kick, wakeTask } from "./orchestrator";
import { statusDigest } from "./status";
import { getUser, openQuestion, patchTask } from "./tasks/repo";
import { clampToCallingHours, formatWhen, withinCallingHours } from "./time";
import { getVoice } from "./voice";
import { normalizeDialEvent } from "./voice/dial-webhook";
import { inboundPrompt } from "./voice/inbound-prompt";
import { finishCall, ingestVoiceEvent } from "./voice/ingest";

// One in-process loop that makes the system self-healing and keeps time:
// wakes tasks scheduled for later (callbacks, delayed retries), retries task
// steps that errored, finishes calls whose webhooks never arrived, retries
// failed webhook processing, mirrors events to memory, nudges the user about
// unanswered questions, and keeps the voice line's prompt current.

const g = globalThis as unknown as { __teloLoop?: ReturnType<typeof setInterval>; __teloTicking?: boolean; __teloTicks?: number };

export function startBackgroundLoop() {
  if (g.__teloLoop) return;
  g.__teloLoop = setInterval(() => {
    if (g.__teloTicking) return;
    g.__teloTicking = true;
    tick()
      .catch((err) => console.error("[background] tick failed", err))
      .finally(() => (g.__teloTicking = false));
  }, 4000);
  console.info("[background] loop started");
}

async function tick() {
  await ensureDb();
  await syncPendingEvents(50);
  await wakeScheduledTasks();
  await resumeStalledTasks();
  await reconcileCalls();
  await retryWebhooks();
  await refreshVoiceLine();
  g.__teloTicks = (g.__teloTicks ?? 0) + 1;
  if (g.__teloTicks % 15 === 1) await remindWaitingUsers(); // about once a minute
}

/** Scheduled tasks whose time has come. */
export async function wakeScheduledTasks() {
  const due = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.status, "scheduled"), or(isNull(tasks.wakeAt), lte(tasks.wakeAt, new Date()))));
  for (const t of due) {
    if (isTaskBusy(t.id)) continue;
    const tz = (await getUser(t.userId))?.timezone ?? config.user.timezone;
    // Missed while the server was off, and now it's night: wait for the morning.
    const missed = t.wakeAt && Date.now() - t.wakeAt.getTime() > 15 * 60_000;
    if (missed && !withinCallingHours(new Date(), tz)) {
      const at = clampToCallingHours(new Date(), tz);
      await patchTask(t.id, { wakeAt: at, statusDetail: `Waiting until ${formatWhen(at, tz, { absolute: true })} to call` }, ["scheduled"]);
      continue;
    }
    await wakeTask(t.id);
  }
}

/** One nudge for a question the user hasn't answered in a while (recent tasks, waking hours only). */
async function remindWaitingUsers() {
  const hours = config.calls.remindAfterHours;
  if (!(hours > 0)) return;
  const waiting = await db
    .select()
    .from(tasks)
    .where(
      and(
        inArray(tasks.status, ["needs_info", "needs_approval"]),
        lt(tasks.updatedAt, new Date(Date.now() - hours * 3600_000)),
        gte(tasks.updatedAt, new Date(Date.now() - 48 * 3600_000)),
      ),
    );
  for (const t of waiting) {
    const user = await getUser(t.userId);
    const q = await openQuestion(t.id);
    if (!user || !q || !withinCallingHours(new Date(), user.timezone)) continue;
    await notify({
      userId: t.userId,
      taskId: t.id,
      kind: q.kind === "approval" ? "approval" : "question",
      body: `Still need you on "${t.title}": ${q.prompt}`,
      dedupeKey: `remind:${q.id}`,
    });
  }
}

/** A step that threw is retried with backoff; a task stranded by a restart picks up where it was. */
async function resumeStalledTasks() {
  const rows = await db.select().from(tasks).where(inArray(tasks.status, [...ACTIONABLE]));
  for (const t of rows) {
    if (isTaskBusy(t.id)) continue;
    const waitMs = t.stepFailures ? 5000 * 2 ** t.stepFailures : 15_000;
    if (Date.now() - t.updatedAt.getTime() > waitMs) kick(t.id);
  }
}

async function reconcileCalls() {
  const voice = getVoice();
  const staleMs = config.calls.staleAfterMinutes * 60_000;
  // Live calls we haven't heard about in a while: ask the provider directly.
  const live = await db
    .select()
    .from(calls)
    .where(and(inArray(calls.status, ["queued", "ringing", "in_progress"]), isNotNull(calls.providerCallId), isNull(calls.finishedAt)));
  for (const c of live) {
    const age = Date.now() - (c.startedAt ?? c.createdAt).getTime();
    if (age < (voice.name === "mock" ? 5 * 60_000 : 90_000)) continue;
    try {
      const snap = await voice.getCall(c.providerCallId!);
      if (["ended", "failed", "canceled"].includes(snap.status)) {
        await ingestVoiceEvent({
          kind: "call.ended",
          providerCallId: c.providerCallId!,
          direction: snap.direction,
          from: snap.from,
          to: snap.to,
          endReason: snap.endReason,
          durationSec: snap.durationSec,
          transcriptAvailable: Boolean(snap.transcript?.length),
          at: new Date(),
        });
        if (snap.transcript?.length) await ingestVoiceEvent({ kind: "call.transcribed", providerCallId: c.providerCallId! });
      } else if (age > staleMs) {
        await voice.stopCall(c.providerCallId!).catch(() => {});
      }
    } catch (err) {
      // The mock forgets calls on restart; Dial may 404 a bad id. Close it out.
      if (age > staleMs || voice.name === "mock") {
        await db.update(calls).set({ status: "failed", endReason: "lost", statusDetail: "Lost track of the call", endedAt: new Date() }).where(eq(calls.id, c.id));
        await finishCall(c.id);
      }
      console.warn("[background] reconcile failed for", c.id, (err as Error).message);
    }
  }
  // Ended calls whose transcript never arrived: fetch it, or give up after 3 minutes.
  const waiting = await db
    .select()
    .from(calls)
    .where(and(inArray(calls.status, ["ended", "failed", "canceled"]), isNull(calls.finishedAt), lt(calls.endedAt, new Date(Date.now() - 45_000))));
  for (const c of waiting) {
    if (c.providerCallId) {
      const snap = await voice.getCall(c.providerCallId).catch(() => null);
      if (snap?.transcript?.length) {
        await ingestVoiceEvent({ kind: "call.transcribed", providerCallId: c.providerCallId });
        continue;
      }
    }
    if (Date.now() - (c.endedAt?.getTime() ?? 0) > 180_000) await finishCall(c.id);
  }
}

async function retryWebhooks() {
  const failed = await db
    .select()
    .from(webhookReceipts)
    .where(and(or(eq(webhookReceipts.status, "failed"), eq(webhookReceipts.status, "received")), lt(webhookReceipts.attempts, 5), lt(webhookReceipts.receivedAt, new Date(Date.now() - 20_000))))
    .limit(10);
  for (const r of failed) await processWebhookReceipt(r.id);
}

/** Applies one stored Dial webhook. Safe to run more than once. */
export async function processWebhookReceipt(id: string) {
  const receipt = await db.query.webhookReceipts.findFirst({ where: eq(webhookReceipts.id, id) });
  if (!receipt || receipt.status === "processed") return;
  try {
    for (const event of normalizeDialEvent(receipt.payload as never)) await ingestVoiceEvent(event);
    await db.update(webhookReceipts).set({ status: "processed", processedAt: new Date(), error: null }).where(eq(webhookReceipts.id, id));
  } catch (err) {
    console.error("[webhook] processing failed", id, err);
    await db
      .update(webhookReceipts)
      .set({ status: "failed", attempts: receipt.attempts + 1, error: (err as Error).message.slice(0, 500) })
      .where(eq(webhookReceipts.id, id));
  }
}

/** Keeps Dial's inbound prompt current so a caller hears live status even without a tool call. */
async function refreshVoiceLine() {
  if (getVoice().name !== "dial" || !config.voice.dialNumberId) return;
  const digest = config.voice.statusInInboundPrompt ? await statusDigest(config.user.id) : "";
  const prompt = inboundPrompt(digest);
  const key = "dial.inbound_prompt";
  const current = await db.query.appState.findFirst({ where: eq(appState.key, key) });
  if (current?.value === prompt) return;
  await getVoice().setInboundInstruction(prompt);
  await db.insert(appState).values({ key, value: prompt }).onConflictDoUpdate({ target: appState.key, set: { value: prompt } });
}
