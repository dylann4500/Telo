import { and, eq, gte } from "drizzle-orm";
import * as agent from "./agent";
import type { RouteResult } from "./agent/schemas";
import { db } from "./db/client";
import { messages, organizations, questions, tasks, users, type UserRow } from "./db/schema";
import type { Channel, Fact } from "./domain/types";
import { newId, orgKeyFor } from "./ids";
import { recordEvent } from "./memory/events";
import { notify, withVoiceCapture } from "./notify";
import { advance, cancelTask, normalizePhone, phoneTarget, wakeTask } from "./orchestrator";
import { containsSecret, maskSecrets } from "./redact";
import { formatWhen, nowContext } from "./time";
import { answerStatus } from "./status";
import { getCall, getTask, getUser, getUserByPhone, listActiveTasks, listRecentTasks, openQuestion, recentMessages, transitionTask } from "./tasks/repo";

// Everything the user sends Telo (a text, a web chat message, a live voice
// call through Dial's agent, or the transcript of a call) comes through
// here. One model call routes it into actions on tasks; replies go back on
// the channel the user used.

const SECRET_REPLY =
  "Please don't send me passwords or PINs. I never need them and won't read them out on a call. If a business insists, I'll tell them you'll give it to them directly.";

function asChannel(raw: string): Channel {
  if (raw === "imessage" || raw === "whatsapp" || raw === "web" || raw === "voice") return raw;
  return "sms"; // sms, rcs, unknown
}

/** A text from Dial. */
export async function handleInboundText(input: { from: string; body: string; channel: string; providerMessageId: string }) {
  const user = await getUserByPhone(input.from);
  if (!user) {
    const { tryPair } = await import("./pairing");
    if (await tryPair(input.from, input.body)) {
      const owner = await getUserByPhone(input.from);
      if (owner) {
        await notify({
          userId: owner.id,
          kind: "reply",
          body: "You're linked. Text me anything that needs a phone call, or call this number.",
          channel: asChannel(input.channel),
        });
      }
      return;
    }
    console.warn("[concierge] ignoring a text from an unknown number");
    return;
  }
  await handleUserInput({ user, text: input.body, channel: asChannel(input.channel), providerMessageId: input.providerMessageId });
}

/** A message typed into the dashboard. */
export async function handleWebMessage(userId: string, text: string) {
  const user = await getUser(userId);
  if (user) await handleUserInput({ user, text, channel: "web" });
}

export async function handleUserInput(input: {
  user: UserRow;
  text: string;
  channel: Channel;
  providerMessageId?: string | null;
  via?: "message" | "call_transcript";
  alreadyHandled?: string[];
}): Promise<void> {
  const { user } = input;
  const via = input.via ?? "message";
  const secret = containsSecret(input.text);

  if (via === "message") {
    const stored = await db
      .insert(messages)
      .values({
        id: newId("msg"),
        userId: user.id,
        direction: "in",
        channel: input.channel,
        kind: "chat",
        body: maskSecrets(input.text),
        providerMessageId: input.providerMessageId ?? null,
        status: "received",
      })
      .onConflictDoNothing()
      .returning();
    if (!stored.length) return; // a redelivered webhook
  }
  if (secret) {
    await notify({ userId: user.id, kind: "reply", body: SECRET_REPLY, channel: input.channel });
    return;
  }

  const active = await listActiveTasks(user.id);
  const recentFailed = (await listRecentTasks(user.id, 5)).filter((t) => t.status === "failed");
  const openTasks = await Promise.all(
    [...active.slice(0, 8), ...recentFailed.slice(0, 2)].map(async (t) => {
      const q = await openQuestion(t.id);
      return {
        id: t.id,
        title: t.title,
        status: t.status,
        statusDetail: t.statusDetail,
        openQuestion: q
          ? { kind: q.kind, prompt: q.prompt, fields: q.fields.map((f) => ({ key: f.key, label: f.label })), options: q.options }
          : null,
      };
    }),
  );
  const recent = (await recentMessages(user.id, 10)).map((m) => ({ from: m.direction === "in" ? ("user" as const) : ("telo" as const), text: m.body }));
  const route = await agent.routeInbound({
    text: maskSecrets(input.text),
    via,
    now: nowContext(user.timezone),
    openTasks,
    recentConversation: recent,
    alreadyHandled: input.alreadyHandled,
  });
  if (route.containsSecret) {
    await notify({ userId: user.id, kind: "reply", body: SECRET_REPLY, channel: input.channel });
    return;
  }
  // Replies to a call transcript go out on the user's normal channel: they've hung up.
  const replyChannel: Channel | undefined = via === "call_transcript" ? undefined : input.channel;
  for (const action of route.actions) {
    await perform(user, action, route, input.text, input.channel, replyChannel, via === "call_transcript");
  }
  if (!route.actions.length && route.reply && via !== "call_transcript") {
    await notify({ userId: user.id, kind: "reply", body: route.reply, channel: replyChannel });
  }
}

