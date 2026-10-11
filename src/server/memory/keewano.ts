import { createHash } from "node:crypto";
import pg from "pg";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db/client";
import { events as eventsTable } from "../db/schema";
import type { EntityRefs, TypedFacts } from "../domain/types";
import { rowToMemoryEvent } from "./local";
import type { EntityRef, EntityType, MemoryEvent, MemoryProvider, MemoryTrace, TimelineQuery } from "./provider";

// KeewanoDB as Telo's event memory. See docs/integrations/keewano.md.
//
// Writes: typed events (categories, cents, seconds, flags; never names,
// transcripts or free text) to POST /json/in, one batch per entity. An event
// lands on the user x business "relationship" stream, the business ("org")
// stream, the task stream and the user stream.
//
// Reads: SQL over the Postgres wire protocol. Every event type is a column;
// we read one column at a time for one entity and rebuild the timeline,
// grouping context values with the anchor event that shares their second.

type KDataType = "none" | "string" | "uint" | "bool" | "timestamp" | "ushortvec2" | "price_usd_cent";

interface CatalogEntry {
  eventTypeId: number;
  name: string;
  dataType: KDataType;
}

// Registered once with Keewano and append-only: never change an existing
// entry's id or type. Adding entries changes the hash, which registers the
// new list automatically.
export const CATALOG: readonly CatalogEntry[] = [
  { eventTypeId: 2000, name: "entity_kind", dataType: "string" },
  { eventTypeId: 2001, name: "task_created", dataType: "string" },
  { eventTypeId: 2002, name: "task_completed", dataType: "string" },
  { eventTypeId: 2003, name: "memory_brief_used", dataType: "bool" },
  { eventTypeId: 2004, name: "call_started", dataType: "string" },
  { eventTypeId: 2005, name: "hold_seconds", dataType: "uint" },
  { eventTypeId: 2006, name: "call_duration_seconds", dataType: "uint" },
  { eventTypeId: 2007, name: "call_ended", dataType: "string" },
  { eventTypeId: 2008, name: "offer_amount_cents", dataType: "price_usd_cent" },
  { eventTypeId: 2009, name: "offer_received", dataType: "string" },
  { eventTypeId: 2010, name: "offer_accepted", dataType: "string" },
  { eventTypeId: 2011, name: "offer_declined", dataType: "string" },
  { eventTypeId: 2012, name: "confirmation_number", dataType: "string" },
  { eventTypeId: 2013, name: "commitment_amount_cents", dataType: "price_usd_cent" },
  { eventTypeId: 2014, name: "commitment_due_at", dataType: "timestamp" },
  { eventTypeId: 2015, name: "commitment_received", dataType: "string" },
  { eventTypeId: 2016, name: "commitment_fulfilled", dataType: "string" },
  { eventTypeId: 2017, name: "commitment_broken", dataType: "string" },
  { eventTypeId: 2018, name: "confirmation_received", dataType: "string" },
  { eventTypeId: 2019, name: "approval_amount_cents", dataType: "price_usd_cent" },
  { eventTypeId: 2020, name: "approval_requested", dataType: "string" },
  { eventTypeId: 2021, name: "approval_granted", dataType: "string" },
  { eventTypeId: 2022, name: "approval_denied", dataType: "string" },
  { eventTypeId: 2023, name: "message_sent", dataType: "string" },
  { eventTypeId: 2024, name: "email_received", dataType: "string" },
  { eventTypeId: 2025, name: "email_amount_cents", dataType: "price_usd_cent" },
  // Property management, P0 (docs/property-management/research.md section 5.3, items 1-15, in order).
  { eventTypeId: 2026, name: "wo_opened", dataType: "string" },
  { eventTypeId: 2027, name: "severity", dataType: "string" },
  { eventTypeId: 2028, name: "intake_channel", dataType: "string" },
  { eventTypeId: 2029, name: "photo_count", dataType: "uint" },
  { eventTypeId: 2030, name: "wo_deflected", dataType: "string" },
  { eventTypeId: 2031, name: "secs_to_resolve", dataType: "uint" },
  { eventTypeId: 2032, name: "emergency_routed", dataType: "string" },
  { eventTypeId: 2033, name: "emergency_route", dataType: "string" },
  { eventTypeId: 2034, name: "secs_to_human", dataType: "uint" },
  { eventTypeId: 2035, name: "quote_received", dataType: "string" },
  { eventTypeId: 2036, name: "job_code", dataType: "string" },
  { eventTypeId: 2037, name: "quote_cents", dataType: "price_usd_cent" },
  { eventTypeId: 2038, name: "trip_fee_cents", dataType: "price_usd_cent" },
  { eventTypeId: 2039, name: "warranty_days", dataType: "uint" },
  { eventTypeId: 2040, name: "earliest_slot_hours", dataType: "uint" },
  { eventTypeId: 2041, name: "vendor_declined", dataType: "string" },
  { eventTypeId: 2042, name: "vendor_booked", dataType: "string" },
  { eventTypeId: 2043, name: "dispatch_rank", dataType: "uint" },
  { eventTypeId: 2044, name: "booked_cents", dataType: "price_usd_cent" },
  { eventTypeId: 2045, name: "approval_response_seconds", dataType: "uint" },
  { eventTypeId: 2046, name: "approval_channel", dataType: "string" },
  { eventTypeId: 2047, name: "approval_while_holding", dataType: "bool" },
  { eventTypeId: 2048, name: "entry_notice_sent", dataType: "string" },
  { eventTypeId: 2049, name: "notice_hours", dataType: "uint" },
  { eventTypeId: 2050, name: "notice_method", dataType: "string" },
  { eventTypeId: 2051, name: "access_outcome", dataType: "string" },
  { eventTypeId: 2052, name: "reschedules", dataType: "uint" },
  { eventTypeId: 2053, name: "commitment_late_minutes", dataType: "uint" },
  { eventTypeId: 2054, name: "vendor_outcome", dataType: "string" },
  { eventTypeId: 2055, name: "late_minutes", dataType: "uint" },
  { eventTypeId: 2056, name: "wo_completed", dataType: "string" },
  { eventTypeId: 2057, name: "visits", dataType: "uint" },
  { eventTypeId: 2058, name: "days_to_fix", dataType: "uint" },
  { eventTypeId: 2059, name: "invoice_over_quote_pct", dataType: "uint" },
  { eventTypeId: 2060, name: "tenant_confirmed", dataType: "bool" },
  { eventTypeId: 2061, name: "manager_touches", dataType: "uint" },
  { eventTypeId: 2062, name: "callback_opened", dataType: "string" },
  { eventTypeId: 2063, name: "days_since_done", dataType: "uint" },
  { eventTypeId: 2064, name: "asset_registered", dataType: "string" },
  { eventTypeId: 2065, name: "install_year", dataType: "uint" },
  { eventTypeId: 2066, name: "asset_repaired", dataType: "string" },
  { eventTypeId: 2067, name: "repair_cents", dataType: "price_usd_cent" },
  { eventTypeId: 2068, name: "repeat_within_90d", dataType: "bool" },
  { eventTypeId: 2069, name: "repair_vs_replace", dataType: "string" },
  { eventTypeId: 2070, name: "replace_cents", dataType: "price_usd_cent" },
  { eventTypeId: 2071, name: "asset_age_years", dataType: "uint" },
  { eventTypeId: 2072, name: "call_party", dataType: "string" },
];

