import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db/client";
import { events } from "../db/schema";
import type { Trade } from "../domain/types";
import { getMemory } from "../memory";
import { entityUuid, KeewanoMemory } from "../memory/keewano";
import type { MemoryTrace } from "../memory/provider";
import { getAsset, vendorsFor, type Vendor } from "./index";

// The decisions Keewano's history changes (research.md section 5.5): who gets
// called first, and whether to ask for a replacement instead of another repair.
// Each runs live SQL on Keewano when it's configured, and keeps the query so
// the task page can show it. If Keewano can't answer (or has nothing queryable
// yet), the same numbers come from Telo's local copy of the events.

export interface Scorecard {
  vendor: Vendor;
  visits: number;
  noShows: number;
  late: number;
  jobs: number;
  firstFix: number;
  /** Lower is better: no-shows weigh most, then late arrivals; first-visit fixes help. */
  score: number;
}

export interface Insight<T> {
  value: T;
  trace: MemoryTrace[];
  source: "keewano" | "local";
}

const n = (v: unknown) => (v == null ? 0 : Number(v)) || 0;

function score(c: Omit<Scorecard, "score" | "vendor">): number {
  const visits = Math.max(1, c.visits);
  const jobs = Math.max(1, c.jobs);
  return (c.noShows / visits) * 100 + (c.late / visits) * 30 - (c.firstFix / jobs) * 20 - Math.min(c.jobs, 5);
}

type Counts = Record<string, { visits: number; noShows: number; late: number; jobs: number; firstFix: number }>;

async function localScorecards(vendorIds: string[]): Promise<Counts> {
  const rows = await db
    .select({ type: events.type, typed: events.typed, vendor: sql<string>`json_extract(${events.refs}, '$.vendor')` })
    .from(events)
    .where(and(inArray(events.type, ["vendor.outcome", "wo.completed"]), inArray(sql`json_extract(${events.refs}, '$.vendor')`, vendorIds)));
  const out: Counts = {};
  for (const r of rows) {
    const c = (out[r.vendor] ??= { visits: 0, noShows: 0, late: 0, jobs: 0, firstFix: 0 });
    if (r.type === "vendor.outcome") {
      c.visits++;
      if (r.typed?.vendorOutcome === "no_show") c.noShows++;
      if (r.typed?.vendorOutcome === "late") c.late++;
    } else {
      c.jobs++;
      if (r.typed?.woOutcome === "fixed_first_visit") c.firstFix++;
    }
  }
  return out;
}

/** Approved vendors for a trade, best first, by their record across the portfolio. */
export async function rankVendors(trade: Trade): Promise<Insight<Scorecard[]>> {
  const candidates = vendorsFor(trade);
  const ids = candidates.map((v) => v.id);
  const memory = getMemory();
  let counts: Counts | null = null;
  const trace: MemoryTrace[] = [];
  if (memory instanceof KeewanoMemory) {
    const query =
      "SELECT user_id, count(vendor_outcome) AS visits, count(vendor_outcome) FILTER (WHERE vendor_outcome = 'no_show') AS no_shows, count(vendor_outcome) FILTER (WHERE vendor_outcome = 'late') AS late, count(wo_completed) AS jobs, count(wo_completed) FILTER (WHERE wo_completed = 'fixed_first_visit') AS first_fix FROM events WHERE entity_kind = 'vendor' GROUP BY user_id LIMIT 50";
    const started = Date.now();
    try {
      const rows = await memory.sql(query);
      trace.push({ via: "keewano-sql", request: query, ms: Date.now() - started, rows: rows.length });
      const byUuid = new Map(candidates.map((v) => [entityUuid({ type: "vendor", id: v.id }), v.id]));
      const found: Counts = {};
      for (const r of rows) {
        const id = byUuid.get(String(r.user_id));
        if (id) found[id] = { visits: n(r.visits), noShows: n(r.no_shows), late: n(r.late), jobs: n(r.jobs), firstFix: n(r.first_fix) };
      }
      if (Object.keys(found).length) counts = found;
    } catch (err) {
      trace.push({ via: "keewano-sql", request: `${query} -- failed: ${(err as Error).message.slice(0, 120)}`, ms: Date.now() - started, rows: 0 });
    }
  }
  const source = counts ? "keewano" : "local";
  if (!counts) {
    const started = Date.now();
    counts = await localScorecards(ids);
    trace.push({ via: "local", request: `vendor scorecards for ${trade} (no-shows, late arrivals, first-visit fixes) from Telo's own copy of the events`, ms: Date.now() - started, rows: Object.keys(counts).length });
  }
  const ranked = candidates
    .map((vendor) => {
      const c = counts![vendor.id] ?? { visits: 0, noShows: 0, late: 0, jobs: 0, firstFix: 0 };
      return { vendor, ...c, score: score(c) };
    })
    .sort((a, b) => a.score - b.score || a.vendor.tripFeeCents - b.vendor.tripFeeCents);
  return { value: ranked, trace, source };
}

export interface AssetHistory {
  repairs: { at: string; cents: number }[];
  totalCents: number;
  ageYears: number;
}

/** An asset's repairs over the past year, oldest first. */
export async function assetHistory(assetId: string): Promise<Insight<AssetHistory>> {
  const asset = getAsset(assetId)!;
  const since = new Date(Date.now() - 365 * 86_400_000);
  const ageYears = new Date().getFullYear() - asset.installYear;
  const memory = getMemory();
  const trace: MemoryTrace[] = [];
  let repairs: { at: string; cents: number }[] | null = null;
  if (memory instanceof KeewanoMemory) {
    const uuid = entityUuid({ type: "asset", id: assetId });
    const query = `SELECT event_datetime AS t, repair_cents AS cents FROM events WHERE user_id = '${uuid}' AND event_datetime >= '${since.toISOString()}' ORDER BY t LIMIT 50`;
    const started = Date.now();
    try {
      const rows = await memory.sql(query);
      trace.push({ via: "keewano-sql", request: query, ms: Date.now() - started, rows: rows.length });
      if (rows.length) repairs = rows.map((r) => ({ at: new Date(r.t as string).toISOString(), cents: n(r.cents) }));
    } catch (err) {
      trace.push({ via: "keewano-sql", request: `${query} -- failed: ${(err as Error).message.slice(0, 120)}`, ms: Date.now() - started, rows: 0 });
    }
  }
  const source = repairs ? "keewano" : "local";
  if (!repairs) {
    const started = Date.now();
    const rows = await db
      .select({ at: events.occurredAt, typed: events.typed })
      .from(events)
      .where(and(eq(events.type, "asset.repaired"), sql`json_extract(${events.refs}, '$.asset') = ${assetId}`, gte(events.occurredAt, since)));
    repairs = rows.map((r) => ({ at: r.at.toISOString(), cents: r.typed?.repairCents ?? 0 })).sort((a, b) => a.at.localeCompare(b.at));
    trace.push({ via: "local", request: `repairs of ${asset.type.replace(/_/g, " ")} ${assetId} in the past year, from Telo's own copy of the events`, ms: Date.now() - started, rows: repairs.length });
  }
  return { value: { repairs, totalCents: repairs.reduce((s, r) => s + r.cents, 0), ageYears }, trace, source };
}

/** Two repairs within a year (or one on an old unit) means: ask for a replacement price too. */
export function shouldQuoteReplacement(h: AssetHistory): boolean {
  return h.repairs.length >= 2 || (h.repairs.length >= 1 && h.ageYears >= 12);
}

export const MEMORY_SOURCE = () => (config.memory.provider === "keewano" ? "keewano" : "local");