type Action = RouteResult["actions"][number];

async function perform(user: UserRow, action: Action, route: RouteResult, text: string, source: Channel, replyChannel: Channel | undefined, afterCall = false) {
  const reply = (body: string, taskId?: string) => notify({ userId: user.id, taskId, kind: "reply", body, channel: replyChannel });
  // After a call, a "nothing to do" usually means it was handled live on the call: stay quiet.
  const nothingToDo = (body: string) => (afterCall ? Promise.resolve() : reply(body));
  const active = await listActiveTasks(user.id);
  const find = (status?: string) =>
    active.find((t) => t.id === action.taskId) ?? (status ? active.find((t) => t.status === status) : undefined);

  switch (action.type) {
    case "new_task": {
      const id = newId("tsk");
      const request = (action.request ?? text).trim();
      await db.insert(tasks).values({
        id,
        userId: user.id,
        title: request.length > 60 ? `${request.slice(0, 57)}...` : request,
        request,
        source,
        status: "new",
        statusDetail: "Reading your request",
      });
      await advance(id); // runs until Telo needs the user or is on the phone
      return;
    }
    case "provide_info": {
      const task = find("needs_info");
      if (!task || task.status !== "needs_info") {
        await nothingToDo("Thanks. I'm not waiting on anything from you right now.");
        return;
      }
      const q = await openQuestion(task.id);
      const fields = q?.fields ?? [];
      const incoming: Fact[] = action.answers
        .filter((a) => a.value?.trim())
        .map((a) => {
          // "phone_golden_crust", "phone_goldencrust"... → the target's exact key.
          const target = /^phone/i.test(a.key) ? phoneTarget(a.key, task) : null;
          const key = target ? `phone_${orgKeyFor(target)}` : a.key;
          const f = fields.find((x) => x.key === key);
          const label = f?.label ?? (target ? `${target}'s number` : key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()));
          return { key, label, value: a.value.trim(), sensitive: f?.sensitive ?? /account|member|birth|email|address|ssn|card/i.test(key), source: "user" as const };
        });
      // A number for one of the businesses updates the target and the directory.
      const targets = task.targets.map((t) => {
        const ans = incoming.find((f) => f.key === `phone_${orgKeyFor(t.name)}`);
        return ans ? { ...t, phone: normalizePhone(ans.value) } : t;
      });
      for (const t of targets) {
        if (t.phone) await db.update(organizations).set({ phone: t.phone }).where(eq(organizations.key, orgKeyFor(t.name)));
      }
      const facts = [...task.facts];
      for (const f of incoming.filter((x) => !x.key.startsWith("phone_"))) {
        const i = facts.findIndex((x) => x.key === f.key);
        if (i >= 0) facts[i] = f;
        else facts.push(f);
      }
      if (q) {
        await db
          .update(questions)
          .set({ status: "answered", answeredAt: new Date(), answer: { keys: incoming.map((f) => f.key) } })
          .where(eq(questions.id, q.id));
      }
      // Mid-task (a business asked for this), go back to calling: now, or at
      // the time the business gave. Before the first call, re-read the request.
      const who = task.followUp?.callback?.targetName;
      const later = task.followUp && task.wakeAt && task.wakeAt.getTime() > Date.now() + 60_000 ? task.wakeAt : null;
      const moved = await transitionTask(
        task.id,
        !task.followUp ? "new" : later ? "scheduled" : "planning",
        { facts, targets, statusDetail: later ? `Calling ${who ?? "them"} back ${formatWhen(later, user.timezone, { absolute: true })}` : "Got your answer" },
        ["needs_info"],
      );
      if (!moved) return;
      await recordEvent({
        userId: user.id,
        taskId: task.id,
        orgKey: task.orgKey,
        type: "task.info_received",
        summary: `You told me: ${incoming.map((f) => f.label).join(", ") || "more details"}`,
      });
      // Mid-task, the next thing the user would otherwise hear is the result, minutes later.
      if (who && later) await reply(`Thanks. I'll call ${who} back ${formatWhen(later, user.timezone)} with that.`, task.id);
      else if (who) await reply(incoming.some((f) => f.key.startsWith("phone_")) ? `Thanks. Calling ${who} at that number now.` : `Thanks. Calling ${who} back with that now.`, task.id);
      await advance(task.id);
      return;
    }
    case "decide": {
      const task = find("needs_approval");
      if (!task || task.status !== "needs_approval") {
        await nothingToDo("Nothing is waiting on a decision right now.");
        return;
      }
      await decideTask(user, task.id, action.decision?.optionId ?? null, action.decision?.approve ?? true, action.decision?.note ?? null);
      return;
    }
    case "status": {
      const body = await answerStatus(user, action.query ?? text, { needsHistory: action.needsHistory });
      await notify({ userId: user.id, taskId: action.taskId ?? undefined, kind: "status", body, channel: replyChannel });
      return;
    }
    case "cancel_task": {
      const task = find();
      if (!task) {
        await nothingToDo("I couldn't tell which task to stop. Which one?");
        return;
      }
      if (await cancelTask(task.id, "You asked me to stop.")) await reply(`Stopped "${task.title}".`, task.id);
      return;
    }
    case "retry_task": {
      // "Call them now" for a call Telo scheduled for later.
      const scheduled = active.find((t) => t.status === "scheduled" && (!action.taskId || t.id === action.taskId));
      if (scheduled) {
        const who = scheduled.followUp?.callback?.targetName ?? scheduled.targets[0]?.name ?? "them";
        if (await wakeTask(scheduled.id)) await reply(`Calling ${who} now.`, scheduled.id);
        return;
      }
      const failed = (await listRecentTasks(user.id, 5)).find((t) => t.id === action.taskId || t.status === "failed");
      if (!failed || failed.status !== "failed") {
        await nothingToDo("There's nothing to retry right now.");
        return;
      }
      const moved = await transitionTask(failed.id, "new", { stepFailures: 0, lastError: null, result: null, completedAt: null, statusDetail: "Trying again" }, ["failed"]);
      if (moved) {
        await reply(`Trying "${failed.title}" again.`, failed.id);
        await advance(failed.id);
      }
      return;
    }
    case "remember_preference": {
      const pref = action.preference?.trim();
      if (!pref) return;
      const prefs = [...new Set([...user.preferences, pref])].slice(-20);
      await db.update(users).set({ preferences: prefs }).where(eq(users.id, user.id));
      await recordEvent({ userId: user.id, type: "preference.saved", summary: `Preference saved: ${pref}` });
      await reply(`Noted: ${pref}.`);
      return;
    }
    case "set_updates": {
      const callUpdates = action.updates === "call";
      if (!action.updates) return;
      await setCallUpdates(user.id, callUpdates, "you asked");
      await reply(callUpdates ? "Got it. I'll text you, and call too when I need you or a call has news." : "Got it. I'll just text you from now on.");
      return;
    }
    case "chat": {
      // After a call it's goodbye or thanks on the line: nothing to text back.
      await nothingToDo(route.reply ?? "I'm here. Text me anything that needs a phone call and I'll handle it.");
      return;
    }
  }
}