/** The columns that came before property management; the consumer streams only ever hold these. */
const LEGACY_COLUMNS = new Set(CATALOG.filter((c) => c.eventTypeId <= 2025).map((c) => c.name));

const BY_NAME = new Map(CATALOG.map((c) => [c.name, c]));
const BY_ID = new Map(CATALOG.map((c) => [c.eventTypeId, c]));

/** Non-zero uint32 FNV-1a hash naming one exact catalog list. */
export function catalogHash(catalog: readonly CatalogEntry[] = CATALOG): number {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(JSON.stringify(catalog))) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h || 1;
}

/** RFC 4122 UUID v5. */
export function uuidv5(name: string, namespace: string): string {
  const h = createHash("sha1")
    .update(Buffer.from(namespace.replace(/-/g, ""), "hex"))
    .update(name, "utf8")
    .digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

function namespace(): string {
  const configured = config.memory.keewano.entityNamespace;
  if (configured && /^[0-9a-f-]{36}$/i.test(configured)) return configured;
  // Stable and secret per project when no namespace is configured: derived
  // from the write key, so entity ids can't be brute-forced from user ids.
  const seed = createHash("sha1").update(`telo-entity-ns:${config.memory.keewano.apiKey ?? "dev"}`).digest("hex");
  return `${seed.slice(0, 8)}-${seed.slice(8, 12)}-5${seed.slice(13, 16)}-a${seed.slice(17, 20)}-${seed.slice(20, 32)}`;
}

export function entityKey(ref: EntityRef): string {
  switch (ref.type) {
    case "relationship":
      return `rel:${ref.id}`;
    default:
      return `${ref.type}:${ref.id}`;
  }
}

export function entityUuid(ref: EntityRef): string {
  return uuidv5(entityKey(ref), namespace());
}

interface KEvent {
  eventTypeId: number;
  timestamp: number;
  dataType: KDataType;
  data: string | number | boolean | null;
}

const ANCHORS: Record<string, string> = {
  "task.created": "task_created",
  "task.completed": "task_completed",
  "task.failed": "task_completed",
  "task.cancelled": "task_completed",
  "call.started": "call_started",
  "call.completed": "call_ended",
  "call.failed": "call_ended",
  "offer.received": "offer_received",
  "offer.accepted": "offer_accepted",
  "offer.declined": "offer_declined",
  "commitment.received": "commitment_received",
  "commitment.fulfilled": "commitment_fulfilled",
  "commitment.broken": "commitment_broken",
  "confirmation.received": "confirmation_received",
  "approval.requested": "approval_requested",
  "approval.granted": "approval_granted",
  "approval.denied": "approval_denied",
  "message.sent": "message_sent",
  "email.received": "email_received",
  "wo.opened": "wo_opened",
  "wo.deflected": "wo_deflected",
  "emergency.routed": "emergency_routed",
  "quote.received": "quote_received",
  "vendor.declined": "vendor_declined",
  "vendor.booked": "vendor_booked",
  "entry_notice.sent": "entry_notice_sent",
  "access.outcome": "access_outcome",
  "vendor.outcome": "vendor_outcome",
  "wo.completed": "wo_completed",
  "callback.opened": "callback_opened",
  "asset.registered": "asset_registered",
  "asset.repaired": "asset_repaired",
  "asset.decision": "repair_vs_replace",
};

function anchorValue(type: string, t: TypedFacts): string {
  switch (type) {
    case "wo.opened":
    case "quote.received":
    case "vendor.booked":
    case "callback.opened":
      return t.trade ?? "general";
    case "wo.deflected":
      return t.fixCode ?? "other";
    case "emergency.routed":
      return t.emergencyKind ?? "water";
    case "vendor.declined":
      return t.declineReason ?? "busy";
    case "entry_notice.sent":
      return t.noticePurpose ?? "repair";
    case "access.outcome":
      return t.accessOutcome ?? "done";
    case "vendor.outcome":
      return t.vendorOutcome ?? "on_time";
    case "wo.completed":
      return t.woOutcome ?? "fixed_first_visit";
    case "asset.registered":
    case "asset.repaired":
      return t.assetType ?? "other";
    case "asset.decision":
      return t.decision ?? "repair";
    case "task.created":
      return t.taskKind ?? "other";
    case "task.completed":
      return t.outcome ?? "resolved";
    case "task.failed":
      return t.outcome ?? "failed";
    case "task.cancelled":
      return "abandoned";
    case "call.started":
      return t.purpose ?? "other";
    case "call.completed":
    case "call.failed":
      return t.outcome ?? "dropped";
    case "offer.received":
    case "offer.accepted":
    case "offer.declined":
      return t.offerKind ?? "other";
    case "commitment.received":
    case "commitment.fulfilled":
    case "commitment.broken":
      return t.commitmentKind ?? "other";
    case "confirmation.received":
      return t.confirms ?? "other";
    case "approval.requested":
    case "approval.granted":
    case "approval.denied":
      return t.approvalKind ?? "other";
    case "message.sent":
      return t.channel ?? "sms";
    case "email.received":
      return t.emailKind ?? "other";
    default:
      return "other";
  }
}

/** Expand one Telo event into Keewano events for one entity: context first, anchor last. */
export function toKeewanoEvents(e: Pick<MemoryEvent, "type" | "occurredAt" | "typed">, kind: EntityType): KEvent[] {
  const anchor = ANCHORS[e.type];
  const t = e.typed;
  if (!anchor || !t) return [];
  const ts = Math.floor(new Date(e.occurredAt).getTime() / 1000);
  const ev = (name: string, data: KEvent["data"]): KEvent => {
    const entry = BY_NAME.get(name)!;
    return { eventTypeId: entry.eventTypeId, timestamp: ts, dataType: entry.dataType, data };
  };
  const cents = (n: number | undefined) => (n == null ? null : Math.max(0, Math.round(n)));
  const out: KEvent[] = [ev("entity_kind", kind)];
  // Business-issued codes go on the user's own streams only, never the
  // cross-user business stream (or a vendor's or agency's, shared across tasks).
  const personal = kind !== "org" && kind !== "vendor" && kind !== "agency";
  const uint = (name: string, n: number | undefined) => {
    if (n != null && Number.isFinite(n)) out.push(ev(name, Math.max(0, Math.round(n))));
  };
  const str = (name: string, s: string | undefined) => {
    if (s) out.push(ev(name, s.slice(0, 64)));
  };
  const bool = (name: string, b: boolean | undefined) => {
    if (b !== undefined) out.push(ev(name, b));
  };
  const price = (name: string, n: number | undefined) => {
    if (n != null) out.push(ev(name, cents(n)));
  };

  switch (e.type) {
    case "call.started":
      if (t.briefUsed !== undefined) out.push(ev("memory_brief_used", t.briefUsed));
      str("call_party", t.callParty);
      break;
    case "call.completed":
    case "call.failed":
      if (t.holdSeconds != null) out.push(ev("hold_seconds", Math.round(t.holdSeconds)));
      if (t.durationSeconds != null) out.push(ev("call_duration_seconds", Math.round(t.durationSeconds)));
      str("call_party", t.callParty);
      break;
    case "wo.opened":
      str("severity", t.severity);
      str("intake_channel", t.intakeChannel);
      uint("photo_count", t.photoCount);
      break;
    case "wo.deflected":
      uint("secs_to_resolve", t.secsToResolve);
      break;
    case "emergency.routed":
      str("emergency_route", t.emergencyRoute);
      uint("secs_to_human", t.secsToHuman);
      break;
    case "quote.received":
      str("job_code", t.jobCode);
      price("quote_cents", t.quoteCents);
      price("trip_fee_cents", t.tripFeeCents);
      uint("warranty_days", t.warrantyDays);
      uint("earliest_slot_hours", t.earliestSlotHours);
      break;
    case "vendor.booked":
      uint("dispatch_rank", t.dispatchRank);
      price("booked_cents", t.bookedCents);
      break;
    case "entry_notice.sent":
      uint("notice_hours", t.noticeHours);
      str("notice_method", t.noticeMethod);
      break;
    case "access.outcome":
      uint("reschedules", t.reschedules);
      break;
    case "vendor.outcome":
      uint("late_minutes", t.lateMinutes);
      break;
    case "wo.completed":
      uint("visits", t.visits);
      uint("days_to_fix", t.daysToFix);
      uint("invoice_over_quote_pct", t.invoiceOverQuotePct);
      bool("tenant_confirmed", t.tenantConfirmed);
      uint("manager_touches", t.managerTouches);
      break;
    case "callback.opened":
      uint("days_since_done", t.daysSinceDone);
      break;
    case "asset.registered":
      uint("install_year", t.installYear);
      break;
    case "asset.repaired":
      price("repair_cents", t.repairCents);
      bool("repeat_within_90d", t.repeatWithin90d);
      break;
    case "asset.decision":
      price("replace_cents", t.replaceCents);
      uint("asset_age_years", t.assetAgeYears);
      break;
    case "offer.received":
    case "offer.accepted":
    case "offer.declined":
      if (t.amountCents != null) out.push(ev("offer_amount_cents", cents(t.amountCents)));
      break;
    case "commitment.received":
    case "commitment.fulfilled":
    case "commitment.broken":
      if (personal && t.confirmationNumber) out.push(ev("confirmation_number", t.confirmationNumber.slice(0, 64)));
      if (t.amountCents != null) out.push(ev("commitment_amount_cents", cents(t.amountCents)));
      if (t.dueAt) out.push(ev("commitment_due_at", Math.floor(new Date(t.dueAt).getTime() / 1000)));
      uint("commitment_late_minutes", t.commitmentLateMinutes);
      break;
    case "confirmation.received":
      if (personal && t.confirmationNumber) out.push(ev("confirmation_number", t.confirmationNumber.slice(0, 64)));
      break;
    case "approval.requested":
    case "approval.granted":
    case "approval.denied":
      if (t.amountCents != null) out.push(ev("approval_amount_cents", cents(t.amountCents)));
      uint("approval_response_seconds", t.approvalResponseSeconds);
      str("approval_channel", t.approvalChannel);
      bool("approval_while_holding", t.approvalWhileHolding);
      break;
    case "email.received":
      if (personal && t.confirmationNumber) out.push(ev("confirmation_number", t.confirmationNumber.slice(0, 64)));
      if (t.amountCents != null) out.push(ev("email_amount_cents", cents(t.amountCents)));
      break;
  }
  out.push(ev(anchor, anchorValue(e.type, t).slice(0, 64)));
  return out;
}

type PortfolioStream = Exclude<EntityType, "user" | "org" | "call" | "relationship" | "task" | "pm">;

// Where each property-management event goes (research.md section 5.3). "task" and "pm" come from the
// event itself; the rest from its refs, so a stream is skipped when the event has no such entity.
const PM_STREAMS: Record<string, ("task" | "pm" | PortfolioStream)[]> = {
  "wo.opened": ["task", "unit", "property", "owner", "tenancy", "pm"],
  "wo.deflected": ["task", "unit"],
  "emergency.routed": ["task", "property", "pm"],
  "quote.received": ["vendor", "task", "unit"],
  "vendor.declined": ["vendor", "task"],
  "vendor.booked": ["vendor", "task", "unit"],
  "approval.requested": ["owner", "task", "pm"],
  "approval.granted": ["owner", "task", "pm"],
  "approval.denied": ["owner", "task", "pm"],
  "entry_notice.sent": ["unit", "task"],
  "access.outcome": ["task", "unit", "tenancy"],
  "commitment.received": ["vendor", "task"],
  "commitment.fulfilled": ["vendor", "task"],
  "commitment.broken": ["vendor", "task"],
  "vendor.outcome": ["vendor", "task", "unit"],
  "wo.completed": ["task", "unit", "vendor", "owner", "pm"],
  "callback.opened": ["vendor", "unit"],
  "asset.registered": ["asset", "unit"],
  "asset.repaired": ["asset", "unit", "owner"],
  "asset.decision": ["asset", "owner"],
};

const PARTY_STREAM: Record<string, PortfolioStream> = { vendor: "vendor", owner: "owner", tenant: "tenancy", agency: "agency", prospect: "prospect" };

/** Which Keewano entities an event is written to. Calls are bracketed inside these streams. */
export function keewanoEntitiesFor(e: Pick<MemoryEvent, "userId" | "taskId" | "orgKey" | "type"> & { refs?: EntityRefs | null; typed?: TypedFacts | null }): EntityRef[] {
  if (e.refs && Object.keys(e.refs).length) {
    let kinds = PM_STREAMS[e.type];
    if (e.type.startsWith("commitment.") && e.typed?.commitmentKind === "payment") kinds = ["tenancy", "task"]; // a promise to pay
    if (e.type.startsWith("call.")) {
      const party = e.typed?.callParty ? PARTY_STREAM[e.typed.callParty] : undefined;
      kinds = party ? ["task", party, "pm"] : ["task", "pm"];
    }
    kinds ??= ["task", "pm"];
    const out: EntityRef[] = [];
    for (const k of kinds) {
      if (k === "task") {
        if (e.taskId) out.push({ type: "task", id: e.taskId });
      } else if (k === "pm") out.push({ type: "pm", id: e.userId });
      else if (e.refs[k]) out.push({ type: k, id: e.refs[k]! });
    }
    return out;
  }
  const refs: EntityRef[] = [];
  if (e.orgKey) {
    refs.push({ type: "relationship", id: `${e.userId}:${e.orgKey}` });
    if (!e.type.startsWith("message.") && !e.type.startsWith("approval.")) refs.push({ type: "org", id: e.orgKey });
  }
  if (e.taskId) refs.push({ type: "task", id: e.taskId });
  refs.push({ type: "user", id: e.userId });
  return refs;
}

export class KeewanoFatalError extends Error {}

const COLUMNS = CATALOG.filter((c) => c.name !== "entity_kind").map((c) => c.name);

const g = globalThis as unknown as { __keewanoCatalog?: Promise<void>; __keewanoPool?: pg.Pool };

export class KeewanoMemory implements MemoryProvider {
  readonly name = "keewano" as const;
  private readonly cfg = config.memory.keewano;

  private headers() {
    if (!this.cfg.apiKey) throw new KeewanoFatalError("KEEWANO_API_KEY is not set");
    return { "k-token": this.cfg.apiKey, "content-type": "application/json" };
  }

  /** Registers the custom event catalog once per process (idempotent on Keewano's side). */
  ensureCatalog(): Promise<void> {
    g.__keewanoCatalog ??= (async () => {
      const hash = catalogHash();
      const check = await fetch(`${this.cfg.ingestUrl}/custom?customEventsHash=${hash}`, { headers: this.headers() });
      if (check.status === 200) return;
      const res = await fetch(`${this.cfg.ingestUrl}/custom`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ customEventsHash: hash, eventTypes: CATALOG }),
      });
      if (res.status === 409) throw new KeewanoFatalError("Keewano: a different catalog is registered under this hash");
      if (res.status >= 400) throw new Error(`Keewano catalog registration failed: ${res.status} ${await res.text()}`);
      for (let i = 0; i < 10; i++) {
        const poll = await fetch(`${this.cfg.ingestUrl}/custom?customEventsHash=${hash}`, { headers: this.headers() });
        if (poll.status === 200) return;
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw new Error("Keewano catalog registration did not settle");
    })().catch((err) => {
      g.__keewanoCatalog = undefined;
      throw err;
    });
    return g.__keewanoCatalog;
  }

  async record(e: MemoryEvent): Promise<void> {
    if (!e.typed || !ANCHORS[e.type]) return;
    await this.ensureCatalog();
    const hash = catalogHash();
    for (const ref of keewanoEntitiesFor(e)) {
      const kevents = toKeewanoEvents(e, ref.type);
      if (kevents.length < 2) continue;
      const id = entityUuid(ref);
      const body = {
        dataSessionId: uuidv5(`${e.id}|${id}`, namespace()), // same pair on retry: never double-counts
        batch: 1,
        customEventsHash: hash,
        installId: id,
        userId: id,
        sdkVersion: "telo/0.1",
        events: kevents,
      };
      const res = await fetch(`${this.cfg.ingestUrl}/in`, { method: "POST", headers: this.headers(), body: JSON.stringify(body) });
      if (res.status === 202 || res.status === 200) continue; // accepted, or {accepted: 0} for a duplicate
      const detail = await res.text().catch(() => "");
      if ([400, 401, 403, 413].includes(res.status)) throw new KeewanoFatalError(`Keewano rejected batch: ${res.status} ${detail}`);
      throw new Error(`Keewano ingest failed: ${res.status} ${detail}`);
    }
  }

  private pool(): pg.Pool {
    if (!this.cfg.pat || !this.cfg.projectId || !this.cfg.pgUser) {
      throw new KeewanoFatalError("Keewano SQL needs KEEWANO_PAT, KEEWANO_PROJECT_ID and KEEWANO_PG_USER");
    }
    g.__keewanoPool ??= new pg.Pool({
      host: this.cfg.pgHost,
      port: this.cfg.pgPort,
      user: this.cfg.pgUser,
      password: this.cfg.pat,
      database: this.cfg.projectId,
      ssl: { rejectUnauthorized: true },
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    return g.__keewanoPool;
  }

  /** Runs one read-only statement (simple query protocol: no bind parameters). */
  async sql(text: string): Promise<Record<string, unknown>[]> {
    const res = await this.pool().query(text);
    return res.rows as Record<string, unknown>[];
  }

  async timeline(entity: EntityRef, query: TimelineQuery = {}): Promise<{ events: MemoryEvent[]; trace: MemoryTrace[] }> {
    const started = Date.now();
    const uuid = entityUuid(entity);
    if (!/^[0-9a-f-]{36}$/.test(uuid)) throw new Error("bad entity id");
    const since = query.since ? ` AND event_datetime >= '${new Date(query.since).toISOString()}'` : "";
    // Consumer streams only ever hold the original columns; portfolio streams can hold any.
    const columns = entity.type === "user" || entity.type === "org" || entity.type === "relationship" ? COLUMNS.filter((c) => LEGACY_COLUMNS.has(c)) : COLUMNS;
    const statements = columns.map(
      (col) => `SELECT event_datetime AS t, ${col} AS v FROM events WHERE user_id = '${uuid}'${since} ORDER BY t`,
    );
    const errors: string[] = [];
    const results = await Promise.all(
      statements.map((s) =>
        this.sql(s).catch((err: Error) => {
          errors.push(err.message);
          return [] as Record<string, unknown>[];
        }),
      ),
    );
    if (errors.length === statements.length) throw new Error(`Keewano SQL failed: ${errors[0]}`);
    if (errors.length) console.warn(`[keewano] ${errors.length}/${statements.length} column queries failed, e.g. ${errors[0]}`);

    // Rebuild: group values by second; each anchor becomes one event, with
    // the context values that share its second.
    const bySecond = new Map<number, Map<string, unknown>>();
    results.forEach((rows, i) => {
      const col = columns[i];
      for (const row of rows) {
        if (row.v === null || row.v === undefined) continue;
        const sec = Math.floor(new Date(row.t as string | Date).getTime() / 1000);
        if (!Number.isFinite(sec)) continue;
        const slot = bySecond.get(sec) ?? new Map<string, unknown>();
        slot.set(col, row.v);
        bySecond.set(sec, slot);
      }
    });
    const rebuilt: MemoryEvent[] = [];
    const userId = entity.type === "relationship" ? entity.id.split(":")[0] : entity.type === "user" || entity.type === "pm" ? entity.id : "";
    const orgKey = entity.type === "relationship" ? entity.id.split(":")[1] : entity.type === "org" ? entity.id : null;
    for (const [sec, cols] of [...bySecond.entries()].sort((a, b) => a[0] - b[0])) {
      for (const [type, anchor] of Object.entries(ANCHORS)) {
        if (!cols.has(anchor)) continue;
        // task.completed / failed / cancelled share one column: keep the first mapping only.
        if (type === "task.failed" || type === "task.cancelled" || type === "call.failed") continue;
        const typed = typedFromColumns(type, cols);
        const occurredAt = new Date(sec * 1000).toISOString();
        rebuilt.push({
          id: `kw_${uuid.slice(0, 8)}_${sec}_${anchor}`,
          type,
          occurredAt,
          summary: summarizeTyped(type, typed),
          data: {},
          userId: userId || "",
          taskId: entity.type === "task" ? entity.id : null,
          callId: null,
          orgKey: orgKey ?? null,
          typed,
          source: "keewano",
        });
      }
    }

    // Read-your-writes: Keewano needs ~5 minutes before new events are
    // queryable, so merge in our own recent writes for this entity.
    const recent = await this.recentLocal(entity);
    const seen = new Set(rebuilt.map((e) => `${e.type}|${Math.floor(new Date(e.occurredAt).getTime() / 1000)}`));
    for (const e of recent) {
      const key = `${normalizeType(e.type)}|${Math.floor(new Date(e.occurredAt).getTime() / 1000)}`;
      if (!seen.has(key)) rebuilt.push(e);
    }
    rebuilt.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    const limited = query.limit ? rebuilt.slice(-query.limit) : rebuilt;
    const typesFiltered = query.types?.length ? limited.filter((e) => query.types!.includes(e.type)) : limited;

    return {
      events: typesFiltered,
      trace: [
        {
          via: "keewano-sql",
          request: `SELECT event_datetime, <column> FROM events WHERE user_id = '${uuid}'${since}  (x${columns.length} columns)`,
          ms: Date.now() - started,
          rows: results.reduce((n, r) => n + r.length, 0),
        },
        ...(recent.length
          ? [{ via: "local" as const, request: `recent writes not yet queryable (${this.cfg.cacheMinutes} min window)`, ms: 0, rows: recent.length }]
          : []),
      ],
    };
  }

  private async recentLocal(entity: EntityRef): Promise<MemoryEvent[]> {
    const since = new Date(Date.now() - this.cfg.cacheMinutes * 60_000);
    const where = [gte(eventsTable.createdAt, since), isNotNull(eventsTable.typed)];
    if (entity.type === "relationship") {
      const [userId, orgKey] = entity.id.split(":");
      where.push(eq(eventsTable.userId, userId), eq(eventsTable.orgKey, orgKey));
    } else if (entity.type === "org") where.push(eq(eventsTable.orgKey, entity.id));
    else if (entity.type === "task") where.push(eq(eventsTable.taskId, entity.id));
    else if (entity.type === "user" || entity.type === "pm") where.push(eq(eventsTable.userId, entity.id));
    else if (entity.type !== "call") where.push(sql`json_extract(${eventsTable.refs}, ${`$.${entity.type}`}) = ${entity.id}`);
    const rows = await db.select().from(eventsTable).where(and(...where));
    return rows.filter((r) => ANCHORS[r.type]).map(rowToMemoryEvent);
  }
}

/** Types that share a Keewano column collapse to the one the rebuild produces. */
function normalizeType(type: string): string {
  if (type === "call.failed") return "call.completed";
  if (type === "task.failed" || type === "task.cancelled") return "task.completed";
  return type;
}

function typedFromColumns(type: string, cols: Map<string, unknown>): TypedFacts {
  const anchor = ANCHORS[type];
  const v = cols.get(anchor);
  const num = (k: string) => (cols.has(k) ? Number(cols.get(k)) : undefined);
  const str = (k: string) => (cols.has(k) ? String(cols.get(k)) : undefined);
  const t: TypedFacts = {};
  if (type.startsWith("task.")) {
    if (type === "task.created") t.taskKind = String(v);
    else t.outcome = String(v);
  } else if (type === "call.started") {
    t.purpose = String(v);
    if (cols.has("memory_brief_used")) t.briefUsed = Boolean(cols.get("memory_brief_used"));
  } else if (type === "call.completed") {
    t.outcome = String(v);
    t.durationSeconds = num("call_duration_seconds");
    t.holdSeconds = num("hold_seconds");
  } else if (type.startsWith("offer.")) {
    t.offerKind = String(v);
    t.amountCents = num("offer_amount_cents");
  } else if (type.startsWith("commitment.")) {
    t.commitmentKind = String(v);
    t.amountCents = num("commitment_amount_cents");
    t.confirmationNumber = str("confirmation_number");
    const due = cols.get("commitment_due_at");
    if (due != null) t.dueAt = new Date(typeof due === "number" ? due * 1000 : String(due)).toISOString();
  } else if (type === "confirmation.received") {
    t.confirms = String(v);
    t.confirmationNumber = str("confirmation_number");
  } else if (type.startsWith("approval.")) {
    t.approvalKind = String(v);
    t.amountCents = num("approval_amount_cents");
  } else if (type === "message.sent") {
    t.channel = String(v);
  } else if (type === "email.received") {
    t.emailKind = String(v);
    t.amountCents = num("email_amount_cents");
    t.confirmationNumber = str("confirmation_number");
  } else if (type === "wo.opened" || type === "quote.received" || type === "vendor.booked" || type === "callback.opened") {
    t.trade = String(v) as TypedFacts["trade"];
    if (type === "wo.opened") {
      t.severity = str("severity") as TypedFacts["severity"];
      t.intakeChannel = str("intake_channel") as TypedFacts["intakeChannel"];
      t.photoCount = num("photo_count");
    } else if (type === "quote.received") {
      t.jobCode = str("job_code");
      t.quoteCents = num("quote_cents");
      t.tripFeeCents = num("trip_fee_cents");
      t.warrantyDays = num("warranty_days");
      t.earliestSlotHours = num("earliest_slot_hours");
    } else if (type === "vendor.booked") {
      t.dispatchRank = num("dispatch_rank");
      t.bookedCents = num("booked_cents");
    } else t.daysSinceDone = num("days_since_done");
  } else if (type === "wo.deflected") {
    t.fixCode = String(v);
    t.secsToResolve = num("secs_to_resolve");
  } else if (type === "emergency.routed") {
    t.emergencyKind = String(v);
    t.emergencyRoute = str("emergency_route") as TypedFacts["emergencyRoute"];
    t.secsToHuman = num("secs_to_human");
  } else if (type === "vendor.declined") {
    t.declineReason = String(v) as TypedFacts["declineReason"];
  } else if (type === "entry_notice.sent") {
    t.noticePurpose = String(v) as TypedFacts["noticePurpose"];
    t.noticeHours = num("notice_hours");
    t.noticeMethod = str("notice_method") as TypedFacts["noticeMethod"];
  } else if (type === "access.outcome") {
    t.accessOutcome = String(v) as TypedFacts["accessOutcome"];
    t.reschedules = num("reschedules");
  } else if (type === "vendor.outcome") {
    t.vendorOutcome = String(v) as TypedFacts["vendorOutcome"];
    t.lateMinutes = num("late_minutes");
  } else if (type === "wo.completed") {
    t.woOutcome = String(v) as TypedFacts["woOutcome"];
    t.visits = num("visits");
    t.daysToFix = num("days_to_fix");
    t.invoiceOverQuotePct = num("invoice_over_quote_pct");
    if (cols.has("tenant_confirmed")) t.tenantConfirmed = Boolean(cols.get("tenant_confirmed"));
    t.managerTouches = num("manager_touches");
  } else if (type === "asset.registered" || type === "asset.repaired") {
    t.assetType = String(v) as TypedFacts["assetType"];
    if (type === "asset.registered") t.installYear = num("install_year");
    else {
      t.repairCents = num("repair_cents");
      if (cols.has("repeat_within_90d")) t.repeatWithin90d = Boolean(cols.get("repeat_within_90d"));
    }
  } else if (type === "asset.decision") {
    t.decision = String(v) as TypedFacts["decision"];
    t.replaceCents = num("replace_cents");
    t.assetAgeYears = num("asset_age_years");
  }
  return Object.fromEntries(Object.entries(t).filter(([, x]) => x !== undefined && !Number.isNaN(x))) as TypedFacts;
}

const usd = (cents?: number) => (cents == null ? "" : ` $${(cents / 100).toFixed(2)}`);
const words = (s?: string) => (s ?? "").replace(/_/g, " ");

/** A readable line for an event rebuilt from typed values. */
export function summarizeTyped(type: string, t: TypedFacts): string {
  const conf = t.confirmationNumber ? ` (confirmation ${t.confirmationNumber})` : "";
  switch (type) {
    case "task.created":
      return `Task started: ${words(t.taskKind)}`;
    case "task.completed":
      return `Task finished: ${words(t.outcome)}`;
    case "call.started":
      return `Call started (${words(t.purpose)})${t.briefUsed ? ", with prior history" : ""}`;
    case "call.completed":
      return `Call ended: ${words(t.outcome)}${t.durationSeconds ? `, ${Math.round(t.durationSeconds / 60)} min` : ""}`;
    case "offer.received":
      return `Offer received: ${words(t.offerKind)}${usd(t.amountCents)}`;
    case "offer.accepted":
      return `Offer accepted: ${words(t.offerKind)}${usd(t.amountCents)}`;
    case "offer.declined":
      return `Offer declined: ${words(t.offerKind)}${usd(t.amountCents)}`;
    case "commitment.received":
      return `Promise made: ${words(t.commitmentKind)}${usd(t.amountCents)}${conf}`;
    case "commitment.fulfilled":
      return `Promise kept: ${words(t.commitmentKind)}${usd(t.amountCents)}${conf}`;
    case "commitment.broken":
      return `Promise broken: ${words(t.commitmentKind)}${usd(t.amountCents)}${conf}`;
    case "confirmation.received":
      return `Confirmed: ${words(t.confirms)}${conf}`;
    case "approval.requested":
      return `Asked you: ${words(t.approvalKind)}${usd(t.amountCents)}`;
    case "approval.granted":
      return `You approved: ${words(t.approvalKind)}`;
    case "approval.denied":
      return `You declined: ${words(t.approvalKind)}`;
    case "message.sent":
      return `Update sent (${t.channel})`;
    case "email.received":
      return `Email: ${words(t.emailKind)}${usd(t.amountCents)}${conf}`;
    case "wo.opened":
      return `Work order opened: ${words(t.trade)}${t.severity ? ` (${t.severity})` : ""}${t.photoCount ? `, ${t.photoCount} photo${t.photoCount === 1 ? "" : "s"}` : ""}`;
    case "wo.deflected":
      return `Fixed without a vendor: ${words(t.fixCode)}`;
    case "emergency.routed":
      return `Emergency: ${words(t.emergencyKind)}${t.emergencyRoute ? `, routed to ${words(t.emergencyRoute)}` : ""}`;
    case "quote.received":
      return `Quote: ${words(t.jobCode ?? t.trade)}${usd(t.quoteCents)}${t.earliestSlotHours != null ? `, earliest in ${t.earliestSlotHours} h` : ""}`;
    case "vendor.declined":
      return `Vendor declined: ${words(t.declineReason)}`;
    case "vendor.booked":
      return `Vendor booked: ${words(t.trade)}${usd(t.bookedCents)}${t.dispatchRank ? ` (rank ${t.dispatchRank})` : ""}`;
    case "entry_notice.sent":
      return `Entry notice sent: ${words(t.noticePurpose)}${t.noticeHours != null ? `, ${t.noticeHours} h ahead` : ""}`;
    case "access.outcome":
      return `Access: ${words(t.accessOutcome)}`;
    case "vendor.outcome":
      return `Vendor ${t.vendorOutcome === "no_show" ? "no-show" : words(t.vendorOutcome)}${t.lateMinutes ? `, ${t.lateMinutes} min late` : ""}`;
    case "wo.completed":
      return `Work order closed: ${words(t.woOutcome)}${t.daysToFix != null ? ` in ${t.daysToFix} days` : ""}${t.managerTouches != null ? `, ${t.managerTouches} manager touches` : ""}`;
    case "callback.opened":
      return `Callback: ${words(t.trade)} failed again${t.daysSinceDone != null ? ` after ${t.daysSinceDone} days` : ""}`;
    case "asset.registered":
      return `Asset on file: ${words(t.assetType)}${t.installYear ? `, installed ${t.installYear}` : ""}`;
    case "asset.repaired":
      return `Repaired: ${words(t.assetType)}${usd(t.repairCents)}${t.repeatWithin90d ? " (repeat within 90 days)" : ""}`;
    case "asset.decision":
      return `Repair or replace: ${words(t.decision)}${usd(t.replaceCents)}`;
    default:
      return type;
  }
}

export { BY_ID };
