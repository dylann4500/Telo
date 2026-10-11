import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "./db/client";
import { calls, messages, type UserRow } from "./db/schema";
import type { Channel } from "./domain/types";
import { newId } from "./ids";
import { recordEvent } from "./memory/events";
import { getTask, getUser } from "./tasks/repo";
import { withinCallingHours } from "./time";
import { getVoice } from "./voice";
import type { MessageChannel } from "./voice/provider";

// Telo's outbound voice to the user. Every message is stored (the dashboard
// thread shows all of them) and delivered on the right channel: a reply
// goes where the user asked; proactive updates go to the task's channel or
// the user's preferred one. With calls on (users.callUpdates, the dashboard's
// "Text + call"), anything that needs the user or reports a call also rings
// their phone. A dedupe key makes each milestone send once.

// report: news from a call that isn't the final result ("they asked me to call back Wednesday").
export type MessageKind = "ack" | "question" | "update" | "report" | "approval" | "result" | "failure" | "status" | "reply" | "email";

// Worth a phone call: Telo needs the user, or a call has news for them.
const CALL_WORTHY: readonly MessageKind[] = ["question", "approval", "result", "failure", "report"];

// While the user is on a live call with Telo (Dial's agent calling our MCP
// tools), messages are captured and spoken back instead of texted.
interface Capture {
  lines: string[];
  closed: boolean;
  party?: string; // a tenant or owner on a call Telo placed; otherwise the user
}
const captureStore = new AsyncLocalStorage<Capture>();

export function withVoiceCapture<T>(capture: Capture, fn: () => Promise<T>): Promise<T> {
  return captureStore.run(capture, fn);
}

/** The open capture for a tenant or owner on a call with Telo, if that's who a message is for. */
export function partyCapture(partyId: string): Capture | null {
  const c = captureStore.getStore();
  return c && !c.closed && c.party === partyId ? c : null;
}

async function channelFor(user: UserRow, taskId: string | null | undefined): Promise<Channel> {
  const task = taskId ? await getTask(taskId) : undefined;
  if (task && (["sms", "imessage", "whatsapp", "web"] as Channel[]).includes(task.source)) return task.source;
  return user.channel;
}

const digitsOf = (p: string | null | undefined) => p?.replace(/\D/g, "").slice(-10) ?? "";

/** The user's phone is busy: they're on with Telo (calling in, or being called), or it's the phone playing the business in a solo test. */
async function lineBusy(user: UserRow): Promise<boolean> {
  const live = await db
    .select({ kind: calls.kind, targetPhone: calls.targetPhone })
    .from(calls)
    .where(and(eq(calls.userId, user.id), inArray(calls.status, ["queued", "ringing", "in_progress"]), gte(calls.createdAt, new Date(Date.now() - 30 * 60_000))));
  return live.some((c) => c.kind === "user_inbound" || c.kind === "user_update" || (user.phone && digitsOf(c.targetPhone) === digitsOf(user.phone)));
}

/** The user texted or called Telo recently, so a late-night call is about something they're waiting on. */
async function recentlyActive(userId: string, ms: number): Promise<boolean> {
  const since = new Date(Date.now() - ms);
  const texted = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.userId, userId), eq(messages.direction, "in"), gte(messages.createdAt, since)))
    .limit(1);
  if (texted.length) return true;
  const called = await db
    .select({ id: calls.id })
    .from(calls)
    .where(and(eq(calls.userId, userId), eq(calls.kind, "user_inbound"), gte(calls.createdAt, since)))
    .limit(1);
  return called.length > 0;
}

/** Whether Telo may ring the user now: waking hours, a business waiting on the line, or they're up talking to Telo. */
async function mayCall(user: UserRow, urgent: boolean): Promise<boolean> {
  if (!user.phone) return false;
  if (await lineBusy(user)) return false; // their line is busy; the text and the dashboard have it
  if (urgent || withinCallingHours(new Date(), user.timezone)) return true;
  return recentlyActive(user.id, 2 * 3600_000);
}

export async function notify(input: {
  userId: string;
  taskId?: string | null;
  body: string;
  kind: MessageKind;
  dedupeKey?: string;
  channel?: Channel; // force a channel (replies go back where the user wrote from)
  urgent?: boolean; // a business is waiting on the line: ring the user whatever the hour
  noCall?: boolean; // text only, even with calls on (reminders, the morning delivery of overnight finds)
}): Promise<void> {
  const body = input.body?.trim();
  if (!body) return;
  const user = await getUser(input.userId);
  if (!user) return;
  const capture = captureStore.getStore();
  // A tenant's or owner's call speaks only what's for them; the user's messages go out as usual.
  const live = capture && !capture.closed && !capture.party ? capture : null;
  // On the simulated line the dashboard thread is the only delivery.
  const channel: Channel = live ? "voice" : getVoice().name === "mock" ? "web" : (input.channel ?? (await channelFor(user, input.taskId)));

  const delivered = await deliver(user, input, body, channel, input.dedupeKey ?? null, live);
  if (!delivered) return; // this milestone was already sent

  // Calls on: a text alone is easy to miss, so ring them too.
  const text = channel === "sms" || channel === "imessage" || channel === "whatsapp";
  if (text && user.callUpdates && !input.noCall && CALL_WORTHY.includes(input.kind) && (await mayCall(user, Boolean(input.urgent)))) {
    await deliver(user, input, body, "voice", input.dedupeKey ? `${input.dedupeKey}:call` : null, null);
  }
}

