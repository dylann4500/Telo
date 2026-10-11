import { and, asc, eq, isNull } from "drizzle-orm";
import * as agent from "./agent";
import { renderCallInstructions, shareableDetails } from "./agent/call-instructions";
import { config } from "./config";
import { db } from "./db/client";
import { calls, emails, organizations, questions, type CallRow, type TaskRow, type UserRow } from "./db/schema";
import { getCalendar, userAvailability } from "./calendar";
import type {
  ApprovalOption,
  CallAnalysis,
  CallBrief,
  Fact,
  FollowUp,
  InfoField,
  MemoryBrief,
  TaskCategory,
  TaskResult,
  TaskStatus,
  TaskTarget,
  TypedFacts,
} from "./domain/types";
import type { DecideResult } from "./agent/schemas";
import { newId, orgKeyFor } from "./ids";
import { relationshipHistory } from "./memory";
import { recordEvent } from "./memory/events";
import { notify } from "./notify";
import { maskSecrets, redactFact } from "./redact";
import { getTask, getUser, listCalls, listOrganizations, listRecentTasks, patchTask, transitionTask } from "./tasks/repo";
import { clampToCallingHours, formatWhen, nextWeekdayMorning, nowContext } from "./time";
import { getVoice } from "./voice";
import { parseDialError } from "./voice/dial";

// Drives a task through its lifecycle. Each state has one step function;
// `advance` runs steps until the task is waiting on something external (the
// user, or a phone call). Steps are serialized per task in-process, and every
// state change is a compare-and-swap, so retries and duplicate webhooks are
// harmless.

const g = globalThis as unknown as { __teloLocks?: Map<string, Promise<void>> };
const locks = (g.__teloLocks ??= new Map());

export function isTaskBusy(taskId: string): boolean {
  return locks.has(taskId);
}

async function withTaskLock(taskId: string, fn: () => Promise<void>): Promise<void> {
  const previous = locks.get(taskId) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const chain = previous.then(() => mine);
  locks.set(taskId, chain);
  await previous;
  try {
    await fn();
  } finally {
    release();
    if (locks.get(taskId) === chain) locks.delete(taskId);
  }
}

/** Drives a task forward in the background. */
export function kick(taskId: string): void {
  void advance(taskId).catch((err) => console.error(`[orchestrator] ${taskId}`, err));
}

export async function advance(taskId: string): Promise<void> {
  await withTaskLock(taskId, async () => {
    for (let i = 0; i < 12; i++) {
      const task = await getTask(taskId);
      if (!task) return;
      let progressed: boolean;
      try {
        progressed = await step(task);
      } catch (err) {
        await onStepError(task, err);
        return;
      }
      if (progressed && task.stepFailures) await patchTask(taskId, { stepFailures: 0, lastError: null });
      if (!progressed) return;
    }
  });
}

function step(task: TaskRow): Promise<boolean> {
  switch (task.status) {
    case "new":
      return understand(task);
    case "planning":
      return plan(task);
    case "ready":
      return dial(task);
    case "reviewing":
      return review(task);
    default:
      return Promise.resolve(false); // waiting on the user or a call
  }
}

async function onStepError(task: TaskRow, err: unknown) {
  const failures = task.stepFailures + 1;
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[orchestrator] ${task.id} step "${task.status}" failed (${failures}x):`, err);
  if (failures < 3) {
    // The background sweep retries with backoff.
    await patchTask(task.id, { stepFailures: failures, lastError: message.slice(0, 500) }, [task.status]);
    return;
  }
  const failed = await transitionTask(
    task.id,
    "failed",
    {
      stepFailures: failures,
      lastError: message.slice(0, 500),
      statusDetail: "Stopped after an error",
      result: { outcome: "failed", summary: `Stopped after repeated errors: ${message.slice(0, 160)}`, confirmation: null },
      completedAt: new Date(),
    },
    [task.status],
  );
  if (failed) {
    await recordEvent({ userId: task.userId, taskId: task.id, orgKey: task.orgKey, type: "task.failed", summary: "Stopped after repeated errors", typed: { outcome: "failed" } });
    await notify({
      userId: task.userId,
      taskId: task.id,
      kind: "failure",
      body: `I hit a problem on "${task.title}" and stopped. Reply "try again" and I'll pick it back up.`,
      dedupeKey: `fail:${task.id}:${task.version}`,
    });
  }
}

// ---------------------------------------------------------------- helpers

function now(user: UserRow): string {
  return nowContext(user.timezone);
}

const UNREACHED: readonly CallAnalysis["outcome"][] = ["no_answer", "voicemail", "failed"];

// Never asked for by text, whatever the business says it needs.
const SECRET_FIELD = /password|passcode|\bpin\b|security (code|answer|question)|social security|\bssn\b|\bcvv\b|\bcvc\b|(full|entire|whole) (credit |debit )?card number/i;

/**
 * When to call back, from a time the model proposed: in the future (at least
 * ten minutes out, at most a year), and inside calling hours. No usable time
 * means 10:00 on the next weekday.
 */
function callbackTime(proposed: string | null | undefined, tz: string): { at: Date; moved: boolean } {
  const parsed = proposed ? Date.parse(proposed) : NaN;
  if (Number.isNaN(parsed)) return { at: nextWeekdayMorning(tz), moved: true };
  const bounded = Math.min(Math.max(parsed, Date.now() + 10 * 60_000), Date.now() + 365 * 86_400_000);
  const at = clampToCallingHours(new Date(bounded), tz);
  return { at, moved: Math.abs(at.getTime() - parsed) > 60_000 };
}

/** A time the user asked for ("call them tomorrow at 9"): honored as given, if it's still ahead. */
function requestedTime(proposed: string | null | undefined): Date | null {
  const parsed = proposed ? Date.parse(proposed) : NaN;
  if (Number.isNaN(parsed) || parsed < Date.now() + 2 * 60_000) return null;
  return new Date(Math.min(parsed, Date.now() + 365 * 86_400_000));
}

function taskKind(task: Pick<TaskRow, "category" | "goal" | "title">): string {
  const text = `${task.title} ${task.goal ?? ""}`.toLowerCase();
  switch (task.category as TaskCategory | null) {
    case "membership":
      return /pause/.test(text) ? "pause_membership" : /cancel/.test(text) ? "cancel_membership" : "membership_change";
    case "support":
      return /bill|charge|credit|refund/.test(text) ? "dispute_bill" : "support_issue";
    case "reservation":
      return /reschedul|move/.test(text) ? "reschedule" : "booking";
    case "quotes":
      return "get_quote";
    case "inquiry":
      return "inquiry";
    default:
      return "other";
  }
}

