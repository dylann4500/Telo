import { and, eq, isNull } from "drizzle-orm";
import * as agent from "./agent";
import { renderCallInstructions } from "./agent/call-instructions";
import { config } from "./config";
import { db } from "./db/client";
import { calls, organizations, questions, type CallRow, type TaskRow, type UserRow } from "./db/schema";
import type {
  ApprovalOption,
  CallAnalysis,
  CallBrief,
  Fact,
  InfoField,
  MemoryBrief,
  TaskCategory,
  TaskResult,
  TaskStatus,
  TaskTarget,
  TypedFacts,
} from "./domain/types";
import { newId, orgKeyFor } from "./ids";
import { relationshipHistory } from "./memory";
import { recordEvent } from "./memory/events";
import { notify } from "./notify";
import { maskSecrets, redactFact } from "./redact";
import { getTask, getUser, listCalls, listOrganizations, listRecentTasks, patchTask, transitionTask } from "./tasks/repo";
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
  return new Date().toLocaleString("en-US", { timeZone: user.timezone, dateStyle: "full", timeStyle: "short" });
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

/** Fills in a phone number from the directory, the demo stand-in number, or (mock only) a fake one. */
function resolvePhone(name: string, given: string | null, directory: { name: string; phone: string | null; aliases: string[] }[]): string | null {
  if (given) return normalizePhone(given);
  const key = name.toLowerCase();
  const hit = directory.find((d) => d.name.toLowerCase() === key || d.aliases.some((a) => a.toLowerCase() === key));
  if (hit?.phone) return hit.phone;
  if (config.demo.targetPhone) return config.demo.targetPhone;
  return getVoice().name === "mock" ? fakePhone(name) : null;
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
  });

  const targets: TaskTarget[] = r.targets.map((t) => {
    const existing = task.targets.find((x) => x.name.toLowerCase() === t.name.toLowerCase());
    return { name: t.name, kind: t.kind, phone: resolvePhone(t.name, existing?.phone ?? t.phone, directory) };
  });
  for (const t of targets) await upsertOrganization(t);
  const facts = mergeFacts(task.facts, r.facts.map((f) => ({ ...f, source: "user" as const })));
  const missing: InfoField[] = r.missing.filter((m) => m.required && !facts.some((f) => f.key === m.key && f.value));
  for (const t of targets) {
    if (!t.phone) missing.push({ key: `phone_${orgKeyFor(t.name)}`, label: `${t.name}'s number`, question: `What's the number for ${t.name}?`, sensitive: false, required: true });
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

  const moved = await transitionTask(
    task.id,
    "ready",
    {
      plan: { strategy: p.strategy, parallel: p.parallel, legs: [...(task.plan?.legs ?? []), ...legs] },
      memory,
      followUp: null,
      statusDetail: `About to call ${legs.map((l) => l.targetName).join(", ")}`,
    },
    ["planning"],
  );
  if (!moved) return false;
  await recordEvent({ userId: task.userId, taskId: task.id, orgKey: task.orgKey, type: "task.plan_generated", summary: `Plan: ${p.strategy}`, data: { legs: legs.length } });
  if (!followUp) {
    await notify({ userId: task.userId, taskId: task.id, kind: "update", body: p.userUpdate, dedupeKey: `plan:${task.id}` });
  }
  return true;
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
  if (!call.targetPhone) {
    await fail("no phone number");
    return false;
  }
  try {
    const res = await getVoice().placeCall({
      callId: call.id,
      to: call.targetPhone,
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

/** reviewing → ready | planning | needs_approval | completed | failed. */
async function review(task: TaskRow): Promise<boolean> {
  const user = (await getUser(task.userId))!;
  for (const call of (await listCalls(task.id)).filter((c) => c.kind === "business" && c.finishedAt && !c.analysis)) {
    const analysis = await analyze(task, call);
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
  const d = await agent.decideNext({
    now: now(user),
    task: { title: fresh.title, goal: fresh.goal, request: fresh.request, category: fresh.category },
    constraints: fresh.constraints,
    authority: fresh.authority,
    calls: business
      .filter((c) => c.analysis)
      .map((c) => ({ id: c.id, target: c.targetName, purpose: c.purpose, attempt: c.attempt, status: c.status, analysis: c.analysis })),
    remainingLegs: remaining.map((c) => ({ target: c.targetName, purpose: c.purpose })),
    maxAttemptsPerLeg: config.calls.maxAttemptsPerLeg,
    latestDecision: fresh.followUp?.userDecision ?? null,
  });
  if (d.learnedFacts.length) {
    await patchTask(task.id, { facts: mergeFacts(fresh.facts, d.learnedFacts.map((f) => ({ ...f, sensitive: false, source: "call" as const }))) });
  }
  const lastCall = business.filter((c) => c.analysis).at(-1);

  switch (d.action) {
    case "complete":
      return finalize(task.id, "completed", d.result ?? { outcome: "success", summary: d.userMessage, confirmation: lastCall?.analysis?.confirmationNumbers[0] ?? null }, d.userMessage);
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
      await notify({ userId: task.userId, taskId: task.id, kind: "approval", body: d.userMessage || prompt, dedupeKey: `q:${questionId}` });
      return false;
    }
    case "next_call": {
      if (!remaining.length) return finalize(task.id, "completed", { outcome: "partial", summary: d.userMessage || "Finished the planned calls.", confirmation: null }, d.userMessage);
      const moved = await transitionTask(task.id, "ready", { statusDetail: `Next: ${remaining[0].targetName}`, followUp: null }, ["reviewing"]);
      if (moved && d.userMessage) await notify({ userId: task.userId, taskId: task.id, kind: "update", body: d.userMessage, dedupeKey: `upd:${task.id}:${moved.version}` });
      return Boolean(moved);
    }
    case "retry": {
      const failed = business.filter((c) => c.analysis && ["no_answer", "voicemail", "failed"].includes(c.analysis.outcome)).at(-1);
      if (!failed || failed.attempt >= config.calls.maxAttemptsPerLeg) {
        return finalize(task.id, "failed", { outcome: "failed", summary: `Couldn't reach ${failed?.targetName ?? "them"}.`, confirmation: null }, d.userMessage || `I couldn't reach ${failed?.targetName ?? "them"} after ${failed?.attempt ?? 1} tries. Want me to try again later?`);
      }
      await db.insert(calls).values({
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
      }).onConflictDoNothing();
      const moved = await transitionTask(task.id, "ready", { statusDetail: `Trying ${failed.targetName} again` }, ["reviewing"]);
      if (moved && d.userMessage) await notify({ userId: task.userId, taskId: task.id, kind: "update", body: d.userMessage, dedupeKey: `retry:${failed.id}` });
      return Boolean(moved);
    }
    case "callback": {
      const callback = d.callback ?? (lastCall ? { targetName: lastCall.targetName, purpose: "Follow up", objective: fresh.goal ?? fresh.request, talkingPoints: [] } : null);
      if (!callback) return finalize(task.id, "failed", { outcome: "failed", summary: "Nothing to follow up on.", confirmation: null }, d.userMessage);
      const moved = await transitionTask(
        task.id,
        "planning",
        { followUp: { reason: "callback", userDecision: fresh.followUp?.userDecision ?? null, callback }, statusDetail: `Calling ${callback.targetName} back` },
        ["reviewing"],
      );
      if (moved) {
        await recordEvent({ userId: task.userId, taskId: task.id, orgKey: orgKeyFor(callback.targetName), type: "followup.required", summary: `Calling ${callback.targetName} back: ${callback.purpose}` });
        if (d.userMessage) await notify({ userId: task.userId, taskId: task.id, kind: "update", body: d.userMessage, dedupeKey: `cb:${task.id}:${moved.version}` });
      }
      return Boolean(moved);
    }
  }
}

async function analyze(task: TaskRow, call: CallRow): Promise<CallAnalysis> {
  const empty = {
    facts: [],
    offers: [],
    commitments: [],
    priorCommitments: [],
    confirmationNumbers: [],
    repName: null,
    quote: null,
    decisionNeeded: null,
  };
  const spoke = call.transcript.some((t) => t.speaker === "other");
  if (!spoke || call.status === "failed" || call.status === "canceled") {
    const reason = call.endReason ?? "";
    if (reason === "no-answer" || reason === "busy" || (!spoke && call.status === "ended")) {
      return { ...empty, outcome: "no_answer", summary: reason === "busy" ? "The line was busy." : "Nobody picked up.", nextStep: "Try again." };
    }
    return {
      ...empty,
      outcome: "failed",
      summary: call.status === "canceled" ? "The call was cancelled." : `The call didn't go through${call.statusDetail ? ` (${call.statusDetail})` : ""}.`,
      nextStep: "Decide whether to retry.",
    };
  }
  return agent.analyzeCall({
    task: { title: task.title, goal: task.goal },
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
      facts: task.facts.map(redactFact), // temporary task context: sensitive values aren't kept after the task
    },
    [task.status],
  );
  if (!moved) return false;
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
    body: message || result.summary,
    dedupeKey: `done:${taskId}:${status}`,
  });
  return false;
}

/** Stops a task and any call in flight. */
export async function cancelTask(taskId: string, reason: string): Promise<boolean> {
  const task = await getTask(taskId);
  if (!task) return false;
  const moved = await transitionTask(taskId, "cancelled", { statusDetail: "Cancelled", completedAt: new Date(), result: { outcome: "cancelled", summary: reason, confirmation: null }, facts: task.facts.map(redactFact) });
  if (!moved) return false;
  for (const c of await listCalls(taskId)) {
    if (c.status === "planned") await db.update(calls).set({ status: "canceled", finishedAt: new Date() }).where(eq(calls.id, c.id));
    else if (c.providerCallId && ["queued", "ringing", "in_progress"].includes(c.status)) await getVoice().stopCall(c.providerCallId).catch(() => {});
  }
  await recordEvent({ userId: task.userId, taskId, orgKey: task.orgKey, type: "task.cancelled", summary: `Cancelled: ${reason}`, typed: { outcome: "abandoned" } });
  return true;
}

export type { TypedFacts };
