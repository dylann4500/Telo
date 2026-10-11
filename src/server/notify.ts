import { AsyncLocalStorage } from "node:async_hooks";
import { eq } from "drizzle-orm";
import { config } from "./config";
import { db } from "./db/client";
import { calls, messages, type UserRow } from "./db/schema";
import type { Channel } from "./domain/types";
import { newId } from "./ids";
import { recordEvent } from "./memory/events";
import { getTask, getUser } from "./tasks/repo";
import { getVoice } from "./voice";
import type { MessageChannel } from "./voice/provider";

// Telo's outbound voice to the user. Every message is stored (the dashboard
// thread shows all of them) and delivered on the right channel: a reply
// goes where the user asked; proactive updates go to the task's channel or
// the user's preferred one. A dedupe key makes each milestone send once.

export type MessageKind = "ack" | "question" | "update" | "approval" | "result" | "failure" | "status" | "reply";

// While the user is on a live call with Telo (Dial's agent calling our MCP
// tools), messages are captured and spoken back instead of texted.
interface Capture {
  lines: string[];
  closed: boolean;
}
const captureStore = new AsyncLocalStorage<Capture>();

export function withVoiceCapture<T>(capture: Capture, fn: () => Promise<T>): Promise<T> {
  return captureStore.run(capture, fn);
}

async function channelFor(user: UserRow, taskId: string | null | undefined): Promise<Channel> {
  if (config.voice.provider === "mock") return "web"; // the dashboard thread is the only delivery in mock mode
  const task = taskId ? await getTask(taskId) : undefined;
  if (task && (["sms", "imessage", "whatsapp", "web"] as Channel[]).includes(task.source)) return task.source;
  return user.channel;
}

export async function notify(input: {
  userId: string;
  taskId?: string | null;
  body: string;
  kind: MessageKind;
  dedupeKey?: string;
  channel?: Channel; // force a channel (replies go back where the user wrote from)
}): Promise<void> {
  const body = input.body?.trim();
  if (!body) return;
  const user = await getUser(input.userId);
  if (!user) return;
  const capture = captureStore.getStore();
  const live = capture && !capture.closed ? capture : null;
  const channel: Channel = live ? "voice" : config.voice.provider === "mock" ? "web" : (input.channel ?? (await channelFor(user, input.taskId)));

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
      dedupeKey: input.dedupeKey ?? null,
      provider: channel === "web" ? null : getVoice().name,
      status: "queued",
    })
    .onConflictDoNothing()
    .returning();
  if (!inserted.length) return; // this milestone was already sent

  try {
    if (live) {
      live.lines.push(body);
    } else if (channel === "voice") {
      // Calling the user is reserved for things that need them.
      if (["approval", "question", "result", "failure"].includes(input.kind)) await callUser(user, input.taskId ?? null, body);
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
      summary: `Told you: ${body.length > 140 ? `${body.slice(0, 137)}...` : body}`,
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
}

/** The voice channel: Telo phones the user, says the update, and listens for an answer. */
async function callUser(user: UserRow, taskId: string | null, body: string) {
  if (!user.phone) throw new Error("No phone number on file (set TELO_USER_PHONE)");
  const first = user.name.split(" ")[0];
  const instructions = [
    `You are Telo, ${user.name}'s personal AI assistant, calling ${first} with a quick update about something you're handling for them.`,
    `Start with: "Hi ${first}, it's Telo." Then say this, naturally and briefly: "${body}"`,
    "If it contains a question, get a clear answer and repeat it back to confirm.",
    "If they ask for anything else, say you'll take care of it and remember exactly what they asked.",
    "Then say goodbye and end the call. If you reach voicemail, hang up without leaving a message.",
  ].join("\n\n");
  const id = newId("call");
  await db.insert(calls).values({
    id,
    userId: user.id,
    taskId,
    direction: "outbound",
    kind: "user_update",
    seq: -Math.floor(Date.now() / 1000), // keeps (task, seq, attempt) unique next to business calls
    targetName: user.name,
    targetPhone: user.phone,
    purpose: `Update for ${first}`,
    instructions,
    status: "queued",
    provider: getVoice().name,
    startedAt: new Date(),
  });
  const res = await getVoice().placeCall({ callId: id, to: user.phone, instructions, idempotencyKey: `telo:${id}` });
  await db.update(calls).set({ providerCallId: res.providerCallId }).where(eq(calls.id, id));
}