function mergeFacts(existing: Fact[], incoming: Fact[]): Fact[] {
  const out = [...existing];
  for (const f of incoming) {
    if (!f.value?.trim()) continue;
    const i = out.findIndex((x) => x.key === f.key);
    if (i >= 0) out[i] = { ...out[i], ...f };
    else out.push(f);
  }
  return out;
}

function fakePhone(name: string): string {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `+1415555${String(h % 10000).padStart(4, "0")}`;
}

/**
 * The number Telo may dial for a business: one the user gave, the directory's,
 * or the demo stand-in. Never a number the model produced on its own.
 */
function resolvePhone(name: string, given: string | null, directory: { name: string; phone: string | null; aliases: string[] }[]): string | null {
  if (given) return normalizePhone(given);
  const key = name.toLowerCase();
  const hit = directory.find((d) => d.name.toLowerCase() === key || d.aliases.some((a) => a.toLowerCase() === key));
  if (hit?.phone) return hit.phone;
  return config.demo.targetPhone ?? null;
}

/** Only trust a model-extracted number if the user actually typed it. */
function userTyped(phone: string | null, task: TaskRow): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "").slice(-10);
  const said = [task.request, ...task.facts.filter((f) => f.source === "user").map((f) => f.value)].join(" ").replace(/\D/g, "");
  return digits.length === 10 && said.includes(digits) ? phone : null;
}

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return raw.trim().startsWith("+") ? `+${digits}` : `+${digits}`;
}

async function upsertOrganization(t: TaskTarget) {
  const key = orgKeyFor(t.name);
  if (!key) return;
  await db
    .insert(organizations)
    .values({ key, name: t.name, phone: t.phone })
    .onConflictDoUpdate({ target: organizations.key, set: t.phone ? { phone: t.phone } : { name: t.name } });
}

async function createQuestion(
  task: TaskRow,
  kind: "info" | "approval",
  prompt: string,
  fields: InfoField[],
  options: ApprovalOption[] = [],
  context: Record<string, unknown> = {},
) {
  await db.update(questions).set({ status: "cancelled" }).where(and(eq(questions.taskId, task.id), eq(questions.status, "open")));
  const id = newId("q");
  await db.insert(questions).values({ id, userId: task.userId, taskId: task.id, kind, prompt, fields, options, context });
  return id;
}

async function recentBusinesses(userId: string, excludeTaskId: string) {
  const recent = await listRecentTasks(userId, 12);
  return recent
    .filter((t) => t.id !== excludeTaskId && t.targets.length)
    .map((t) => ({
      business: t.targets.map((x) => x.name).join(", "),
      lastTask: t.title,
      when: t.createdAt.toISOString().slice(0, 10),
      outcome: t.result?.summary ?? t.status,
    }));
}

// ------------------------------------------------------------- the steps

/** new → needs_info | planning: work out the goal, targets, facts and authority. */
async function understand(task: TaskRow): Promise<boolean> {
  const user = (await getUser(task.userId))!;
  const directory = (await listOrganizations()).map((o) => ({ name: o.name, phone: o.phone, aliases: o.aliases }));
  const r = await agent.understandTask({
    request: task.request,
    now: now(user),
    user: { name: user.name, phone: user.phone },
    preferences: user.preferences,
    directory,
    knownFacts: task.facts.map((f) => ({ key: f.key, label: f.label, value: f.value })),
    recentBusinesses: await recentBusinesses(task.userId, task.id),
    // Free/busy only. Lets Telo pick a time instead of asking "when works?".
    availability: await userAvailability(user.timezone),
  });

  const targets: TaskTarget[] = r.targets.map((t) => {
    const existing = task.targets.find((x) => x.name.toLowerCase() === t.name.toLowerCase());
    return { name: t.name, kind: t.kind, phone: resolvePhone(t.name, existing?.phone ?? userTyped(t.phone, task), directory) };
  });
  for (const t of targets) await upsertOrganization({ ...t, phone: userTyped(t.phone, task) });
  const facts = mergeFacts(task.facts, r.facts.map((f) => ({ ...f, source: "user" as const })));
  const missing: InfoField[] = r.missing.filter((m) => m.required && !facts.some((f) => f.key === m.key && f.value));
  // The simulated line can call anyone; a real call needs a real number.
  for (const t of targets.filter((x) => !x.phone && getVoice().name !== "mock")) {
    missing.push({ key: `phone_${orgKeyFor(t.name)}`, label: `${t.name}'s number`, question: `What's the number for ${t.name}?`, sensitive: false, required: true });
  }
  if (r.needsPhoneCall && !targets.length && !missing.length) {
    missing.push({ key: "business", label: "Who to call", question: "Who should I call for this, and what's their number?", sensitive: false, required: true });
  }

  const base = {
    title: r.title,
    goal: r.goal,
    category: r.category,
    targets,
    facts,
    constraints: r.constraints,
    authority: r.authority,
    orgKey: targets[0] ? orgKeyFor(targets[0].name) : task.orgKey,
    // "Call them tomorrow at 9": the plan is made now, the call waits.
    wakeAt: requestedTime(r.callAt),
  };

  await recordEvent({
    id: `evt_created_${task.id}`,
    userId: task.userId,
    taskId: task.id,
    orgKey: base.orgKey,
    type: "task.created",
    summary: `New task: ${r.title}`,
    data: { request: maskSecrets(task.request), source: task.source },
    typed: { taskKind: taskKind({ ...task, ...base }) },
    occurredAt: task.createdAt,
  });

  if (!r.needsPhoneCall) {
    const done = await transitionTask(task.id, "completed", { ...base, statusDetail: "Done", completedAt: new Date(), result: { outcome: "success", summary: r.acknowledgement, confirmation: null } }, ["new"]);
    if (done) await notify({ userId: task.userId, taskId: task.id, kind: "reply", body: r.acknowledgement, dedupeKey: `ack:${task.id}` });
    return false;
  }

  if (missing.length) {
    const questionId = await createQuestion(task, "info", r.acknowledgement, missing);
    const moved = await transitionTask(task.id, "needs_info", { ...base, statusDetail: `Waiting on you: ${missing.map((m) => m.label).join(", ")}` }, ["new"]);
    if (!moved) return false;
    await recordEvent({ userId: task.userId, taskId: task.id, orgKey: base.orgKey, type: "task.info_requested", summary: `Asked you for: ${missing.map((m) => m.label).join(", ")}` });
    const extra = missing.filter((m) => !r.missing.some((x) => x.key === m.key)).map((m) => m.question);
    await notify({
      userId: task.userId,
      taskId: task.id,
      kind: "question",
      body: [r.acknowledgement, ...extra].join(" "),
      dedupeKey: `q:${questionId}`,
    });
    return false;
  }

  const moved = await transitionTask(task.id, "planning", { ...base, statusDetail: "Getting ready to call" }, ["new"]);
  if (!moved) return false;
  // After the user answered our questions, the plan's "calling now" update is
  // the acknowledgement; a second ack (possibly repeating the questions) is noise.
  const answeredBefore = await db.query.questions.findFirst({ where: and(eq(questions.taskId, task.id), eq(questions.status, "answered")) });
  if (!answeredBefore) {
    await notify({ userId: task.userId, taskId: task.id, kind: "ack", body: r.acknowledgement, dedupeKey: `ack:${task.id}` });
  }
  return true;
}

