import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type {
  ApprovalOption,
  Authority,
  CallAnalysis,
  CallBrief,
  CallStatus,
  Channel,
  Fact,
  FollowUp,
  InfoField,
  MemoryBrief,
  Plan,
  QuestionKind,
  TaskCategory,
  TaskResult,
  TaskStatus,
  TaskTarget,
  TranscriptTurn,
  TypedFacts,
} from "../domain/types";

// Operational state lives here (SQLite through libsql). The long-term,
// chronological interaction history is mirrored to the memory provider
// (Keewano when configured) from the `events` table.

const createdAt = () => integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date());
const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone"),
  channel: text("channel").$type<Channel>().notNull().default("sms"),
  timezone: text("timezone").notNull().default("America/Los_Angeles"),
  preferences: text("preferences", { mode: "json" }).$type<string[]>().notNull().$defaultFn(() => []),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const organizations = sqliteTable("organizations", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone"),
  aliases: text("aliases", { mode: "json" }).$type<string[]>().notNull().$defaultFn(() => []),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    request: text("request").notNull(),
    source: text("source").$type<Channel>().notNull(),
    status: text("status").$type<TaskStatus>().notNull(),
    statusDetail: text("status_detail"),
    category: text("category").$type<TaskCategory>(),
    goal: text("goal"),
    sourceRef: text("source_ref"), // the message or call that created the task
    orgKey: text("org_key"), // primary business, for memory lookups
    targets: text("targets", { mode: "json" }).$type<TaskTarget[]>().notNull().$defaultFn(() => []),
    facts: text("facts", { mode: "json" }).$type<Fact[]>().notNull().$defaultFn(() => []),
    constraints: text("constraints", { mode: "json" }).$type<string[]>().notNull().$defaultFn(() => []),
    authority: text("authority", { mode: "json" }).$type<Authority | null>(),
    plan: text("plan", { mode: "json" }).$type<Plan | null>(),
    memory: text("memory", { mode: "json" }).$type<MemoryBrief | null>(),
    result: text("result", { mode: "json" }).$type<TaskResult | null>(),
    // Set when the user decided something or a call asked for a callback;
    // the next review/plan step consumes it.
    followUp: text("follow_up", { mode: "json" }).$type<FollowUp | null>(),
    version: integer("version").notNull().default(0),
    stepFailures: integer("step_failures").notNull().default(0),
    wakeAt: integer("wake_at", { mode: "timestamp_ms" }), // for status "scheduled"

    lastError: text("last_error"),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tasks_user_status_idx").on(t.userId, t.status)],
);

export const calls = sqliteTable(
  "calls",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    taskId: text("task_id"), // null for the user's own inbound calls to Telo
    direction: text("direction").$type<"outbound" | "inbound">().notNull(),
    // business: Telo calling a business for a task. user_update: Telo calling
    // the user (voice channel). user_inbound: the user calling Telo.
    kind: text("kind").$type<"business" | "user_update" | "user_inbound">().notNull().default("business"),
    seq: integer("seq").notNull().default(0),
    attempt: integer("attempt").notNull().default(1),
    orgKey: text("org_key"),
    targetName: text("target_name").notNull(),
    targetPhone: text("target_phone"),
    purpose: text("purpose").notNull(),
    brief: text("brief", { mode: "json" }).$type<CallBrief | null>(),
    instructions: text("instructions"),
    status: text("status").$type<CallStatus>().notNull(),
    statusDetail: text("status_detail"),
    provider: text("provider"),
    providerCallId: text("provider_call_id"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    answeredAt: integer("answered_at", { mode: "timestamp_ms" }),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
    durationSec: integer("duration_sec"),
    endReason: text("end_reason"),
    transcript: text("transcript", { mode: "json" }).$type<TranscriptTurn[]>().notNull().$defaultFn(() => []),
    recordingUrl: text("recording_url"),
    analysis: text("analysis", { mode: "json" }).$type<CallAnalysis | null>(),
    analyzedAt: integer("analyzed_at", { mode: "timestamp_ms" }),
    // Set once the call is over AND its transcript (if any) is in.
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("calls_provider_call_idx").on(t.providerCallId),
    uniqueIndex("calls_leg_idx").on(t.taskId, t.seq, t.attempt),
    index("calls_task_idx").on(t.taskId),
  ],
);