/** Stores one outbound message and delivers it on `channel`. False if the dedupe key was already used. */
async function deliver(
  user: UserRow,
  input: { taskId?: string | null; kind: MessageKind; urgent?: boolean },
  body: string,
  channel: Channel,
  dedupeKey: string | null,
  live: Capture | null,
): Promise<boolean> {
  const id = newId("msg");
  const inserted = await db
    .insert(messages)
    .values({
      id,
      userId: user.id,
      taskId: input.taskId ?? null,
      direction: "out",
      channel,
      kind: input.kind,
      body,
      dedupeKey,
      // live-call: spoken by Dial's agent on a call the user is already on.
      provider: live ? "live-call" : channel === "web" ? null : getVoice().name,
      status: "queued",
    })
    .onConflictDoNothing()
    .returning();
  if (!inserted.length) return false;

  try {
    if (live) {
      live.lines.push(body);
    } else if (channel === "voice") {
      // Calling the user is reserved for things that need them, and the same checks apply on a voice-only setup.
      if (CALL_WORTHY.includes(input.kind) && (await mayCall(user, Boolean(input.urgent)))) {
        // While Telo is on a call with a tenant or owner (the "fixed?" call that just closed the job), the
        // manager's call waits for it to end, so the two never ring at once. A business holding doesn't wait.
        if (!input.urgent && (await partyCallLive())) void callUserAfterPartyCall(user, input.taskId ?? null, body, id);
        else await callUser(user, input.taskId ?? null, body);
      }
    } else if (channel !== "web") {
      if (!user.phone) throw new Error("No phone number on file (set TELO_USER_PHONE)");
      const res = await getVoice().sendMessage({ to: user.phone, body, channel: channel as MessageChannel });
      await db.update(messages).set({ providerMessageId: res.providerMessageId }).where(eq(messages.id, id));
    }
    await db.update(messages).set({ status: "sent" }).where(eq(messages.id, id));
    const task = input.taskId ? await getTask(input.taskId) : undefined;
    await recordEvent({
      userId: user.id,
      taskId: input.taskId ?? null,
      orgKey: task?.orgKey ?? null,
      type: "message.sent",
      summary: `${channel === "voice" && !live ? "Called you" : "Told you"}: ${body.length > 140 ? `${body.slice(0, 137)}...` : body}`,
      data: { channel, kind: input.kind },
      typed: { channel: channel === "web" ? "in_app" : channel },
    });
  } catch (err) {
    console.error("[notify] delivery failed", err);
    await db
      .update(messages)
      .set({ status: "failed", error: (err as Error).message.slice(0, 300) })
      .where(eq(messages.id, id));
  }
  return true;
}

/** Telo is on a call with a tenant or owner right now. */
async function partyCallLive(): Promise<boolean> {
  const live = await db
    .select({ id: calls.id })
    .from(calls)
    .where(and(eq(calls.kind, "party_update"), inArray(calls.status, ["queued", "ringing", "in_progress"]), gte(calls.createdAt, new Date(Date.now() - 10 * 60_000))))
    .limit(1);
  return live.length > 0;
}

async function callUserAfterPartyCall(user: UserRow, taskId: string | null, body: string, messageId: string) {
  for (let i = 0; i < 60 && (await partyCallLive()); i++) await new Promise((r) => setTimeout(r, getVoice().name === "mock" ? 100 : 2000));
  await callUser(user, taskId, body).catch(async (err) => {
    console.error("[notify] delivery failed", err);
    await db.update(messages).set({ status: "failed", error: (err as Error).message.slice(0, 300) }).where(eq(messages.id, messageId));
  });
}

/** Telo phones the user, says the update, and listens for an answer. */
async function callUser(user: UserRow, taskId: string | null, body: string) {
  if (!user.phone) throw new Error("No phone number on file (set TELO_USER_PHONE)");
  const first = user.name.split(" ")[0];
  const instructions = [
    `You are Telo, ${user.name}'s personal AI assistant, calling ${first} with a quick update about something you're handling for them.`,
    `Start with: "Hi ${first}, it's Telo." Then say this, naturally and briefly: "${body}"`,
    `If it contains a question, get a clear answer. Then call the ask_telo tool with exactly what ${first} said (say "One sec" first), and tell them what it returns. A business may be waiting on the other line for this answer, so do it right away.`,
    "If they ask for anything else, pass it to ask_telo the same way. If a tool fails, repeat their answer back and say you'll take care of it.",
    "Then say goodbye and end the call. If you reach voicemail, hang up without leaving a message.",
  ].join("\n\n");
  const id = newId("call");
  await db.insert(calls).values({
    id,
    userId: user.id,
    taskId,
    direction: "outbound",
    kind: "user_update",
    seq: -Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 1000), // keeps (task, seq, attempt) unique next to business calls
    targetName: user.name,
    targetPhone: user.phone,
    purpose: `Update for ${first}`,
    instructions,
    status: "queued",
    provider: getVoice().name,
    startedAt: new Date(),
  });
  try {
    const res = await getVoice().placeCall({ callId: id, to: user.phone, instructions, idempotencyKey: `telo:${id}` });
    await db.update(calls).set({ providerCallId: res.providerCallId }).where(eq(calls.id, id));
  } catch (err) {
    // Not left "queued": that would read as the user's line being busy for half an hour.
    await db.update(calls).set({ status: "failed", endReason: "failed_to_place", statusDetail: (err as Error).message.slice(0, 200), endedAt: new Date(), finishedAt: new Date() }).where(eq(calls.id, id));
    throw err;
  }
}