/** planning → ready: pull history from memory, write the call plan, queue the calls. */
async function plan(task: TaskRow): Promise<boolean> {
  const user = (await getUser(task.userId))!;
  const directory = (await listOrganizations()).map((o) => ({ name: o.name, phone: o.phone, aliases: o.aliases }));
  const followUp = task.followUp;
  const names = task.targets.map((t) => t.name).join(", ") || "the business";

  // 1. What happened before with these businesses. A live memory query on
  // every first plan; follow-ups reuse the brief.
  let memory: MemoryBrief | null = task.memory;
  if (!memory) {
    const orgKeys = [...new Set(task.targets.map((t) => orgKeyFor(t.name)).filter(Boolean))].slice(0, 3);
    const histories = await Promise.all(orgKeys.map((k) => relationshipHistory(user.id, k, { sinceDays: 365 })));
    const prior = histories.flatMap((h) => h.events).filter((e) => e.taskId !== task.id);
    let summary = "";
    let usedIds: string[] = [];
    if (prior.length) {
      const brief = await agent.briefHistory({
        business: names,
        task: { title: task.title, goal: task.goal, request: task.request },
        events: prior.slice(-40).map((e) => ({ id: e.id, type: e.type, summary: e.summary, occurredAt: e.occurredAt })),
      });
      summary = brief.summary.trim();
      usedIds = brief.relevantEventIds;
    }
    const used = prior.filter((e) => usedIds.includes(e.id));
    memory = {
      summary,
      events: (used.length ? used : summary ? prior.slice(-6) : []).map((e) => ({ id: e.id, type: e.type, summary: e.summary, occurredAt: e.occurredAt })),
      retrievedAt: new Date().toISOString(),
      source: histories[0]?.source ?? (config.memory.provider === "keewano" ? "keewano" : "local"),
      trace: histories.flatMap((h) => h.trace),
    };
    await recordEvent({
      userId: task.userId,
      taskId: task.id,
      orgKey: task.orgKey,
      type: "memory.retrieved",
      summary: summary ? `Remembered: ${summary}` : `No earlier history with ${names}`,
      data: { priorEvents: prior.length, used: memory.events.length, source: memory.source, trace: memory.trace },
    });
  }

  // 2. The plan.
  const priorCalls = (await listCalls(task.id))
    .filter((c) => c.kind === "business" && c.analysis)
    .map((c) => ({ target: c.targetName, purpose: c.purpose, summary: c.analysis!.summary, outcome: c.analysis!.outcome }));
  const callbackTarget = followUp?.callback
    ? task.targets.find((t) => t.name.toLowerCase() === followUp.callback!.targetName.toLowerCase()) ?? {
        name: followUp.callback.targetName,
        phone: null,
        kind: "business" as const,
      }
    : null;
  const p = await agent.planCalls({
    now: now(user),
    userName: user.name,
    task: { title: task.title, goal: task.goal, request: task.request, category: task.category },
    targets: callbackTarget ? [callbackTarget] : task.targets,
    facts: task.facts.map((f) => ({ key: f.key, label: f.label, value: f.value, source: f.source })),
    constraints: task.constraints,
    authority: task.authority,
    history: memory.summary,
    priorCalls,
    followUp: followUp ? { reason: followUp.reason, userDecision: followUp.userDecision, callback: followUp.callback } : null,
  });

  // 3. Queue one call per leg.
  const existing = await listCalls(task.id);
  let seq = Math.max(0, ...existing.filter((c) => c.kind === "business").map((c) => c.seq)) + 1;
  const legs: CallBrief[] = [];
  for (const leg of p.legs) {
    const target = task.targets.find((t) => t.name.toLowerCase() === leg.targetName.toLowerCase()) ?? callbackTarget ?? task.targets[0];
    const name = target?.name ?? leg.targetName;
    const phone = resolvePhone(name, target?.phone ?? null, directory);
    const brief: CallBrief = { ...leg, targetName: name, targetPhone: phone };
    legs.push(brief);
    await db.insert(calls).values({
      id: newId("call"),
      userId: task.userId,
      taskId: task.id,
      direction: "outbound",
      kind: "business",
      seq: seq++,
      attempt: 1,
      orgKey: orgKeyFor(name),
      targetName: name,
      targetPhone: phone,
      purpose: leg.purpose,
      brief,
      status: "planned",
    });
  }
  if (!legs.length) throw new Error("The plan had no calls");

  // The user asked for the call to happen later: the calls are queued and wait.
  const later = !followUp && task.wakeAt && task.wakeAt.getTime() > Date.now() + 60_000 ? task.wakeAt : null;
  const who = [...new Set(legs.map((l) => l.targetName))].join(", ");
  const moved = await transitionTask(
    task.id,
    later ? "scheduled" : "ready",
    {
      plan: { strategy: p.strategy, parallel: p.parallel, legs: [...(task.plan?.legs ?? []), ...legs] },
      memory,
      followUp: null,
      wakeAt: later,
      statusDetail: later ? `Calling ${who} ${formatWhen(later, user.timezone, { absolute: true })}` : `About to call ${who}`,
    },
    ["planning"],
  );
  if (!moved) return false;
  await recordEvent({ userId: task.userId, taskId: task.id, orgKey: task.orgKey, type: "task.plan_generated", summary: `Plan: ${p.strategy}`, data: { legs: legs.length } });
  // Without earlier questions, the acknowledgement already said "calling now"
  // (or when); this update is for after answers, or to share remembered history.
  const ackSent = !(await db.query.questions.findFirst({ where: and(eq(questions.taskId, task.id), eq(questions.status, "answered")) }));
  if (!followUp && (!ackSent || (!later && memory.summary))) {
    const body = later ? `Got it. I'll call ${who} ${formatWhen(later, user.timezone)}.` : p.userUpdate;
    await notify({ userId: task.userId, taskId: task.id, kind: "update", body, dedupeKey: `plan:${task.id}` });
  }
  return !later;
}