/** The "Text me / Text + call me" choice, from the dashboard toggle or from asking Telo. */
export async function setCallUpdates(userId: string, callUpdates: boolean, via: "you asked" | "dashboard"): Promise<void> {
  await db.update(users).set({ callUpdates }).where(eq(users.id, userId));
  await recordEvent({ userId, type: "preference.saved", summary: `Updates: ${callUpdates ? "texts and calls" : "texts only"} (${via})` });
}

/** Applies the user's answer to an approval question (from a text, a call, or a dashboard tap). */
export async function decideTask(user: UserRow, taskId: string, optionId: string | null, approve: boolean, note: string | null): Promise<boolean> {
  const task = await getTask(taskId);
  if (!task || task.status !== "needs_approval") return false;
  const q = await openQuestion(task.id);
  const option = q?.options.find((o) => o.id === optionId);
  const decision = [option?.label ?? (approve ? "Yes" : "No"), note].filter(Boolean).join(". ");
  if (q) {
    await db
      .update(questions)
      .set({ status: "answered", answeredAt: new Date(), answer: { optionId: option?.id ?? null, approve, note } })
      .where(eq(questions.id, q.id));
  }
  // A call Telo offered after reading an email: yes starts it like any request.
  const context = (q?.context ?? {}) as { suggestion?: boolean; phone?: string | null };
  if (context.suggestion) {
    await recordEvent({
      userId: user.id,
      taskId: task.id,
      orgKey: task.orgKey,
      type: approve ? "approval.granted" : "approval.denied",
      summary: `You decided: ${decision}`,
      typed: { approvalKind: "email_followup" },
    });
    if (!approve || option?.id === "skip") {
      const stopped = await cancelTask(task.id, "You said not to call.");
      if (stopped) await notify({ userId: user.id, taskId: task.id, kind: "reply", body: "Okay, I won't call them." });
      return stopped;
    }
    // The number from the email was in the question the user just said yes to.
    const targets = context.phone ? task.targets.map((t, i) => (i === 0 ? { ...t, phone: context.phone! } : t)) : task.targets;
    const started = await transitionTask(task.id, "new", { targets, statusDetail: "Reading your request" }, ["needs_approval"]);
    if (started) await advance(task.id);
    return Boolean(started);
  }
  const offerQuestion = /offer|instead|\$\d/.test(q?.prompt ?? "");
  await recordEvent({
    userId: user.id,
    taskId: task.id,
    orgKey: task.orgKey,
    type: approve ? "approval.granted" : "approval.denied",
    summary: `You decided: ${decision}`,
    typed: { approvalKind: offerQuestion ? "accept_offer" : task.category === "quotes" ? "book" : "decision" },
  });
  if (offerQuestion) {
    const accepted = approve && !/keep|decline|\bno\b|cancel/i.test(option?.label ?? "");
    await recordEvent({
      userId: user.id,
      taskId: task.id,
      orgKey: task.orgKey,
      type: accepted ? "offer.accepted" : "offer.declined",
      summary: `${accepted ? "Accepted" : "Declined"} the offer`,
      typed: { offerKind: "retention_discount" },
    });
  }
  const moved = await transitionTask(
    task.id,
    "reviewing",
    { followUp: { reason: "user_decision", userDecision: decision, callback: null }, statusDetail: "Acting on your decision" },
    ["needs_approval"],
  );
  if (moved) await advance(task.id);
  return Boolean(moved);
}

