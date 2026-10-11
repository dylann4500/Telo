import { config } from "../config";
import { KeewanoMemory } from "./keewano";
import { LocalMemory } from "./local";
import type { MemoryEvent, MemoryProvider, MemoryTrace } from "./provider";
import { relationshipId } from "./provider";

let instance: MemoryProvider | undefined;

export function getMemory(): MemoryProvider {
  instance ??= config.memory.provider === "keewano" ? new KeewanoMemory() : new LocalMemory();
  return instance;
}

/** Everything that happened between this user and this business, oldest first. */
export async function relationshipHistory(
  userId: string,
  orgKey: string,
  opts: { sinceDays?: number; limit?: number } = {},
): Promise<{ events: MemoryEvent[]; trace: MemoryTrace[]; source: MemoryProvider["name"] }> {
  const memory = getMemory();
  const since = new Date(Date.now() - (opts.sinceDays ?? 365) * 86_400_000).toISOString();
  try {
    const { events, trace } = await memory.timeline(
      { type: "relationship", id: relationshipId(userId, orgKey) },
      { since, limit: opts.limit ?? 60 },
    );
    return { events, trace, source: memory.name };
  } catch (err) {
    // A memory outage must not stop the call: fall back to the local copy and say so.
    console.error("[memory] timeline failed, falling back to local", err);
    const local = await new LocalMemory().timeline({ type: "relationship", id: relationshipId(userId, orgKey) }, { since, limit: opts.limit ?? 60 });
    return {
      events: local.events,
      trace: [{ via: "local", request: `fallback after error: ${(err as Error).message}`, ms: 0, rows: local.events.length }],
      source: "local",
    };
  }
}

export type { MemoryEvent, MemoryProvider, MemoryTrace };