/** ready → calling: place the next planned call (or all of them, for a parallel plan). */
async function dial(task: TaskRow): Promise<boolean> {
  const planned = (await listCalls(task.id)).filter((c) => c.kind === "business" && c.status === "planned");
  if (!planned.length) return Boolean(await transitionTask(task.id, "reviewing", { statusDetail: "Reviewing" }, ["ready"]));
  const batch = task.plan?.parallel ? planned : [planned[0]];
  const claimed = await transitionTask(task.id, "calling", { statusDetail: `Calling ${batch.map((c) => c.targetName).join(", ")}` }, ["ready"]);
  if (!claimed) return false;
  const user = (await getUser(task.userId))!;
  let placed = 0;
  for (const call of batch) if (await placeOne(claimed, user, call)) placed++;
  if (!placed) {
    await transitionTask(task.id, "reviewing", { statusDetail: "The call could not be placed" }, ["calling"]);
    return true;
  }
  return false; // waiting for the call
}

async function placeOne(task: TaskRow, user: UserRow, call: CallRow): Promise<boolean> {
  const won = await db
    .update(calls)
    .set({ status: "queued", provider: getVoice().name, startedAt: new Date() })
    .where(and(eq(calls.id, call.id), eq(calls.status, "planned")))
    .returning();
  if (!won.length) return false; // someone else placed it
  const leg: CallBrief = call.brief ?? {
    targetName: call.targetName,
    targetPhone: call.targetPhone,
    purpose: call.purpose,
    objective: task.goal ?? task.request,
    openingLine: `Hi, this is Telo, an AI assistant calling on behalf of ${user.name}.`,
    talkingPoints: [],
    mayDisclose: [],
    decisionRules: [],
    collect: [],
    fallback: "Ask for the right department or a callback number.",
  };
  const rendered = renderCallInstructions({
    userName: user.name,
    leg,
    facts: task.facts,
    authority: task.authority,
    history: task.memory?.summary || null,
    constraints: task.constraints,
  });
  await db.update(calls).set({ instructions: rendered.instructions }).where(eq(calls.id, call.id));

  const fail = async (reason: string) => {
    await db
      .update(calls)
      .set({ status: "failed", endReason: "failed_to_place", statusDetail: reason.slice(0, 200), endedAt: new Date(), finishedAt: new Date() })
      .where(eq(calls.id, call.id));
    await recordEvent({
      userId: task.userId,
      taskId: task.id,
      callId: call.id,
      orgKey: call.orgKey,
      type: "call.failed",
      summary: `Couldn't call ${call.targetName}: ${reason}`,
      typed: { outcome: "dropped" },
    });
  };
  // A simulated call gets a placeholder number; it's never stored or dialed for real.
  const to = call.targetPhone ?? (getVoice().name === "mock" ? fakePhone(call.targetName) : null);
  if (!to) {
    await fail("no phone number");
    return false;
  }
  try {
    const res = await getVoice().placeCall({
      callId: call.id,
      to,
      instructions: rendered.instructions,
      idempotencyKey: `telo:${call.id}`,
    });
    await db.update(calls).set({ providerCallId: res.providerCallId }).where(eq(calls.id, call.id));
    await recordEvent({
      id: `evt_start_${call.id}`,
      userId: task.userId,
      taskId: task.id,
      callId: call.id,
      orgKey: call.orgKey,
      type: "call.started",
      summary: `Calling ${call.targetName}: ${call.purpose}`,
      typed: { purpose: taskKind(task), briefUsed: Boolean(task.memory?.summary) },
    });
    return true;
  } catch (err) {
    const parsed = parseDialError(err);
    await fail(parsed ? `${parsed.code ?? parsed.status}: ${parsed.message}` : (err as Error).message);
    return false;
  }
}

/** Called when a business call is over and its transcript is in. */
export async function onBusinessCallFinished(taskId: string): Promise<void> {
  const all = await listCalls(taskId);
  const pending = all.filter((c) => c.kind === "business" && c.status !== "planned" && !c.finishedAt);
  if (pending.length) return; // another call on this task is still going
  const moved = await transitionTask(taskId, "reviewing", { statusDetail: "Going over the call" }, ["calling"]);
  if (moved) kick(taskId);
}

/** A business called Telo's line back about a task Telo was waiting on: read what they said. */
export async function onBusinessCalledBack(taskId: string): Promise<boolean> {
  const moved = await transitionTask(taskId, "reviewing", { wakeAt: null, statusDetail: "They called back" }, ["scheduled"]);
  if (moved) kick(taskId);
  return Boolean(moved);
}

/** An email answered what a scheduled task was waiting on: review it now, before any call. */
export async function onEmailForTask(taskId: string): Promise<boolean> {
  const moved = await transitionTask(taskId, "reviewing", { wakeAt: null, statusDetail: "Reading their email" }, ["scheduled"]);
  if (moved) kick(taskId);
  return Boolean(moved);
}

/** scheduled → ready | planning: the time Telo set has come (or the user said "call now"). */
export async function wakeTask(taskId: string): Promise<boolean> {
  const task = await getTask(taskId);
  if (!task || task.status !== "scheduled") return false;
  const planned = (await listCalls(taskId)).filter((c) => c.kind === "business" && c.status === "planned");
  const name = planned[0]?.targetName ?? task.followUp?.callback?.targetName ?? task.targets[0]?.name ?? "them";
  const moved = await transitionTask(
    taskId,
    planned.length ? "ready" : "planning",
    {
      wakeAt: null,
      followUp: task.followUp?.reason === "retry" ? null : task.followUp,
      statusDetail: planned.length ? `Calling ${name}` : `Calling ${name} back`,
    },
    ["scheduled"],
  );
  if (moved) kick(taskId);
  return Boolean(moved);
}

