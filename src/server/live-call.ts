import { and, desc, eq, inArray } from "drizzle-orm";
import * as agent from "./agent";
import { describeWindows, freeWindows, getCalendar } from "./calendar";
import { db } from "./db/client";
import { calls, questions, type CallRow, type QuestionRow, type TaskRow, type UserRow } from "./db/schema";
import type { ApprovalOption, InfoField } from "./domain/types";
import { newId } from "./ids";
import { recordEvent } from "./memory/events";
import { notify } from "./notify";
import { approvalText } from "./orchestrator";
import { SECRET_FIELD } from "./redact";
import { askTeloByVoice } from "./concierge";
import { config } from "./config";
import { statusDigest } from "./status";
import { getCall, getTask, getUser, getUserByPhone, listQuestions, patchTask } from "./tasks/repo";
import { formatWhen, localParts, nowContext, zonedTime } from "./time";

// Telo's tools during calls: what Dial's voice agent can call on Telo's MCP
// server (and the simulated line calls the same way). Dial sends no call id,
// so each request is matched to a live call by the other party's number and
// the direction, and every tool checks who is on the line:
//   - the owner (calling Telo's number, or picking up a call from Telo):
//     get_status and ask_telo;
//   - a business Telo called for a task: report_progress, ask_customer,
//     wait_for_customer and check_calendar.
// ask_customer is how a business call gets something only the user has (an
// account number, a yes or no) while the business waits on the line. (The
// first name was ask_user; Claude playing the agent in the lab read "user"
// as the person on the phone, so the tools say "customer" and name them.)

export interface ToolResult {
  text: string;
  isError?: boolean;
  /** For the simulated line and tests: the answer, when there is one. */
  data?: Record<string, unknown>;
}

