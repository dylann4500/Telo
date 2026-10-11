import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { CallDTO, LiveCallDTO, MessageDTO, QuestionDTO, StateDTO, TaskDetailDTO, TaskSummaryDTO } from "@/lib/types";
import { config } from "./config";
import { db } from "./db/client";
import { calls, events, messages, questions, tasks, type CallRow, type QuestionRow, type TaskRow } from "./db/schema";
import { pairingCode } from "./pairing";
import { redactFact } from "./redact";
import { buildFlow } from "./flow";
import { getUser } from "./tasks/repo";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

function liveCall(c: CallRow | undefined): LiveCallDTO | null {
  if (!c) return null;
  return { id: c.id, target: c.targetName, status: c.status, statusDetail: c.statusDetail, startedAt: iso(c.startedAt), answeredAt: iso(c.answeredAt) };
}

function questionDTO(q: QuestionRow): QuestionDTO {
  const ctx = q.context as { live?: boolean; target?: string; askedAt?: string };
  return {
    id: q.id,
    kind: q.kind,
    prompt: q.prompt,
    options: q.options,
    fields: q.fields.map((f) => ({ key: f.key, label: f.label })),
    status: q.status,
    answeredAt: iso(q.answeredAt),
    live: ctx.live ? { target: ctx.target ?? "The business", askedAt: ctx.askedAt ?? q.createdAt.toISOString() } : null,
  };
}

function summary(t: TaskRow, taskCalls: CallRow[], open: QuestionRow | undefined): TaskSummaryDTO {
  const business = taskCalls.filter((c) => c.kind === "business");
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    statusDetail: t.statusDetail,
    category: t.category,
    targets: t.targets.map((x) => x.name),
    source: t.source,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    live: liveCall(business.find((c) => ["queued", "ringing", "in_progress"].includes(c.status))),
    waiting: open ? questionDTO(open) : null,
    result: t.result,
    memoryUsed: Boolean(t.memory?.summary),
    callsMade: business.filter((c) => c.finishedAt).length,
    wakeAt: t.status === "scheduled" ? iso(t.wakeAt) : null,
  };
}

export async function buildState(userId: string): Promise<StateDTO> {
  const user = await getUser(userId);
  const taskRows = await db.select().from(tasks).where(eq(tasks.userId, userId)).orderBy(desc(tasks.updatedAt)).limit(40);
  const ids = taskRows.map((t) => t.id);
  const callRows = ids.length ? await db.select().from(calls).where(inArray(calls.taskId, ids)) : [];
  const openQs = ids.length ? await db.select().from(questions).where(inArray(questions.taskId, ids)) : [];
  const msgRows = await db.select().from(messages).where(eq(messages.userId, userId)).orderBy(desc(messages.createdAt)).limit(80);
  const userCall = await db.query.calls.findFirst({
    where: eq(calls.kind, "user_inbound"),
    orderBy: desc(calls.createdAt),
  });
  return {
    modes: {
      llm: config.llm.provider,
      voice: config.voice.provider,
      memory: config.memory.provider,
      mail: config.mail.provider,
      calendar: config.calendar.provider,
      devTools: config.demo.devTools,
    },
    user: {
      name: user?.name ?? config.user.name,
      phone: user?.phone ?? null,
      channel: user?.channel ?? config.user.channel,
      callUpdates: user?.callUpdates ?? config.user.callUpdates,
      // The latest text to the user didn't arrive (carriers block an unregistered number).
      textsFailing: msgRows.find((m) => m.direction === "out" && ["sms", "imessage", "whatsapp"].includes(m.channel))?.status === "failed",
    },
    teloPhone: config.voice.teloPhone,
    tasks: taskRows.map((t) =>
      summary(
        t,
        callRows.filter((c) => c.taskId === t.id),
        openQs.filter((q) => q.taskId === t.id && q.status === "open").at(-1),
      ),
    ),
    messages: msgRows.reverse().map(messageDTO),
    liveUserCall: userCall && ["ringing", "in_progress"].includes(userCall.status) ? liveCall(userCall) : null,
    pairingCode: config.voice.provider === "dial" && config.voice.teloPhone ? await pairingCode() : null,
    lastKeewanoQuery: await lastKeewanoQuery(userId),
  };
}