/** reviewing → ready | planning | scheduled | needs_info | needs_approval | completed | failed. */
async function review(task: TaskRow): Promise<boolean> {
  const user = (await getUser(task.userId))!;
  for (const call of (await listCalls(task.id)).filter((c) => c.kind === "business" && c.finishedAt && !c.analysis)) {
    const analysis = await analyze(task, call, user);
    const claimed = await db
      .update(calls)
      .set({ analysis, analyzedAt: new Date() })
      .where(and(eq(calls.id, call.id), isNull(calls.analyzedAt)))
      .returning();
    if (claimed.length) await recordCallOutcome(task, claimed[0], analysis);
  }

  const fresh = (await getTask(task.id))!;
  const all = await listCalls(task.id);
  const business = all.filter((c) => c.kind === "business");
  const remaining = business.filter((c) => c.status === "planned");
  const mails = await db.select().from(emails).where(eq(emails.taskId, task.id)).orderBy(asc(emails.receivedAt));
  const d = await agent.decideNext({
    now: now(user),
    task: { title: fresh.title, goal: fresh.goal, request: fresh.request, category: fresh.category },
    constraints: fresh.constraints,
    authority: fresh.authority,
    facts: fresh.facts.map((f) => ({ key: f.key, label: f.label, value: f.value, source: f.source })),
    calls: business
      .filter((c) => c.analysis)
      .map((c) => ({
        id: c.id,
        target: c.targetName,
        direction: c.direction,
        purpose: c.purpose,
        attempt: c.attempt,
        status: c.status,
        connected: Boolean(c.answeredAt) && c.transcript.some((t) => t.speaker === "other"),
        durationSec: c.durationSec,
        analysis: c.analysis,
      })),
    remainingLegs: remaining.map((c) => ({ target: c.targetName, purpose: c.purpose })),
    maxAttemptsPerLeg: config.calls.maxAttemptsPerLeg,
    latestDecision: fresh.followUp?.userDecision ?? null,
    emails: mails.map((m) => ({
      from: m.business,
      kind: m.kind,
      summary: m.summary,
      amountUsd: m.amountCents != null ? m.amountCents / 100 : null,
      confirmationNumber: m.confirmationNumber,
      receivedAt: m.receivedAt?.toISOString() ?? null,
    })),
  });
  if (d.learnedFacts.length) {
    await patchTask(task.id, { facts: mergeFacts(fresh.facts, d.learnedFacts.map((f) => ({ ...f, sensitive: false, source: "call" as const }))) });
  }
  const lastCall = business.filter((c) => c.analysis).at(-1);
  const latestConfirmation =
    business.filter((c) => c.analysis?.confirmationNumbers.length).at(-1)?.analysis?.confirmationNumbers.at(-1) ??
    mails.filter((m) => m.confirmationNumber).at(-1)?.confirmationNumber ??
    null;

  // However the calls go, a task gets a bounded number of them.
  const placed = business.filter((c) => c.direction === "outbound" && c.status !== "planned" && c.status !== "canceled").length;
  if (["retry", "callback", "schedule"].includes(d.action) && placed >= config.calls.maxCallsPerTask) {
    const where = lastCall?.analysis?.summary ?? "";
    return finalize(
      task.id,
      "failed",
      { outcome: "failed", summary: `Stopped after ${placed} calls. ${where}`.trim(), confirmation: latestConfirmation },
      `I've made ${placed} calls on "${fresh.title}" without wrapping it up, so I'm stopping here. ${where}`.trim(),
    );
  }

  switch (d.action) {
    case "complete": {
      const result = d.result ?? { outcome: "success" as const, summary: d.userMessage, confirmation: null };
      return finalize(task.id, "completed", { ...result, confirmation: result.confirmation ?? latestConfirmation }, d.userMessage);
    }
    case "fail":
      return finalize(task.id, "failed", d.result ?? { outcome: "failed", summary: d.userMessage, confirmation: null }, d.userMessage);
    case "ask_user": {
      const prompt = d.question?.prompt || d.userMessage;
      const options = d.question?.options?.length ? d.question.options : [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }];
      const questionId = await createQuestion(fresh, "approval", prompt, [], options, { callId: lastCall?.id ?? null });
      const moved = await transitionTask(task.id, "needs_approval", { statusDetail: "Waiting on your decision", followUp: null }, ["reviewing"]);
      if (!moved) return false;
      const offer = lastCall?.analysis?.offers.find((o) => o.requiresDecision) ?? lastCall?.analysis?.offers[0];
      await recordEvent({
        userId: task.userId,
        taskId: task.id,
        callId: lastCall?.id ?? null,
        orgKey: lastCall?.orgKey ?? fresh.orgKey,
        type: "approval.requested",
        summary: `Asked you: ${prompt}`,
        typed: {
          approvalKind: offer ? "accept_offer" : fresh.category === "quotes" ? "book" : "decision",
          amountCents: offer?.priceUsd != null ? Math.round(offer.priceUsd * 100) : undefined,
        },
      });
      await notify({ userId: task.userId, taskId: task.id, kind: "approval", body: approvalText(d.userMessage, prompt, options), dedupeKey: `q:${questionId}` });
      return false;
    }
    case "ask_info":
      return askForInfo(fresh, user, d, lastCall);
    case "next_call": {
      if (!remaining.length) return finalize(task.id, "completed", { outcome: "partial", summary: d.userMessage || "Finished the planned calls.", confirmation: null }, d.userMessage);
      const moved = await transitionTask(task.id, "ready", { statusDetail: `Next: ${remaining[0].targetName}`, followUp: null }, ["reviewing"]);
      if (moved && d.userMessage) await notify({ userId: task.userId, taskId: task.id, kind: "update", body: d.userMessage, dedupeKey: `upd:${task.id}:${moved.version}` });
      return Boolean(moved);
    }
    case "retry": {
      // A "failed" call where someone spoke is one that dropped mid-conversation:
      // that gets called straight back. Voicemail and no answer wait.
      const dropped = (c: CallRow) => c.analysis?.outcome === "failed" && c.transcript.some((t) => t.speaker === "other");
      const failed = business.filter((c) => c.analysis && UNREACHED.includes(c.analysis.outcome) && !dropped(c)).at(-1);
      if (!failed) return callBack(fresh, d, lastCall);
      if (failed.attempt >= config.calls.maxAttemptsPerLeg) {
        return finalize(task.id, "failed", { outcome: "failed", summary: `Couldn't reach ${failed.targetName}.`, confirmation: null }, d.userMessage || `I couldn't reach ${failed.targetName} after ${failed.attempt} tries. Want me to try again later?`);
      }
      await db
        .insert(calls)
        .values({
          id: newId("call"),
          userId: task.userId,
          taskId: task.id,
          direction: "outbound",
          kind: "business",
          seq: failed.seq,
          attempt: failed.attempt + 1,
          orgKey: failed.orgKey,
          targetName: failed.targetName,
          targetPhone: failed.targetPhone,
          purpose: failed.purpose,
          brief: failed.brief,
          status: "planned",
        })
        .onConflictDoNothing();
      // Not instantly: a business that didn't pick up rarely does ten seconds later.
      const at = clampToCallingHours(new Date(Date.now() + config.calls.retryMinutes * 60_000), user.timezone);
      const why = failed.analysis!.outcome === "voicemail" ? "went to voicemail" : failed.endReason === "busy" ? "was busy" : failed.analysis!.outcome === "failed" ? "didn't go through" : "didn't pick up";
      return scheduleTask(fresh, at, { reason: "retry", userDecision: fresh.followUp?.userDecision ?? null, callback: null }, {
        detail: `Trying ${failed.targetName} again ${formatWhen(at, user.timezone, { absolute: true })}`,
        message: `${failed.targetName} ${why}. I'll try again ${formatWhen(at, user.timezone)}.`,
        summary: `${failed.targetName} ${why}; trying again ${formatWhen(at, user.timezone, { absolute: true })}`,
        orgKey: failed.orgKey,
      });
    }
    case "callback":
      return callBack(fresh, d, lastCall);
    case "schedule": {
      const callback = d.callback ?? defaultCallback(fresh, lastCall);
      if (!callback) return finalize(task.id, "failed", { outcome: "failed", summary: "Nothing to follow up on.", confirmation: null }, d.userMessage);
      const { at, moved } = callbackTime(d.scheduleAt ?? lastCall?.analysis?.callbackAt, user.timezone);
      const when = formatWhen(at, user.timezone);
      // The model's text names its own time; if Telo had to move it, say the real one.
      const message =
        d.userMessage && d.scheduleAt && !moved
          ? d.userMessage
          : lastCall?.analysis?.outcome === "callback_required"
            ? `${callback.targetName} asked me to call back later. I'll call them ${when}.`
            : `I'll check back with ${callback.targetName} ${when}.`;
      return scheduleTask(fresh, at, { reason: "callback", userDecision: fresh.followUp?.userDecision ?? null, callback }, {
        detail: `Calling ${callback.targetName} back ${formatWhen(at, user.timezone, { absolute: true })}`,
        message,
        summary: `Call ${callback.targetName} back ${formatWhen(at, user.timezone, { absolute: true })}: ${callback.purpose}`,
        orgKey: orgKeyFor(callback.targetName),
      });
    }
  }
}