// One row per inbox message Telo has looked at, so none is read twice. Only
// what Telo extracted is kept: never the body, and the subject only for mail
// that mattered.
export const emails = sqliteTable(
  "emails",
  {
    id: text("id").primaryKey(), // the provider's message id
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(),
    status: text("status").$type<"new" | "skipped" | "ignored" | "processed" | "failed">().notNull(), // skipped: already in the inbox when Gmail was connected
    fromDomain: text("from_domain"),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }),
    subject: text("subject"),
    business: text("business"),
    orgKey: text("org_key"),
    kind: text("kind"),
    summary: text("summary"),
    amountCents: integer("amount_cents"),
    confirmationNumber: text("confirmation_number"),
    taskId: text("task_id"),
    needsCall: integer("needs_call", { mode: "boolean" }),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("emails_task_idx").on(t.taskId)],
);

export const questions = sqliteTable(
  "questions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    taskId: text("task_id").notNull(),
    kind: text("kind").$type<QuestionKind>().notNull(),
    prompt: text("prompt").notNull(),
    fields: text("fields", { mode: "json" }).$type<InfoField[]>().notNull().$defaultFn(() => []),
    options: text("options", { mode: "json" }).$type<ApprovalOption[]>().notNull().$defaultFn(() => []),
    context: text("context", { mode: "json" }).$type<Record<string, unknown>>().notNull().$defaultFn(() => ({})),
    status: text("status").$type<"open" | "answered" | "cancelled">().notNull().default("open"),
    answer: text("answer", { mode: "json" }).$type<Record<string, unknown> | null>(),
    answeredAt: integer("answered_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("questions_task_idx").on(t.taskId, t.status)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    taskId: text("task_id"),
    direction: text("direction").$type<"in" | "out">().notNull(),
    channel: text("channel").$type<Channel>().notNull(),
    kind: text("kind").notNull().default("chat"),
    body: text("body").notNull(),
    dedupeKey: text("dedupe_key"),
    provider: text("provider"),
    providerMessageId: text("provider_message_id"),
    status: text("status").$type<"received" | "queued" | "sent" | "delivered" | "failed">().notNull(),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("messages_dedupe_idx").on(t.dedupeKey),
    uniqueIndex("messages_provider_idx").on(t.providerMessageId),
    index("messages_user_idx").on(t.userId, t.createdAt),
  ],
);

// Every meaningful thing that happens. This is the local timeline the UI
// shows and the outbox that feeds the memory provider (Keewano).
export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    taskId: text("task_id"),
    callId: text("call_id"),
    orgKey: text("org_key"),
    type: text("type").notNull(),
    summary: text("summary").notNull(),
    data: text("data", { mode: "json" }).$type<Record<string, unknown>>().notNull().$defaultFn(() => ({})),
    // The typed slice that is mirrored to Keewano. null = local-only event.
    typed: text("typed", { mode: "json" }).$type<TypedFacts | null>(),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
    memorySyncedAt: integer("memory_synced_at", { mode: "timestamp_ms" }),
    memorySyncError: text("memory_sync_error"),
    memorySyncAttempts: integer("memory_sync_attempts").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index("events_task_idx").on(t.taskId, t.occurredAt),
    index("events_org_idx").on(t.userId, t.orgKey, t.occurredAt),
    index("events_sync_idx").on(t.memorySyncedAt),
  ],
);

// One row per provider webhook delivery we have accepted. The primary key is
// the provider's event id, so a retried delivery is a no-op.
export const webhookReceipts = sqliteTable("webhook_receipts", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  type: text("type").notNull(),
  payload: text("payload", { mode: "json" }).$type<unknown>(),
  status: text("status").$type<"received" | "processed" | "failed" | "ignored">().notNull(),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
  processedAt: integer("processed_at", { mode: "timestamp_ms" }),
});

export const appState = sqliteTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>(),
  updatedAt: updatedAt(),
});

export type UserRow = typeof users.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type CallRow = typeof calls.$inferSelect;
export type QuestionRow = typeof questions.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type OrganizationRow = typeof organizations.$inferSelect;