/** askKeewano records its SQL as a task-less memory.retrieved event; the home screen shows the latest one. */
async function lastKeewanoQuery(userId: string): Promise<StateDTO["lastKeewanoQuery"]> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.userId, userId), eq(events.type, "memory.retrieved"), isNull(events.taskId)))
    .orderBy(desc(events.occurredAt))
    .limit(10);
  const e = rows.find((r) => (r.data as { via?: string }).via === "keewano-sql");
  if (!e) return null;
  const d = e.data as { sql?: string; rows?: number; ms?: number; answer?: string };
  return {
    question: e.summary.replace(/^Asked Keewano:\s*"?/, "").replace(/"$/, ""),
    answer: d.answer ?? null,
    sql: d.sql ?? "",
    rows: Number(d.rows ?? 0),
    ms: Number(d.ms ?? 0),
    at: e.occurredAt.toISOString(),
  };
}

function messageDTO(m: typeof messages.$inferSelect): MessageDTO {
  return {
    id: m.id,
    direction: m.direction,
    channel: m.channel,
    kind: m.kind,
    body: m.body,
    status: m.status,
    error: m.error,
    taskId: m.taskId,
    createdAt: m.createdAt.toISOString(),
  };
}

function callDTO(c: CallRow): CallDTO {
  return {
    id: c.id,
    kind: c.kind,
    direction: c.direction,
    seq: c.seq,
    attempt: c.attempt,
    targetName: c.targetName,
    purpose: c.purpose,
    status: c.status,
    statusDetail: c.statusDetail,
    startedAt: iso(c.startedAt),
    answeredAt: iso(c.answeredAt),
    endedAt: iso(c.endedAt),
    durationSec: c.durationSec,
    endReason: c.endReason,
    transcript: c.transcript.map((t) => ({ speaker: t.speaker, text: t.text })),
    analysis: c.analysis
      ? {
          outcome: c.analysis.outcome,
          summary: c.analysis.summary,
          facts: c.analysis.facts,
          offers: c.analysis.offers.map((o) => ({ kind: o.kind, description: o.description, priceUsd: o.priceUsd })),
          commitments: c.analysis.commitments.map((x) => ({ kind: x.kind, description: x.description, amountUsd: x.amountUsd })),
          priorCommitments: c.analysis.priorCommitments ?? [],
          confirmationNumbers: c.analysis.confirmationNumbers,
          repName: c.analysis.repName,
          nextStep: c.analysis.nextStep,
        }
      : null,
    instructions: c.instructions,
  };
}

export async function buildTaskDetail(taskId: string): Promise<TaskDetailDTO | null> {
  const t = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  if (!t) return null;
  const taskCalls = await db.select().from(calls).where(eq(calls.taskId, taskId)).orderBy(asc(calls.createdAt));
  const qs = await db.select().from(questions).where(eq(questions.taskId, taskId)).orderBy(asc(questions.createdAt));
  const evs = await db.select().from(events).where(eq(events.taskId, taskId)).orderBy(asc(events.occurredAt), asc(events.createdAt));
  const msgs = await db.select().from(messages).where(eq(messages.taskId, taskId));
  const tz = (await getUser(t.userId))?.timezone ?? config.user.timezone;
  return {
    ...summary(t, taskCalls, qs.filter((q) => q.status === "open").at(-1)),
    request: t.request,
    goal: t.goal,
    facts: t.facts.map(redactFact).map((f) => ({ key: f.key, label: f.label, value: f.value, sensitive: f.sensitive, source: f.source })),
    constraints: t.constraints,
    authority: t.authority,
    plan: t.plan ? { strategy: t.plan.strategy, parallel: t.plan.parallel, legs: t.plan.legs.map((l) => ({ targetName: l.targetName, purpose: l.purpose, objective: l.objective })) } : null,
    memory: t.memory ? { ...t.memory, trace: t.memory.trace ?? [] } : null,
    calls: taskCalls.filter((c) => c.status !== "planned" || c.kind === "business").map(callDTO),
    questions: qs.map(questionDTO),
    events: evs.map((e) => ({
      id: e.id,
      type: e.type,
      summary: e.summary,
      occurredAt: e.occurredAt.toISOString(),
      mirrored: Boolean(e.typed),
      synced: Boolean(e.memorySyncedAt),
      syncError: e.memorySyncError,
    })),
    flow: buildFlow(t, taskCalls, evs, msgs, tz, config.memory.provider),
    lastError: t.lastError,
  };
}