/**
 * The text for a decision. Over SMS or a phone call there are no buttons, so
 * it must end by actually asking (the model sometimes explains the offer and
 * leaves the question to the options).
 */
export function approvalText(message: string, prompt: string, options: ApprovalOption[]): string {
  const text = (message || prompt).trim();
  if (text.includes("?")) return text;
  if (prompt.includes("?") && !text.includes(prompt.trim())) return `${text} ${prompt.trim()}`;
  return options.length ? `${text} ${options.map((o) => o.label).join(", or ")}?` : text;
}

function defaultCallback(task: TaskRow, lastCall: CallRow | undefined): FollowUp["callback"] {
  if (!lastCall) return null;
  return {
    targetName: lastCall.targetName,
    purpose: "Follow up",
    objective: task.goal ?? task.request,
    talkingPoints: lastCall.analysis?.nextStep ? [lastCall.analysis.nextStep] : [],
  };
}

/** reviewing → planning: call the business again now, with what Telo learned. */
async function callBack(task: TaskRow, d: DecideResult, lastCall: CallRow | undefined): Promise<boolean> {
  const callback = d.callback ?? defaultCallback(task, lastCall);
  if (!callback) return finalize(task.id, "failed", { outcome: "failed", summary: "Nothing to follow up on.", confirmation: null }, d.userMessage);
  const moved = await transitionTask(
    task.id,
    "planning",
    { followUp: { reason: "callback", userDecision: task.followUp?.userDecision ?? null, callback }, statusDetail: `Calling ${callback.targetName} back` },
    ["reviewing"],
  );
  if (moved) {
    await recordEvent({ userId: task.userId, taskId: task.id, orgKey: orgKeyFor(callback.targetName), type: "followup.required", summary: `Calling ${callback.targetName} back: ${callback.purpose}` });
    if (d.userMessage) await notify({ userId: task.userId, taskId: task.id, kind: "update", body: d.userMessage, dedupeKey: `cb:${task.id}:${moved.version}` });
  }
  return Boolean(moved);
}

/** reviewing → scheduled: park the task until `at`; the background loop wakes it. */
async function scheduleTask(
  task: TaskRow,
  at: Date,
  followUp: FollowUp,
  note: { detail: string; message: string; summary: string; orgKey: string | null },
): Promise<boolean> {
  const moved = await transitionTask(task.id, "scheduled", { wakeAt: at, followUp, statusDetail: note.detail }, ["reviewing"]);
  if (!moved) return false;
  await recordEvent({
    userId: task.userId,
    taskId: task.id,
    orgKey: note.orgKey ?? task.orgKey,
    type: "followup.required",
    summary: note.summary,
    data: { wakeAt: at.toISOString(), reason: followUp.reason },
  });
  await notify({ userId: task.userId, taskId: task.id, kind: "update", body: note.message, dedupeKey: `sched:${task.id}:${moved.version}` });
  return false; // nothing to do until then
}

/**
 * "phone_comcast" → the task's target it names. Generic keys ("phone_number",
 * "phone_mobile") name nobody: that's usually the user's own number, and must
 * never become a business's.
 */
