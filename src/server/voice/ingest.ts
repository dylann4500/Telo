import { and, desc, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db/client";
import { calls, messages, type CallRow } from "../db/schema";
import { TERMINAL_STATUSES, type CallStatus } from "../domain/types";
import { newId, orgKeyFor } from "../ids";
import { recordEvent } from "../memory/events";
import { maskSecrets } from "../redact";
import { getCall, getCallByProviderId, getTask, getUserByPhone, listActiveTasks, listCalls, patchTask } from "../tasks/repo";
import { getVoice } from "./index";
import type { VoiceEvent } from "./provider";

// Applies provider-neutral voice events to Telo's state. Every handler is
// safe to run twice: statuses only move forward, and finishing a call is
// claimed with a compare-and-swap.

const ORDER: Record<CallStatus, number> = {
  planned: 0,
  queued: 1,
  ringing: 2,
  in_progress: 3,
  ended: 4,
  failed: 4,
  canceled: 4,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function ingestVoiceEvent(e: VoiceEvent): Promise<void> {
  switch (e.kind) {
    case "call.status":
      return onCallStatus(e);
    case "call.ended":
      return onCallEnded(e);
    case "call.transcribed":
      return onTranscribed(e.providerCallId);
    case "call.transcript_partial": {
      await db.update(calls).set({ transcript: e.turns }).where(eq(calls.providerCallId, e.providerCallId));
      return;
    }
    case "message.received": {
      const { handleInboundText } = await import("../concierge");
      await handleInboundText({ from: e.from, body: e.body, channel: e.channel, providerMessageId: e.providerMessageId });
      return;
    }
    case "message.status": {
      const failed = e.deliveryState === "failed" || e.deliveryState === "undelivered";
      if (!failed) {
        if (e.deliveryState === "delivered") await db.update(messages).set({ status: "delivered" }).where(eq(messages.providerMessageId, e.providerMessageId));
        return;
      }
      // A text that couldn't be delivered (e.g. carriers blocking an
      // unregistered number). With calls on, anything that needed the user
      // already rang their phone too; with texts only, it waits in the
      // dashboard thread marked "Not delivered".
      await db
        .update(messages)
        .set({ status: "failed", error: e.error ?? "undelivered" })
        .where(eq(messages.providerMessageId, e.providerMessageId));
      return;
    }
  }
}

const digitsOf = (phone: string | null | undefined) => phone?.replace(/\D/g, "").slice(-10) ?? "";

async function nextSeq(taskId: string): Promise<number> {
  return Math.max(0, ...(await listCalls(taskId)).map((c) => c.seq)) + 1;
}

/** A business returning Telo's call: the open task that most recently called this number. */
async function taskCalledFrom(from: string | null) {
  const digits = digitsOf(from);
  if (digits.length < 10) return null;
  const recent = await db
    .select()
    .from(calls)
    .where(and(eq(calls.kind, "business"), eq(calls.direction, "outbound"), isNotNull(calls.taskId), gte(calls.createdAt, new Date(Date.now() - 30 * 86_400_000))))
    .orderBy(desc(calls.createdAt))
    .limit(200);
  for (const c of recent) {
    if (digitsOf(c.targetPhone) !== digits) continue;
    const task = await getTask(c.taskId!);
    if (task && !TERMINAL_STATUSES.includes(task.status)) return { taskId: task.id, userId: task.userId, targetName: c.targetName, orgKey: c.orgKey, seq: await nextSeq(task.id) };
  }
  return null;
}

/** The call row for a provider call id. Inbound calls are created on first sight. */
async function resolveCall(e: Extract<VoiceEvent, { kind: "call.status" | "call.ended" }>): Promise<CallRow | undefined> {
  const existing = await getCallByProviderId(e.providerCallId);
  if (existing) return existing;
  if (e.direction === "inbound") {
    const user = e.from ? await getUserByPhone(e.from) : undefined;
    const callback = user ? null : await taskCalledFrom(e.from);
    await db
      .insert(calls)
      .values({
        id: newId("call"),
        userId: user?.id ?? callback?.userId ?? config.user.id,
        taskId: callback?.taskId ?? null,
        direction: "inbound",
        kind: user ? "user_inbound" : "business",
        seq: callback?.seq ?? 0,
        orgKey: callback?.orgKey ?? null,
        targetName: user ? user.name : callback?.targetName ?? e.from ?? "Unknown caller",
        targetPhone: e.from,
        purpose: user ? `${user.name} called Telo` : callback ? `${callback.targetName} called back` : "Inbound call",
        status: "in_progress",
        provider: getVoice().name,
        providerCallId: e.providerCallId,
        startedAt: new Date(),
        answeredAt: new Date(),
      })
      .onConflictDoNothing();
    return getCallByProviderId(e.providerCallId);
  }
  // An outbound status can beat our own write of the provider id; give it a moment.
  for (let i = 0; i < 4; i++) {
    await sleep(750);
    const row = await getCallByProviderId(e.providerCallId);
    if (row) return row;
  }
  throw new Error(`No call row for provider call ${e.providerCallId}`);
}

async function onCallStatus(e: Extract<VoiceEvent, { kind: "call.status" }>) {
  const call = await resolveCall(e);
  if (!call || ORDER[e.status] <= ORDER[call.status] || ORDER[e.status] >= 4) return; // ends are handled by call.ended
  await db
    .update(calls)
    .set({
      status: e.status,
      startedAt: call.startedAt ?? e.at,
      answeredAt: e.status === "in_progress" ? e.at : call.answeredAt,
      statusDetail: e.status === "ringing" ? "Ringing" : e.status === "in_progress" ? "Connected" : call.statusDetail,
    })
    .where(eq(calls.id, call.id));
  if (call.taskId && call.kind === "business") {
    const detail = e.status === "ringing" ? `Ringing ${call.targetName}` : e.status === "in_progress" ? `On the phone with ${call.targetName}` : null;
    if (detail) await patchTask(call.taskId, { statusDetail: detail }, ["calling"]);
    if (e.status === "in_progress") {
      await recordEvent({
        id: `evt_conn_${call.id}`,
        userId: call.userId,
        taskId: call.taskId,
        callId: call.id,
        orgKey: call.orgKey,
        type: "call.connected",
        summary: `Connected to ${call.targetName}`,
      });
    }
  }
}

async function onCallEnded(e: Extract<VoiceEvent, { kind: "call.ended" }>) {
  const call = await resolveCall(e);
  if (!call) return;
  const status: CallStatus = e.endReason === "completed" ? "ended" : e.endReason === "canceled" ? "canceled" : "failed";
  await db
    .update(calls)
    .set({
      status,
      endReason: e.endReason,
      durationSec: e.durationSec ?? call.durationSec,
      endedAt: call.endedAt ?? e.at,
      statusDetail: status === "ended" ? "Call ended" : e.endReason === "no-answer" ? "No answer" : e.endReason === "busy" ? "Busy" : "Call failed",
    })
    .where(eq(calls.id, call.id));
  // A call that never connected has no transcript coming: finish now. An
  // answered call waits for call.transcribed. Dial reports
  // transcriptAvailable=false at hang-up even when the transcript follows a
  // second later, so it can't be trusted here. The background loop finishes
  // the call anyway if the transcript never comes.
  const connected = Boolean(call.answeredAt) || (e.durationSec ?? 0) > 0;
  if (status !== "ended" || !connected) await finishCall(call.id);
}

async function onTranscribed(providerCallId: string) {
  const call = await getCallByProviderId(providerCallId);
  if (!call) throw new Error(`No call row for provider call ${providerCallId}`);
  const snap = await getVoice().getCall(providerCallId);
  await db
    .update(calls)
    .set({
      transcript: snap.transcript ?? call.transcript,
      durationSec: snap.durationSec ?? call.durationSec,
      status: ORDER[call.status] < 4 ? (snap.status === "in_progress" ? "ended" : snap.status) : call.status,
      endedAt: call.endedAt ?? new Date(),
    })
    .where(eq(calls.id, call.id));
  await finishCall(call.id);
}

const theySaid = (call: CallRow) => call.transcript.filter((t) => t.speaker === "other").map((t) => t.text).join(" ").trim();

/** A caller from an unknown number who names a business Telo is working with (a call center calling back from another line). */
async function linkByMention(call: CallRow): Promise<CallRow | null> {
  const said = theySaid(call).toLowerCase();
  if (!said) return null;
  const tasks = (await listActiveTasks(call.userId)).filter((t) => t.targets.some((x) => x.name.length >= 4 && said.includes(x.name.toLowerCase())));
  if (tasks.length !== 1) return null; // nobody, or ambiguous
  const task = tasks[0];
  const target = task.targets.find((x) => said.includes(x.name.toLowerCase()))!;
  const rows = await db
    .update(calls)
    .set({ taskId: task.id, seq: await nextSeq(task.id), targetName: target.name, orgKey: orgKeyFor(target.name), purpose: `${target.name} called back` })
    .where(and(eq(calls.id, call.id), isNull(calls.taskId)))
    .returning();
  return rows[0] ?? null;
}

/** What a caller said on Telo's line, passed on to the user. */
async function passOnMessage(call: CallRow) {
  const said = maskSecrets(theySaid(call));
  if (!said) return;
  const { notify } = await import("../notify");
  const who = call.taskId ? call.targetName : call.targetPhone ?? "Someone";
  await notify({
    userId: call.userId,
    taskId: call.taskId,
    kind: "report",
    body: `${who} called my line: "${said.length > 220 ? `${said.slice(0, 217)}...` : said}"`,
    dedupeKey: `inbound:${call.id}`,
  });
}

/** Hands a finished call to whoever owns it, exactly once (claimed via `finishedAt`). */
export async function finishCall(callId: string): Promise<void> {
  const claimed = await db
    .update(calls)
    .set({ finishedAt: new Date() })
    .where(and(eq(calls.id, callId), isNull(calls.finishedAt)))
    .returning();
  let call = claimed[0];
  if (!call) return;
  if (call.kind === "business" && call.direction === "inbound") {
    // A business returning Telo's call: wake the task that was waiting on it,
    // or at least tell the user what they said.
    if (!call.taskId) call = (await linkByMention(call)) ?? call;
    const { onBusinessCalledBack } = await import("../orchestrator");
    if (!call.taskId || !(await onBusinessCalledBack(call.taskId))) await passOnMessage(call);
  } else if (call.kind === "business" && call.taskId) {
    const { onBusinessCallFinished } = await import("../orchestrator");
    await onBusinessCallFinished(call.taskId);
  } else if (call.kind === "user_inbound" || call.kind === "user_update") {
    const { handleUserCallFinished } = await import("../concierge");
    await handleUserCallFinished(call.id);
  }
}

export { getCall };