const ok = (text: string, data?: Record<string, unknown>): ToolResult => ({ text, ...(data ? { data } : {}) });
const err = (text: string): ToolResult => ({ text, isError: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const digits = (p: string | null | undefined) => p?.replace(/\D/g, "").slice(-10) ?? "";

/** How long a business can be kept waiting for the user's answer, in all. */
export const liveWaitMs = () => config.calls.liveWaitSeconds * 1000;
/** One wait_for_customer call: short enough that the agent can say something between them. */
const pollMs = () => config.calls.livePollSeconds * 1000;

const WHO = config.user.name.split(" ")[0];

export const TOOLS = [
  {
    name: "get_status",
    description: "Get the live status of everything Telo is handling for the line's owner. Use it when they ask how things are going.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "ask_telo",
    description:
      "Pass along what the line's owner just said: a new request, an answer to a question Telo asked, a decision, or a question about past calls. Returns what to tell them.",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string", description: "What they said, in their own words" } },
      required: ["message"],
      additionalProperties: false,
    },
  },
  {
    name: "report_progress",
    description:
      "While calling a business: note that you reached a phone menu, were put on hold, got a person, or are wrapping up. It only updates Telo's screen; keep talking to them as usual.",
    inputSchema: {
      type: "object",
      properties: {
        stage: { type: "string", enum: ["phone_menu", "on_hold", "speaking_with_person", "wrapping_up"] },
        note: { type: "string" },
      },
      required: ["stage"],
      additionalProperties: false,
    },
  },
  {
    name: "ask_customer",
    description: `While calling a business for ${WHO}: text ${WHO} (the customer you're calling for, NOT the person on the phone) when the business needs something only ${WHO} can give or decide: an account number, a date, whether to accept an offer. Say anything meant for the person on the phone out loud instead. Returns right away; then call wait_for_customer for ${WHO}'s reply. Never for passwords, PINs, security answers, card or Social Security numbers.`,
    inputSchema: {
      type: "object",
      properties: {
        detail: { type: "string", description: "What's needed, in two to four words, e.g. 'Account number' or 'Accept $18/month?'" },
        question: { type: "string", description: `The question for ${WHO}, e.g. 'What's the account number on your Bayside bill?'` },
        options: { type: "array", items: { type: "string" }, description: "For a decision only: two to four short choices, e.g. ['Accept $18/month', 'Keep cancelling']" },
      },
      required: ["detail", "question"],
      additionalProperties: false,
    },
  },
  {
    name: "wait_for_customer",
    description: `After ask_customer: waits up to 15 seconds for ${WHO}'s reply. Returns the answer, or what to say to the person on the phone while you keep waiting, or tells you to wrap up if ${WHO} isn't answering.`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "check_calendar",
    description: `While calling a business for ${WHO}: check whether ${WHO} is free at a day and time the business offers, e.g. 'Tuesday October 13 at 10 AM'. Says free or busy, and free times nearby when busy. Never reveals what ${WHO}'s events are.`,
    inputSchema: {
      type: "object",
      properties: {
        time: { type: "string", description: "The day and time they offered, as they said it or as an ISO date-time" },
        minutes: { type: "number", description: "How long it takes, if they said (default 60)" },
      },
      required: ["time"],
      additionalProperties: false,
    },
  },
] as const;

type Caller = { kind: "owner"; user: UserRow; call: CallRow | null } | { kind: "business"; user: UserRow; call: CallRow; task: TaskRow };

/** Who is on the line, from Dial's per-call headers: the owner, a business Telo called for a task, or nobody Telo knows. */
export async function resolveCaller(direction: string | null, other: string | null, callId?: string): Promise<Caller | null> {
  // The simulated line knows its call id; Dial only sends the numbers.
  if (callId) {
    const call = await getCall(callId);
    const user = call ? await getUser(call.userId) : undefined;
    if (!call || !user) return null;
    if (call.kind === "user_update") return { kind: "owner", user, call };
    const task = call.kind === "business" && call.taskId ? await getTask(call.taskId) : undefined;
    return task ? { kind: "business", user, call, task } : null;
  }
  if (!other || digits(other).length < 10) return null;
  if (direction === "inbound") {
    const user = await getUserByPhone(other);
    return user ? { kind: "owner", user, call: null } : null;
  }
  if (direction !== "outbound") return null;
  const live = await db
    .select()
    .from(calls)
    .where(and(eq(calls.direction, "outbound"), inArray(calls.status, ["queued", "ringing", "in_progress"])))
    .orderBy(desc(calls.createdAt))
    .limit(50);
  const call = live.find((c) => digits(c.targetPhone) === digits(other));
  if (!call) return null;
  const user = await getUser(call.userId);
  if (!user) return null;
  if (call.kind === "user_update") return { kind: "owner", user, call };
  if (call.kind !== "business" || !call.taskId) return null;
  const task = await getTask(call.taskId);
  return task ? { kind: "business", user, call, task } : null;
}

const first = (u: UserRow) => u.name.split(" ")[0];
/** "Account number" → "your account number". */
const yours = (detail: string) => {
  const d = detail.trim().replace(/[?.]+$/, "").toLowerCase();
  return /^your /.test(d) ? d : `your ${d.replace(/^(the|a|an) /, "")}`;
};
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// What the business asks for, said the way a person would: "Account number", not a sentence.
const COMMON_DETAILS = /\b(account number|account holder'?s? name|name on the account|member(?:ship)? (?:id|number)|policy number|order number|confirmation number|reference number|date of birth|zip code|billing address|service address|last (?:four|4) digits(?: of [a-z ]+)?|email(?: address)?|phone number|claim number|case number|license plate|vin)\b/i;
function shortLabel(detail: string, question: string, business = ""): string {
  // "Westbay account number" → "Account number": the business is already in the text.
  const words = business.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const d = detail
    .replace(/[?.!]+$/, "")
    .split(/\s+/)
    .filter((w) => !words.includes(w.toLowerCase().replace(/'s$/, "")))
    .join(" ")
    .trim();
  if (d && d.split(/\s+/).length <= 4) return d.replace(/^./, (c) => c.toUpperCase());
  const hit = `${d} ${question}`.match(COMMON_DETAILS)?.[1];
  if (hit) return hit.replace(/^./, (c) => c.toUpperCase());
  return d.split(/\s+/).slice(0, 4).join(" ").replace(/^./, (c) => c.toUpperCase()) || "A detail";
}
// A line meant for the person on the phone, sent to ask_customer by mistake (seen in the lab).
const FOR_THE_BUSINESS = /\b(i'?m telo|this is telo|ai assistant|calling (on behalf of|for) |do you have|is it okay if i (continue|proceed)|can you (help|tell me|look)|would you)\b/i;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "detail";

const STAGES: Record<string, string> = {
  phone_menu: "In the phone menu",
  on_hold: "On hold",
  speaking_with_person: "Talking to a person",
  wrapping_up: "Wrapping up",
};

export async function callTool(name: string, args: Record<string, unknown>, headers: { direction: string | null; other: string | null; callId?: string }): Promise<ToolResult> {
  const caller = await resolveCaller(headers.direction, headers.other, headers.callId);
  if (name === "get_status" || name === "ask_telo") {
    if (caller?.kind !== "owner") return err("This tool is only for calls with the line's owner.");
    if (name === "get_status") return ok(await statusDigest(caller.user.id));
    const message = str(args.message);
    if (!message) return err("Pass what they said in `message`.");
    return ok(await askTeloByVoice(caller.user, message));
  }
  if (caller?.kind !== "business") return err("Only available while Telo is on a call with a business.");
  switch (name) {
    case "report_progress":
      return reportProgress(caller, args);
    case "ask_customer":
    case "ask_user": // the first name, in case Dial still has the old tool list
      return askUser(caller, args);
    case "wait_for_customer":
    case "wait_for_answer":
      return waitForAnswer(caller);
    case "check_calendar":
      return checkCalendar(caller, args);
    default:
      return err(`Unknown tool ${name}`);
  }
}

type Business = Extract<Caller, { kind: "business" }>;

async function reportProgress({ call }: Business, args: Record<string, unknown>): Promise<ToolResult> {
  const stage = STAGES[String(args.stage)] ?? "On the call";
  const note = str(args.note).slice(0, 120);
  const detail = note ? `${stage}: ${note}` : stage;
  await db.update(calls).set({ statusDetail: detail }).where(eq(calls.id, call.id));
  if (call.taskId) await patchTask(call.taskId, { statusDetail: `${call.targetName}: ${detail}` }, ["calling"]);
  return ok("Noted. Keep talking with them as usual.");
}

/** The questions Telo asked the user during this call, newest first. */
async function liveQuestions(call: CallRow): Promise<QuestionRow[]> {
  if (!call.taskId) return [];
  const all = await listQuestions(call.taskId);
  return all.filter((q) => (q.context as { live?: boolean; callId?: string }).live && (q.context as { callId?: string }).callId === call.id).reverse();
}

async function askUser({ user, call, task }: Business, args: Record<string, unknown>): Promise<ToolResult> {
  const name = first(user);
  const detail = str(args.detail).slice(0, 80) || "a detail";
  const question = str(args.question).slice(0, 300);
  const options = (Array.isArray(args.options) ? args.options : []).map(str).filter(Boolean).slice(0, 4);
  if (!question) return err(`Pass the question for ${name} in \`question\`.`);
  if (SECRET_FIELD.test(`${detail} ${question}`)) {
    return ok(`Never ask ${name} for that. Say: "${name} will give that to you directly." Then carry on with the rest.`, { status: "refused" });
  }
  if (FOR_THE_BUSINESS.test(question)) {
    return ok(`That's a question for the person on the phone, not ${name}: just say it to them out loud. ask_customer only texts ${name}.`, { status: "misdirected" });
  }
  const pending = (await liveQuestions(call)).find((q) => q.status === "open" && !(q.context as { lapsed?: boolean }).lapsed);
  if (pending) return ok(`You already asked ${name} (${pending.fields[0]?.label ?? "a decision"}). Call wait_for_customer.`, { status: "asked" });

  // Something the user already gave Telo for this task: no need to bother them.
  const want = slug(shortLabel(detail, question, call.targetName));
  // Only what this call may share anyway (the brief's list, or non-sensitive facts without one): never another business's details.
  const allowed = call.brief?.mayDisclose ?? [];
  const known = !options.length
    ? task.facts.find((f) => f.source === "user" && (f.key === want || slug(f.label) === want) && (allowed.length ? allowed.includes(f.key) : !f.sensitive))
    : undefined;
  if (known) return ok(`${name} already gave Telo this. ${known.label}: ${known.value}. Share it if the goal needs it.`, { status: "known", value: known.value });

  const decision = options.length >= 2;
  const label = shortLabel(detail, question, call.targetName);
  const fields: InfoField[] = decision
    ? []
    : [{ key: slug(label), label, question, sensitive: /account|member|birth|address|email|phone|policy|license|card|digits/i.test(label), required: true }];
  const choices: ApprovalOption[] = decision ? options.map((label, i) => ({ id: `${slug(label)}_${i + 1}`, label })) : [];
  const id = newId("q");
  // Replaces this call's earlier question and any question from between calls; a parallel call's live question stays.
  for (const old of (await listQuestions(task.id)).filter((x) => x.status === "open")) {
    const c = old.context as { live?: boolean; callId?: string };
    if (!c.live || c.callId === call.id) await db.update(questions).set({ status: "cancelled" }).where(and(eq(questions.id, old.id), eq(questions.status, "open")));
  }
  await db.insert(questions).values({
    id,
    userId: user.id,
    taskId: task.id,
    kind: decision ? "approval" : "info",
    prompt: question,
    fields,
    options: choices,
    context: { live: true, callId: call.id, askedAt: new Date().toISOString(), target: call.targetName },
  });
  const waiting = decision ? "Waiting on your decision" : `Waiting on you: ${label.toLowerCase()}`;
  await db.update(calls).set({ statusDetail: waiting }).where(eq(calls.id, call.id));
  await patchTask(task.id, { statusDetail: `${call.targetName}: ${waiting}` }, ["calling"]);
  await recordEvent({
    userId: user.id,
    taskId: task.id,
    callId: call.id,
    orgKey: call.orgKey,
    type: "call.asked_user",
    summary: `Asked you during the call: ${decision ? question : label}`,
    data: { question, options },
  });
  const body = decision
    ? approvalText(`I'm on the phone with ${call.targetName}. ${question}`, question, choices)
    : `I'm on the phone with ${call.targetName} and they need ${yours(label)}. ${question}`;
  // urgent: the business is waiting, so with calls on this rings the user whatever the hour.
  await notify({ userId: user.id, taskId: task.id, kind: decision ? "approval" : "question", body, dedupeKey: `live:${id}`, urgent: true });
  return ok(`Texted ${name}. Say: "One moment, I'm just checking with ${name}." Then call wait_for_customer.`, { status: "asked", questionId: id });
}

async function waitForAnswer({ user, call }: Business): Promise<ToolResult> {
  const name = first(user);
  const q = (await liveQuestions(call))[0];
  if (!q) return ok(`You haven't asked ${name} anything on this call. Use ask_customer first.`, { status: "none" });
  const ctx = q.context as { askedAt?: string; lapsed?: boolean };
  const askedAt = Date.parse(String(ctx.askedAt ?? q.createdAt.toISOString()));
  const giveUpAt = askedAt + liveWaitMs();
  const wrapUp = (waited: number) =>
    ok(
      `${name} hasn't answered (${waited} seconds). Don't keep them waiting. Say: "I'm sorry, I can't reach ${name} right now. I'll get that and call you back." Then ask when is best and for a reference number, and end the call. If the goal doesn't need it, carry on without it.`,
      { status: "timeout" },
    );
  if (q.status === "open" && ctx.lapsed) return wrapUp(Math.round((Date.now() - askedAt) / 1000)); // already told to wrap up
  const until = Math.min(Date.now() + pollMs(), giveUpAt);
  let fresh: QuestionRow | undefined = q;
  for (;;) {
    fresh = (await listQuestions(q.taskId)).find((x) => x.id === q.id);
    if (!fresh || fresh.status !== "open" || Date.now() >= until) break;
    await sleep(400);
  }
  if (fresh?.status === "answered") return answered(user, fresh);
  if (fresh?.status === "cancelled" && !(fresh.answer as { declined?: boolean } | null)?.declined) return wrapUp(Math.round((Date.now() - askedAt) / 1000));
  if (fresh?.status === "cancelled") {
    return ok(`${name} would rather not share that right now. Carry on without it if you can; otherwise say: "${name} will follow up with you on that." Ask for a reference number, and end the call politely.`, { status: "declined" });
  }
  const waited = Math.round((Date.now() - askedAt) / 1000);
  if (Date.now() >= giveUpAt) {
    // From here an answer is for the callback, not this call (the user is told so).
    await lapse(q);
    return wrapUp(waited);
  }
  const line = waited < 25 ? `Thanks for bearing with me, ${name}'s just getting that.` : `Still with me? I'm still waiting to hear back from ${name}.`;
  return ok(`No answer yet (${waited} seconds). Say: "${line}" Then call wait_for_customer again.`, { status: "waiting", waited });
}

async function answered(user: UserRow, q: QuestionRow): Promise<ToolResult> {
  const name = first(user);
  const a = (q.answer ?? {}) as { keys?: string[]; optionId?: string | null; approve?: boolean; note?: string | null };
  if (q.kind === "approval") {
    const option = q.options.find((o) => o.id === a.optionId);
    const choice = option?.label ?? (a.approve === false ? "No" : "Yes");
    const note = a.note ? ` (${a.note})` : "";
    return ok(`${name} decided: ${choice}${note}. Tell them, and carry on with that.`, { status: "answered", choice, approve: a.approve !== false });
  }
  const task = await getTask(q.taskId);
  const keys = a.keys?.length ? a.keys : q.fields.map((f) => f.key);
  const given = (task?.facts ?? []).filter((f) => keys.includes(f.key));
  if (!given.length) return ok(`${name} answered, but Telo couldn't read it. Say: "I'll get that from ${name} and call you back."`, { status: "unreadable" });
  const said = given.map((f) => `${f.label}: ${f.value}`).join("; ");
  return ok(`${name} answered. ${said}. Give it to them now (say numbers clearly, digit by digit), and carry on.`, { status: "answered", value: given.map((f) => f.value).join("; ") });
}

/** "2026-10-13T10:00" (local) or ISO with an offset; anything else goes to Claude with the user's "now". */
export async function resolveSpokenTime(text: string, tz: string): Promise<Date | null> {
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (iso) {
    if (/(Z|[+-]\d{2}:?\d{2})$/.test(text.trim())) {
      const t = Date.parse(text);
      return Number.isNaN(t) ? null : new Date(t);
    }
    return zonedTime(Number(iso[1]), Number(iso[2]), Number(iso[3]), Number(iso[4]), Number(iso[5]), tz);
  }
  try {
    const r = await agent.resolveTime({ now: nowContext(tz), text });
    const t = r.startsAt ? Date.parse(r.startsAt) : NaN;
    return Number.isNaN(t) ? null : new Date(t);
  } catch (e) {
    console.warn("[live-call] couldn't read the time", (e as Error).message);
    return null;
  }
}

async function checkCalendar({ user, call, task }: Business, args: Record<string, unknown>): Promise<ToolResult> {
  const name = first(user);
  const cal = getCalendar();
  if (!cal) return ok(`Telo can't see ${name}'s calendar. Use ask_customer to check with ${name}.`, { status: "no_calendar" });
  const said = str(args.time);
  if (!said) return err("Pass the day and time they offered in `time`.");
  const tz = user.timezone;
  const start = await resolveSpokenTime(said, tz);
  if (!start) return ok(`Couldn't tell what time "${said}" is. Ask them to say the day and the time again.`, { status: "unclear" });
  if (start.getTime() < Date.now() - 5 * 60_000) return ok(`That time has already passed. Ask them for another.`, { status: "past" });
  const minutes = Math.min(240, Math.max(15, Number(args.minutes) || 60));
  const end = new Date(start.getTime() + minutes * 60_000);
  const day = localParts(start, tz);
  const from = new Date(Math.max(Date.now(), zonedTime(day.year, day.month, day.day, 0, 0, tz).getTime()));
  const to = new Date(from.getTime() + 3 * 86_400_000);
  let busy;
  try {
    busy = await cal.busy(from, new Date(Math.max(to.getTime(), end.getTime())));
  } catch (e) {
    console.warn("[live-call] free/busy failed", (e as Error).message);
    return ok(`Telo couldn't open ${name}'s calendar just now. Use ask_customer to check with ${name}.`, { status: "error" });
  }
  const free = !busy.some((b) => b.start < end && b.end > start);
  const when = formatWhen(start, tz, { absolute: true });
  await recordEvent({
    userId: user.id,
    taskId: task.id,
    callId: call.id,
    orgKey: call.orgKey,
    type: "calendar.checked",
    summary: `Checked your calendar for ${when}: ${free ? "free" : "busy"}`,
    data: { startsAt: start.toISOString(), minutes, free },
  });
  if (free) {
    return ok(`${name} is free ${when}: that's inside ${name}'s free time, so booking it doesn't need ${name}'s OK. Accept it, unless something else in your instructions rules it out.`, { status: "free", startsAt: start.toISOString() });
  }
  const nearby = describeWindows(freeWindows(busy, from, to, tz, minutes), tz, 3);
  return ok(
    `${name} is busy ${when}, so don't take it. ${nearby ? `${name} is free: ${nearby}. Ask for one of those times instead.` : `No free time in the next three days; ask what else they have.`}`,
    { status: "busy", nearby },
  );
}

async function lapse(q: QuestionRow) {
  await db
    .update(questions)
    .set({ context: { ...(q.context as object), lapsed: true } })
    .where(and(eq(questions.id, q.id), eq(questions.status, "open")));
}

/** A business call hung up: its open questions now wait for the callback (an answer is kept, but not "given on the call"). */
export async function lapseLiveQuestions(call: CallRow): Promise<void> {
  for (const q of await liveQuestions(call)) if (q.status === "open") await lapse(q);
}

/** A business call ended: any question still waiting on the user from it lapses (review asks again if it's still needed). */
export async function expireLiveQuestions(call: CallRow): Promise<void> {
  for (const q of await liveQuestions(call)) {
    if (q.status !== "open") continue;
    await db
      .update(questions)
      .set({ status: "cancelled", context: { ...(q.context as object), expired: true } })
      .where(and(eq(questions.id, q.id), eq(questions.status, "open")));
  }
}