export function phoneTarget(key: string, task: Pick<TaskRow, "targets">): string | null {
  const rest = key.replace(/^phone[_-]?/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const exact = task.targets.find((t) => orgKeyFor(t.name) === rest);
  if (exact) return exact.name;
  if (!rest || /^(number|mobile|cell|callback|call-back|contact|home|work|user|customer|your|my|best|direct|main|personal)(-|$)/.test(rest)) return null;
  const flat = (k: string) => k.replace(/-/g, "");
  return (
    task.targets.find((t) => {
      const k = flat(orgKeyFor(t.name));
      return k === flat(rest) || (flat(rest).length >= 4 && (k.startsWith(flat(rest)) || flat(rest).startsWith(k)));
    })?.name ?? null
  );
}

/** reviewing → needs_info: the business needs a detail only the user has, or the number was wrong. */
async function askForInfo(task: TaskRow, user: UserRow, d: DecideResult, lastCall: CallRow | undefined): Promise<boolean> {
  const targetName = d.callback?.targetName ?? lastCall?.targetName ?? task.targets[0]?.name ?? "the business";
  const asked = d.infoFields.length
    ? d.infoFields
    : (lastCall?.analysis?.infoRequested ?? []).map((r) => ({
        key: r.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
        label: r.label,
        question: `What's the ${r.label.toLowerCase()}?`,
        sensitive: true,
      }));
  const secrets = asked.filter((f) => SECRET_FIELD.test(`${f.key} ${f.label} ${f.question}`));
  const fields: InfoField[] = [];
  for (const f of asked) {
    if (secrets.includes(f)) continue;
    const key = /^phone/i.test(f.key) ? `phone_${orgKeyFor(phoneTarget(f.key, task) ?? targetName)}` : f.key;
    if (!fields.some((x) => x.key === key)) fields.push({ ...f, key, required: true });
  }
  if (!fields.length) {
    // Only things Telo never handles (a PIN, a password): the user has to deal with them directly.
    const what = secrets.map((f) => f.label.toLowerCase()).join(" and ") || "a detail only you can give them";
    return finalize(
      task.id,
      "failed",
      { outcome: "failed", summary: `${targetName} needs ${what} from you directly.`, confirmation: null },
      `${targetName} won't go further without ${what}. I never ask for or share that, so you'll need to call them for this part.`,
    );
  }

  // A wrong number is dropped so nothing dials it again.
  const phoneKeys = fields.filter((f) => f.key.startsWith("phone_")).map((f) => f.key.slice("phone_".length));
  const targets = task.targets.map((t) => (phoneKeys.includes(orgKeyFor(t.name)) ? { ...t, phone: null } : t));
  if (lastCall?.targetPhone) {
    for (const key of phoneKeys) {
      await db.update(organizations).set({ phone: null }).where(and(eq(organizations.key, key), eq(organizations.phone, lastCall.targetPhone)));
    }
  }

  const labels = fields.map((f) => f.label).join(", ");
  // If something secret was dropped, the model's text may still ask for it: write our own.
  const prompt = (!secrets.length && d.userMessage) || `${targetName} needs ${fields.map((f) => f.label.toLowerCase()).join(" and ")} to keep going. ${fields.map((f) => f.question).join(" ")}`;
  const questionId = await createQuestion(task, "info", prompt, fields, [], { callId: lastCall?.id ?? null });
  const callback = d.callback ?? {
    targetName,
    purpose: phoneKeys.length ? `Call ${targetName} at the right number` : `Give ${targetName} the details they asked for`,
    objective: task.goal ?? task.request,
    talkingPoints: [],
  };
  // "Call back during business hours with it": an answer that arrives before then waits for that time.
  const later = d.scheduleAt ?? lastCall?.analysis?.callbackAt;
  const moved = await transitionTask(
    task.id,
    "needs_info",
    {
      targets,
      followUp: { reason: "callback", userDecision: task.followUp?.userDecision ?? null, callback },
      wakeAt: later ? callbackTime(later, user.timezone).at : null,
      statusDetail: `Waiting on you: ${labels}`,
    },
    ["reviewing"],
  );
  if (!moved) return false;
  await recordEvent({ userId: task.userId, taskId: task.id, orgKey: orgKeyFor(targetName), type: "task.info_requested", summary: `${targetName} asked for: ${labels}` });
  await notify({ userId: task.userId, taskId: task.id, kind: "question", body: prompt, dedupeKey: `q:${questionId}` });
  return false;
}

async function analyze(task: TaskRow, call: CallRow, user: UserRow): Promise<CallAnalysis> {
  const empty = {
    facts: [],
    offers: [],
    commitments: [],
    priorCommitments: [],
    confirmationNumbers: [],
    repName: null,
    quote: null,
    decisionNeeded: null,
    callbackAt: null,
    infoRequested: [],
    booking: null,
  };
  if (call.status === "canceled") return { ...empty, outcome: "failed", summary: "The call was cancelled.", nextStep: "None." };
  // Anyone who spoke gets read by the model, including a call that dropped halfway.
  const spoke = call.transcript.some((t) => t.speaker === "other");
  if (!spoke) {
    const reason = call.endReason ?? "";
    if (reason === "no-answer" || reason === "busy" || call.status === "ended") {
      return { ...empty, outcome: "no_answer", summary: reason === "busy" ? "The line was busy." : "Nobody picked up.", nextStep: "Try again." };
    }
    return { ...empty, outcome: "failed", summary: `The call didn't go through${call.statusDetail ? ` (${call.statusDetail})` : ""}.`, nextStep: "Decide whether to retry." };
  }
  return agent.analyzeCall({
    now: now(user),
    direction: call.direction,
    task: { title: task.title, goal: task.goal },
    agentWasGiven: call.direction === "outbound" ? shareableDetails(user.name, call.brief, task.facts) : null,
    leg: call.brief,
    transcript: call.transcript,
    endReason: call.endReason,
    history: task.memory?.summary ?? null,
  });
}

const OUTCOME_FOR_KEEWANO: Record<CallAnalysis["outcome"], string> = {
  success: "resolved",
  partial: "partial",
  needs_user_decision: "escalated",
  callback_required: "callback_scheduled",
  failed: "dropped",
  no_answer: "no_answer",
  voicemail: "voicemail",
  wrong_number: "dropped",
};

/** Turns one analyzed call into memory events. Spaced a second apart so Keewano's per-second grouping stays unambiguous. */
async function recordCallOutcome(task: TaskRow, call: CallRow, a: CallAnalysis) {
  const base = { userId: task.userId, taskId: task.id, callId: call.id, orgKey: call.orgKey };
  // One second apart (Keewano groups context by second), ending now, so
  // anything recorded after this (task.completed) still sorts last.
  const count = 2 + a.facts.length + a.offers.length + a.priorCommitments.length + a.commitments.length + a.confirmationNumbers.length;
  let t = Math.max((call.endedAt ?? new Date()).getTime(), Date.now() - (count + 1) * 1000);
  const at = () => new Date((t += 1000));
  const conf = a.confirmationNumbers[0];
  const reached = !["no_answer", "voicemail", "failed", "wrong_number"].includes(a.outcome);

  await recordEvent({
    ...base,
    id: `evt_end_${call.id}`,
    type: reached ? "call.completed" : "call.failed",
    summary: `Call with ${call.targetName}: ${a.summary}`,
    data: { outcome: a.outcome, repName: a.repName, durationSec: call.durationSec },
    typed: { outcome: OUTCOME_FOR_KEEWANO[a.outcome], durationSeconds: call.durationSec ?? undefined },
    occurredAt: at(),
  });
  for (const f of a.facts) {
    await recordEvent({ ...base, type: "business.fact_discovered", summary: `${f.label}: ${f.value}`, occurredAt: at() });
  }
  for (const o of a.offers) {
    await recordEvent({
      ...base,
      type: "offer.received",
      summary: `${call.targetName} offered: ${o.description}`,
      typed: { offerKind: o.kind, amountCents: o.priceUsd != null ? Math.round(o.priceUsd * 100) : undefined },
      occurredAt: at(),
    });
  }
  for (const p of a.priorCommitments) {
    if (p.status === "reaffirmed") continue;
    await recordEvent({
      ...base,
      type: p.status === "fulfilled" ? "commitment.fulfilled" : "commitment.broken",
      summary: `${p.status === "fulfilled" ? "Kept" : "Broken"} promise: ${p.description}${p.confirmationNumber ? ` (ref ${p.confirmationNumber})` : ""}`,
      typed: { commitmentKind: p.kind, confirmationNumber: p.confirmationNumber ?? undefined },
      occurredAt: at(),
    });
  }
  for (const c of a.commitments.filter((x) => x.by === "business")) {
    await recordEvent({
      ...base,
      type: "commitment.received",
      summary: `${call.targetName} promised: ${c.description}${conf ? ` (confirmation ${conf})` : ""}`,
      typed: {
        commitmentKind: c.kind,
        amountCents: c.amountUsd != null ? Math.round(c.amountUsd * 100) : undefined,
        dueAt: c.due && !Number.isNaN(Date.parse(c.due)) ? new Date(c.due).toISOString() : undefined,
        confirmationNumber: conf,
      },
      occurredAt: at(),
    });
  }
  for (const n of a.confirmationNumbers) {
    await recordEvent({
      ...base,
      type: "confirmation.received",
      summary: `Confirmation ${n} from ${call.targetName}`,
      typed: { confirms: confirmsKind(task, a), confirmationNumber: n },
      occurredAt: at(),
    });
  }
  await recordEvent({ ...base, type: "call.transcript_processed", summary: `Read the ${call.targetName} call: ${a.outcome.replace(/_/g, " ")}`, occurredAt: at() });

  const learned: Fact[] = [
    ...a.confirmationNumbers.map((n, i) => ({ key: `confirmation_${call.seq}_${i}`, label: `Confirmation from ${call.targetName}`, value: n, sensitive: false, source: "call" as const })),
    ...(a.repName ? [{ key: `rep_${call.seq}`, label: `Rep at ${call.targetName}`, value: a.repName, sensitive: false, source: "call" as const }] : []),
    ...(a.quote?.priceUsd != null ? [{ key: `quote_${call.seq}`, label: `Quote from ${call.targetName}`, value: `$${a.quote.priceUsd}${a.quote.availability ? `, ${a.quote.availability}` : ""}`, sensitive: false, source: "call" as const }] : []),
  ];
  if (learned.length) {
    const fresh = (await getTask(task.id))!;
    await patchTask(task.id, { facts: mergeFacts(fresh.facts, learned) });
  }
}

function confirmsKind(task: TaskRow, a: CallAnalysis): string {
  const c = a.commitments[0]?.kind;
  if (c === "cancellation") return "cancellation";
  if (c === "account_credit" || c === "refund") return "credit";
  if (c === "appointment" || c === "reservation") return "appointment";
  if (task.category === "reservation" || task.category === "quotes") return "appointment";
  if (task.category === "membership") return "cancellation";
  if (task.category === "support") return "dispute";
  return "other";
}

/** Ends a task, redacts task-scoped sensitive facts, and tells the user. */
async function finalize(taskId: string, status: Extract<TaskStatus, "completed" | "failed">, result: TaskResult, message: string): Promise<boolean> {
  const task = (await getTask(taskId))!;
  const moved = await transitionTask(
    taskId,
    status,
    {
      result,
      completedAt: new Date(),
      statusDetail: status === "completed" ? "Done" : "Stopped",
      followUp: null,
      wakeAt: null,
      facts: task.facts.map(redactFact), // temporary task context: sensitive values aren't kept after the task
    },
    [task.status],
  );
  if (!moved) return false;
  // A retry that was queued but is no longer needed (they called back first, say).
  await db.update(calls).set({ status: "canceled", finishedAt: new Date() }).where(and(eq(calls.taskId, taskId), eq(calls.status, "planned")));
  const onCalendar = status === "completed" ? await addBookingToCalendar(task, result.confirmation) : "";
  await recordEvent({
    userId: task.userId,
    taskId,
    orgKey: task.orgKey,
    type: status === "completed" ? "task.completed" : "task.failed",
    summary: `${status === "completed" ? "Finished" : "Stopped"}: ${result.summary}`,
    typed: { outcome: status === "completed" ? (result.outcome === "success" ? "resolved" : result.outcome) : "failed" },
  });
  await notify({
    userId: task.userId,
    taskId,
    kind: status === "completed" ? "result" : "failure",
    body: `${(message || result.summary).trim()}${onCalendar}`,
    dedupeKey: `done:${taskId}:${status}`,
  });
  return false;
}

/** Puts the appointment a call booked on the user's calendar. Returns a few words for the result text. */
async function addBookingToCalendar(task: TaskRow, confirmation: string | null): Promise<string> {
  const cal = getCalendar();
  if (!cal || !config.calendar.addBookings) return "";
  const call = (await listCalls(task.id)).filter((c) => c.kind === "business" && c.analysis?.booking && ["success", "partial"].includes(c.analysis.outcome)).at(-1);
  const booking = call?.analysis?.booking;
  const start = booking ? new Date(booking.startsAt) : null;
  if (!call || !booking || !start || Number.isNaN(start.getTime()) || start.getTime() < Date.now() - 3600_000) return "";
  const parsedEnd = booking.endsAt ? new Date(booking.endsAt) : null;
  const end = parsedEnd && !Number.isNaN(parsedEnd.getTime()) && parsedEnd > start ? parsedEnd : new Date(start.getTime() + 3600_000);
  const tz = (await getUser(task.userId))?.timezone ?? config.user.timezone;
  try {
    const ev = await cal.createEvent({
      title: booking.title,
      start,
      end,
      timeZone: tz,
      location: booking.location,
      description: [`Booked by Telo with ${call.targetName}.`, confirmation ? `Confirmation ${confirmation}.` : ""].filter(Boolean).join(" "),
    });
    await recordEvent({
      userId: task.userId,
      taskId: task.id,
      orgKey: call.orgKey,
      type: "calendar.event_created",
      summary: `Added to your calendar: ${booking.title}, ${formatWhen(start, tz, { absolute: true })}`,
      data: { eventId: ev.id, link: ev.link },
    });
    return " It's on your calendar.";
  } catch (err) {
    console.error("[calendar] couldn't add the booking", err);
    return " I couldn't add it to your calendar.";
  }
}

/** Stops a task and any call in flight. */
export async function cancelTask(taskId: string, reason: string): Promise<boolean> {
  const task = await getTask(taskId);
  if (!task) return false;
  const moved = await transitionTask(taskId, "cancelled", { statusDetail: "Cancelled", completedAt: new Date(), wakeAt: null, result: { outcome: "cancelled", summary: reason, confirmation: null }, facts: task.facts.map(redactFact) });
  if (!moved) return false;
  for (const c of await listCalls(taskId)) {
    if (c.status === "planned") await db.update(calls).set({ status: "canceled", finishedAt: new Date() }).where(eq(calls.id, c.id));
    else if (c.providerCallId && ["queued", "ringing", "in_progress"].includes(c.status)) await getVoice().stopCall(c.providerCallId).catch(() => {});
  }
  await recordEvent({ userId: task.userId, taskId, orgKey: task.orgKey, type: "task.cancelled", summary: `Cancelled: ${reason}`, typed: { outcome: "abandoned" } });
  return true;
}

export type { TypedFacts };
