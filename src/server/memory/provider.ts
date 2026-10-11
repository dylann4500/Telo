import type { TypedFacts } from "../domain/types";

// Telo's event memory: the ordered history of what happened between the
// user, Telo and each business. Keewano is the real backend; the local
// provider reads the same events straight from SQLite for development.

export type EntityType = "user" | "task" | "org" | "call" | "relationship";

export interface EntityRef {
  type: EntityType;
  id: string;
}

export interface MemoryEvent {
  id: string;
  type: string; // e.g. "commitment.received"
  occurredAt: string; // ISO
  summary: string; // human-readable, already redacted
  data: Record<string, unknown>; // already redacted
  userId: string;
  taskId: string | null;
  callId: string | null;
  orgKey: string | null;
  typed: TypedFacts | null; // the part mirrored to Keewano; null = local-only
  source?: "keewano" | "local";
}

export interface TimelineQuery {
  limit?: number;
  types?: string[];
  before?: string;
  since?: string;
}

/** What a memory read did, so the UI can show the live query behind an answer. */
export interface MemoryTrace {
  via: "keewano-sql" | "local";
  request: string;
  ms: number;
  rows: number;
}

export interface MemoryProvider {
  readonly name: "keewano" | "local";
  /** Append one event to every entity sequence it belongs to. Must be idempotent on event.id. */
  record(event: MemoryEvent): Promise<void>;
  /** Ordered history for one entity, oldest first. */
  timeline(entity: EntityRef, query?: TimelineQuery): Promise<{ events: MemoryEvent[]; trace: MemoryTrace[] }>;
}

/** The entity sequences an event belongs to. One user x business pair is a "relationship". */
export function entitiesFor(e: Pick<MemoryEvent, "userId" | "taskId" | "callId" | "orgKey">): EntityRef[] {
  const refs: EntityRef[] = [{ type: "user", id: e.userId }];
  if (e.taskId) refs.push({ type: "task", id: e.taskId });
  if (e.callId) refs.push({ type: "call", id: e.callId });
  if (e.orgKey) {
    refs.push({ type: "org", id: e.orgKey });
    refs.push({ type: "relationship", id: relationshipId(e.userId, e.orgKey) });
  }
  return refs;
}

export function relationshipId(userId: string, orgKey: string): string {
  return `${userId}:${orgKey}`;
}