const VOICEMAIL = /voice ?mail|mailbox|leave (me )?a message|after the (tone|beep)|at the tone|record your message|is not available|has not been set up|please try (your call )?again later|cannot be completed as dialed/i;

/** Carrier and voicemail greetings are short and formulaic. */
export function looksLikeVoicemail(text: string): boolean {
  return VOICEMAIL.test(text) && text.split(/\s+/).length < 60;
}

/** The user called Telo (or Telo called the user): act on what they said. */
export async function handleUserCallFinished(callId: string): Promise<void> {
  const call = await getCall(callId);
  if (!call) return;
  const user = await getUser(call.userId);
  if (!user || !call.transcript.length) return;
  const said = call.transcript.filter((t) => t.speaker === "other").map((t) => t.text);
  if (!said.length) return;
  if (looksLikeVoicemail(said.join(" "))) {
    // A carrier or voicemail greeting, not the user: note it and stop.
    await db.insert(messages).values({
      id: newId("msg"),
      userId: user.id,
      taskId: call.taskId,
      direction: "in",
      channel: "voice",
      kind: "call",
      body: "(missed: Telo's call went to voicemail)",
      status: "received",
    });
    return;
  }
  // Mirror the call into the conversation thread.
  await db.insert(messages).values({
    id: newId("msg"),
    userId: user.id,
    taskId: call.taskId,
    direction: "in",
    channel: "voice",
    kind: "call",
    body: `${call.kind === "user_update" ? "(Telo called you)" : "(you called Telo)"} ${said.join(" ")}`,
    status: "received",
  });
  // Tasks created through the live tools during this call must not be created twice.
  const since = call.startedAt ?? new Date(Date.now() - 30 * 60_000);
  const duringCall = await db
    .select({ title: tasks.title })
    .from(tasks)
    .where(and(eq(tasks.userId, user.id), eq(tasks.source, "voice"), gte(tasks.createdAt, since)));
  const answeredDuringCall = await db
    .select({ prompt: questions.prompt })
    .from(questions)
    .where(and(eq(questions.userId, user.id), eq(questions.status, "answered"), gte(questions.answeredAt, since)));
  // What Telo said on the call through its tools ("Calling Skyway now.") was already acted on.
  const toldDuringCall = await db
    .select({ body: messages.body })
    .from(messages)
    .where(and(eq(messages.userId, user.id), eq(messages.direction, "out"), eq(messages.channel, "voice"), gte(messages.createdAt, since)));
  const transcript = call.transcript
    .map((t) => `${t.speaker === "agent" ? "TELO" : user.name.split(" ")[0].toUpperCase()}: ${t.text}`)
    .join("\n");
  await handleUserInput({
    user,
    text: transcript,
    channel: "voice",
    via: "call_transcript",
    alreadyHandled: [
      ...duringCall.map((t) => `Created task: ${t.title}`),
      ...answeredDuringCall.map((q) => `Answered: ${q.prompt}`),
      ...toldDuringCall.map((m) => `Told the user on the call: ${m.body}`),
    ],
  });
}

/**
 * The live voice path: Dial's agent, on a call with the user, passes along
 * what they said through Telo's MCP tool. Runs the same pipeline as a text
 * and returns what Telo would have texted, for the agent to say instead.
 */
export async function askTeloByVoice(user: UserRow, said: string, waitMs = 25_000): Promise<string> {
  const capture = { lines: [] as string[], closed: false };
  const work = withVoiceCapture(capture, () => handleUserInput({ user, text: said, channel: "voice" })).catch((err) => {
    console.error("[concierge] voice input failed", err);
  });
  await Promise.race([work, new Promise((r) => setTimeout(r, waitMs))]);
  capture.closed = true; // anything later goes out as a normal update
  return capture.lines.join(" ") || "I'm on it. I'll text you as soon as I know more.";
}

export { getTask };
