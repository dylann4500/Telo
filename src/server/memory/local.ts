import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "../db/client";
import { events, type EventRow } from "../db/schema";
import type { EntityRef, MemoryEvent, MemoryProvider, MemoryTrace, TimelineQuery } from "./provider";

export function rowToMemoryEvent(row: EventRow): MemoryEvent {
  return {
    id: row.id,
    type: row.type,
    occurredAt: row.occurredAt.toISOString(),
    summary: row.summary,
    data: row.data,
    userId: row.userId,
    taskId: row.taskId,
    callId: row.callId,
    orgKey: row.orgKey,
    typed: row.typed,
    source: "local",
  };
}

/** Development stand-in for Keewano: the local events table already holds every event. */
export class LocalMemory implements MemoryProvider {
  readonly name = "local" as const;

  async record(): Promise<void> {
    // Nothing to do: recordEvent() already wrote the row.
  }

  async timeline(entity: EntityRef, query: TimelineQuery = {}): Promise<{ events: MemoryEvent[]; trace: MemoryTrace[] }> {
    const started = Date.now();
    const where = [];
    switch (entity.type) {
      case "user":
        where.push(eq(events.userId, entity.id));
        break;
      case "task":
        where.push(eq(events.taskId, entity.id));
        break;
      case "call":
        where.push(eq(events.callId, entity.id));
        break;
      case "org":
        where.push(eq(events.orgKey, entity.id));
        break;
      case "relationship": {
        const [userId, orgKey] = entity.id.split(":");
        where.push(eq(events.userId, userId), eq(events.orgKey, orgKey));
        break;
      }
    }
    if (query.types?.length) where.push(inArray(events.type, query.types));
    if (query.before) where.push(lt(events.occurredAt, new Date(query.before)));
    if (query.since) where.push(gte(events.occurredAt, new Date(query.since)));
    const rows = await db
      .select()
      .from(events)
      .where(and(...where))
      .orderBy(desc(events.occurredAt), desc(events.createdAt))
      .limit(query.limit ?? 200);
    const out = rows.reverse().map(rowToMemoryEvent);
    return {
      events: out,
      trace: [{ via: "local", request: `local timeline ${entity.type}:${entity.id}`, ms: Date.now() - started, rows: out.length }],
    };
  }
}
