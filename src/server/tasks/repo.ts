import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  calls,
  messages,
  organizations,
  questions,
  tasks,
  users,
  type CallRow,
  type QuestionRow,
  type TaskRow,
  type UserRow,
} from "../db/schema";
import { canTransition, sourcesFor } from "../domain/state-machine";
import { TERMINAL_STATUSES, type TaskStatus } from "../domain/types";

export type TaskPatch = Partial<Omit<TaskRow, "id" | "userId" | "createdAt" | "version">>;

export async function getTask(id: string): Promise<TaskRow | undefined> {
  return db.query.tasks.findFirst({ where: eq(tasks.id, id) });
}

export async function getUser(id: string): Promise<UserRow | undefined> {
  return db.query.users.findFirst({ where: eq(users.id, id) });
}

export async function getUserByPhone(phone: string): Promise<UserRow | undefined> {
  const digits = phone.replace(/\D/g, "").slice(-10);
  if (digits.length < 10) return undefined;
  const all = await db.select().from(users);
  return all.find((u) => u.phone && u.phone.replace(/\D/g, "").slice(-10) === digits);
}

export async function listActiveTasks(userId: string): Promise<TaskRow[]> {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.userId, userId), notInArray(tasks.status, [...TERMINAL_STATUSES])))
    .orderBy(desc(tasks.updatedAt));
}

export async function listRecentTasks(userId: string, limit = 30): Promise<TaskRow[]> {
  return db.select().from(tasks).where(eq(tasks.userId, userId)).orderBy(desc(tasks.updatedAt)).limit(limit);
}

/** Applies a patch only if the task is still in one of `expect` states. Returns the new row or null. */
export async function patchTask(id: string, patch: TaskPatch, expect?: readonly TaskStatus[]): Promise<TaskRow | null> {
  const where = expect?.length ? and(eq(tasks.id, id), inArray(tasks.status, [...expect])) : eq(tasks.id, id);
  const rows = await db
    .update(tasks)
    .set({ ...patch, version: sql`${tasks.version} + 1`, updatedAt: new Date() })
    .where(where)
    .returning();
  return rows[0] ?? null;
}

/**
 * Moves a task to `to` if that is a legal move from its current state (or
 * from `from`, when given). Returns null when another writer got there first.
 */
export async function transitionTask(
  id: string,
  to: TaskStatus,
  patch: TaskPatch = {},
  from?: readonly TaskStatus[],
): Promise<TaskRow | null> {
  const allowed = (from ?? sourcesFor(to)).filter((s) => canTransition(s, to));
  if (!allowed.length) throw new Error(`No legal transition into ${to}`);
  return patchTask(id, { ...patch, status: to }, allowed);
}

export async function listCalls(taskId: string): Promise<CallRow[]> {
  return db.select().from(calls).where(eq(calls.taskId, taskId)).orderBy(asc(calls.seq), asc(calls.attempt));
}

export async function getCallByProviderId(providerCallId: string): Promise<CallRow | undefined> {
  return db.query.calls.findFirst({ where: eq(calls.providerCallId, providerCallId) });
}

export async function getCall(id: string): Promise<CallRow | undefined> {
  return db.query.calls.findFirst({ where: eq(calls.id, id) });
}

export async function openQuestion(taskId: string): Promise<QuestionRow | undefined> {
  return db.query.questions.findFirst({
    where: and(eq(questions.taskId, taskId), eq(questions.status, "open")),
    orderBy: desc(questions.createdAt),
  });
}

export async function listQuestions(taskId: string): Promise<QuestionRow[]> {
  return db.select().from(questions).where(eq(questions.taskId, taskId)).orderBy(asc(questions.createdAt));
}

/** The call is still on (queued, ringing or connected). */
export async function callIsLive(callId: string | null | undefined): Promise<boolean> {
  if (!callId) return false;
  const c = await getCall(callId);
  return Boolean(c && ["queued", "ringing", "in_progress"].includes(c.status));
}

/** The question Telo asked the user during a call that's still going (a business is waiting on the line). */
export async function openLiveQuestion(taskId: string): Promise<QuestionRow | undefined> {
  const q = await openQuestion(taskId);
  return q && (q.context as { live?: boolean }).live ? q : undefined;
}

export async function recentMessages(userId: string, limit = 12) {
  const rows = await db.select().from(messages).where(eq(messages.userId, userId)).orderBy(desc(messages.createdAt)).limit(limit);
  return rows.reverse();
}

export async function listOrganizations() {
  return db.select().from(organizations).orderBy(asc(organizations.name));
}
