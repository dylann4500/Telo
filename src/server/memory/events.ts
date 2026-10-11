import { and, asc, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import { events } from "../db/schema";
import type { EntityRefs, TypedFacts } from "../domain/types";
import { newId } from "../ids";
import { maskSecrets } from "../redact";
import { getMemory } from "./index";
import { KeewanoFatalError } from "./keewano";
import { rowToMemoryEvent } from "./local";

// Every meaningful thing Telo does or learns is recorded here. The row is
// the local timeline (shown in the UI) and an outbox for the memory
// provider: events with a `typed` slice are mirrored to Keewano.

export type TeloEventType =
  | "task.created"
  | "task.info_requested"
  | "task.info_received"
  | "task.plan_generated"
  | "memory.retrieved"
  | "call.started"
  | "call.connected"
  | "call.completed"
  | "call.failed"
  | "call.transcript_processed"
  | "business.fact_discovered"
  | "offer.received"
  | "offer.accepted"
  | "offer.declined"
  | "commitment.received"
  | "commitment.fulfilled"
  | "commitment.broken"
  | "confirmation.received"
  | "approval.requested"
  | "approval.granted"
  | "approval.denied"
  | "followup.required"
  | "task.completed"
  | "task.failed"
  | "task.cancelled"
  | "message.sent"
  | "message.received"
  | "preference.saved"
  | "email.received"
  | "calendar.event_created"
  // During a call (local only): Telo asked the user while the business waited, or checked their calendar.
  | "call.asked_user"
  | "calendar.checked"
  // Property management (docs/property-management/research.md section 5.3).
  | "wo.opened"
  | "wo.deflected"
  | "emergency.routed"
  | "quote.received"
  | "vendor.declined"
  | "vendor.booked"
  | "entry_notice.sent"
  | "access.outcome"
  | "vendor.outcome"
  | "wo.completed"
  | "callback.opened"
  | "asset.registered"
  | "asset.repaired"
  | "asset.decision";

export interface RecordEventInput {
  id?: string; // pass a deterministic id when the same event may be recorded twice
  userId: string;
  taskId?: string | null;
  callId?: string | null;
  orgKey?: string | null;
  type: TeloEventType;
  summary: string;
  data?: Record<string, unknown>;
  typed?: TypedFacts | null;
  refs?: EntityRefs | null;
  occurredAt?: Date;
}

export async function recordEvent(input: RecordEventInput): Promise<string> {
  const id = input.id ?? newId("evt");
  await db
    .insert(events)
    .values({
      id,
      userId: input.userId,
      taskId: input.taskId ?? null,
      callId: input.callId ?? null,
      orgKey: input.orgKey ?? null,
      type: input.type,
      summary: maskSecrets(input.summary),
      data: input.data ?? {},
      typed: input.typed ?? null,
      refs: input.refs ?? null,
      occurredAt: input.occurredAt ?? new Date(),
    })
    .onConflictDoNothing();
  // Push to the memory provider right away; the background sweep retries failures.
  void syncPendingEvents(10).catch((err) => console.error("[memory] sync failed", err));
  return id;
}

const g = globalThis as unknown as { __teloSyncing?: boolean };

/** Mirrors unsynced events to the memory provider, oldest first. */
export async function syncPendingEvents(max = 50): Promise<number> {
  if (g.__teloSyncing) return 0;
  g.__teloSyncing = true;
  let synced = 0;
  try {
    const memory = getMemory();
    const pending = await db
      .select()
      .from(events)
      .where(and(isNull(events.memorySyncedAt), lt(events.memorySyncAttempts, 6)))
      .orderBy(asc(events.occurredAt))
      .limit(max);
    for (const row of pending) {
      if (memory.name === "local" || !row.typed) {
        await db.update(events).set({ memorySyncedAt: new Date() }).where(eq(events.id, row.id));
        continue;
      }
      try {
        await memory.record(rowToMemoryEvent(row));
        await db.update(events).set({ memorySyncedAt: new Date(), memorySyncError: null }).where(eq(events.id, row.id));
        synced++;
      } catch (err) {
        const fatal = err instanceof KeewanoFatalError;
        await db
          .update(events)
          .set({
            memorySyncError: (err as Error).message.slice(0, 500),
            memorySyncAttempts: fatal ? 99 : sql`${events.memorySyncAttempts} + 1`,
          })
          .where(eq(events.id, row.id));
        if (!fatal) break; // keep order: retry this one before later events
      }
    }
  } finally {
    g.__teloSyncing = false;
  }
  return synced;
}
