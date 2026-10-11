import { and, eq, gte, isNotNull, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { events } from "../db/schema";
import { getLLM } from "../agent/llm";
import { entityNames } from "../portfolio";
import { listOrganizations } from "../tasks/repo";
import { getMemory } from "./index";
import { CATALOG, entityUuid, KeewanoMemory } from "./keewano";

// Answers a question nobody prepared for, straight from Keewano: the model
// writes one read-only SQL statement over Telo's event columns, we run it,
// and the model answers from the rows. The statement is returned so the UI
// can show the live query.

const SqlSchema = z.object({
  sql: z.string().describe("One SELECT statement, no semicolon"),
  explanation: z.string(),
});
const AnswerSchema = z.object({ reply: z.string() });

const COLUMN_NOTES: Record<string, string> = {
  entity_kind: "string: pm | owner | property | unit | asset | vendor | tenancy | agency | task (first event of every batch; holds forward). Older consumer streams: user | org | relationship",
  task_created: "string: task kind (cancel_membership, dispute_bill, get_quote, booking, reschedule, ...)",
  task_completed: "string: resolved | partial | failed | abandoned",
  memory_brief_used: "bool: the call plan included prior history",
  call_started: "string: task kind of the call",
  hold_seconds: "uint",
  call_duration_seconds: "uint",
  call_ended: "string: resolved | partial | escalated | callback_scheduled | no_answer | voicemail | dropped",
  offer_amount_cents: "price_usd_cent (context for offer_*)",
  offer_received: "string: retention_discount | quote | fee_waiver | payment_plan | upgrade | other",
  offer_accepted: "string: offer kind",
  offer_declined: "string: offer kind",
  confirmation_number: "string: business-issued code (user streams only)",
  commitment_amount_cents: "price_usd_cent (context for commitment_*)",
  commitment_due_at: "timestamp",
  commitment_received: "string: account_credit | refund | callback | cancellation | fee_waiver | appointment | reservation | other",
  commitment_fulfilled: "string: commitment kind",
  commitment_broken: "string: commitment kind (a promise found not kept on a later call)",
  confirmation_received: "string: cancellation | credit | appointment | dispute | other",
  approval_amount_cents: "price_usd_cent",
  approval_requested: "string: accept_offer | book | decision",
  approval_granted: "string",
  approval_denied: "string",
  message_sent: "string: channel",
  // Property management.
  wo_opened: "string: trade of a new work order (plumbing | hvac | electrical | appliance | roof | pest | locks | landscape | cleaning | paint | flooring | general). On task, unit, property, owner, tenancy and pm streams",
  severity: "string: emergency | urgent | routine | cosmetic (context for wo_opened)",
  intake_channel: "string: sms | mms | call | email (context for wo_opened)",
  photo_count: "uint (context for wo_opened)",
  wo_deflected: "string: fixed without a vendor: gfci | breaker | disposal | thermostat | filter | clog | other",
  secs_to_resolve: "uint (context for wo_deflected)",
  emergency_routed: "string: gas | fire | co | water | sewage | no_heat | no_power | lockout | security",
  emergency_route: "string: tenant_911 | utility | oncall | vendor | deescalated (context for emergency_routed)",
  secs_to_human: "uint: seconds until a person was reached (context for emergency_routed)",
  quote_received: "string: trade of a vendor quote. On vendor, task and unit streams",
  job_code: "string: short job code such as ac_no_cool, wh_replace, sink_leak (context for quote_received; written before quote_cents)",
  quote_cents: "price_usd_cent (context for quote_received)",
  trip_fee_cents: "price_usd_cent (context for quote_received)",
  warranty_days: "uint (context for quote_received)",
  earliest_slot_hours: "uint: hours until the vendor's earliest slot (context for quote_received)",
  vendor_declined: "string: busy | out_of_area | wrong_trade | no_answer | price. On vendor and task streams",
  vendor_booked: "string: trade of a booked job. On vendor, task and unit streams",
  dispatch_rank: "uint: the vendor's place in Telo's ranking, 1 = first (context for vendor_booked)",
  booked_cents: "price_usd_cent: the booked job's price (context for vendor_booked). Sum it per unit for repair spend",
  approval_response_seconds: "uint: how long the owner took to answer (context for approval_granted / approval_denied)",
  approval_channel: "string: sms | voice | dashboard (context for approval_*)",
  approval_while_holding: "bool: a vendor was waiting on the line (context for approval_*)",
  entry_notice_sent: "string: repair | inspection | preventive | showing. On unit and task streams",
  notice_hours: "uint: hours of notice before entry (context for entry_notice_sent)",
  notice_method: "string: sms | email | posted | mail (context for entry_notice_sent)",
  access_outcome: "string: done | no_access | rescheduled | tenant_cancelled. no_access = a wasted trip. On task, unit and tenancy streams",
  reschedules: "uint (context for access_outcome)",
  commitment_late_minutes: "uint (context for commitment_fulfilled)",
  vendor_outcome: "string: on_time | late | no_show | cancelled, one per vendor visit. On vendor, task and unit streams",
  late_minutes: "uint (context for vendor_outcome)",
  wo_completed: "string: fixed_first_visit | fixed_multi_visit | not_fixed | cancelled. On task, unit, vendor, owner and pm streams",
  visits: "uint (context for wo_completed)",
  days_to_fix: "uint (context for wo_completed)",
  invoice_over_quote_pct: "uint, 0 when at or under the quote (context for wo_completed)",
  tenant_confirmed: "bool (context for wo_completed)",
  manager_touches: "uint: times the manager had to act on the work order (context for wo_completed)",
  callback_opened: "string: trade of a repair that failed again. On vendor and unit streams",
  days_since_done: "uint (context for callback_opened)",
  asset_registered: "string: water_heater | furnace | ac | heat_pump | fridge | range | dishwasher | washer | dryer | roof | garage_door. First event on each asset stream, so it holds forward: WHERE asset_registered = 'water_heater' selects water-heater assets",
  install_year: "uint (context for asset_registered)",
  asset_repaired: "string: asset type of a repair. On asset, unit and owner streams",
  repair_cents: "price_usd_cent (context for asset_repaired)",
  repeat_within_90d: "bool (context for asset_repaired)",
  repair_vs_replace: "string: repair | replace | defer, the owner's choice. On asset and owner streams",
  replace_cents: "price_usd_cent: the replacement price (context for repair_vs_replace)",
  asset_age_years: "uint (context for repair_vs_replace)",
  call_party: "string: tenant | owner | vendor | agency | prospect | manager (context for call_started / call_ended)",
};

const SQL_SYSTEM = `You write one read-only SQL query for KeewanoDB, an event database.
- There is one table, events. Columns: user_id (text, the entity id), event_datetime, plus one column per event type (listed below).
- Each event-type column is a step function: its value holds forward from one occurrence until the next. WHERE clauses select stretches of each entity's timeline.
- Selecting bare columns with no aggregate emits one row per occurrence of the selected event columns.
- Supported: SELECT, WHERE, GROUP BY, ORDER BY, LIMIT, aggregates (count, sum, avg, min, max), count(DISTINCT user_id), subqueries in FROM, occurrence(col), and count(col) in WHERE as a per-entity gate.
- Not supported: JOIN, CTE (WITH), window functions, UNION, writes, and FILTER on an aggregate (Keewano answers "unsupported aggregate"). Put the condition in WHERE instead: count(vendor_outcome) ... WHERE vendor_outcome = 'no_show' counts no-shows, because a column's own occurrence carries its new value.
- Entities: each vendor, unit, owner, property, asset, tenancy (a lease), agency and task is its own user_id, and so is the management firm (pm). Use the ids given, or entity_kind = 'vendor' / 'unit' / ... to cover all entities of a kind and GROUP BY user_id. Older consumer streams (relationship, org, user) may also exist.
- Context columns (amounts, confirmation numbers, durations) are written just before their anchor event. Total or average them directly. Never add a condition on the anchor column when aggregating its amount.
  WRONG (returns nothing): SELECT sum(commitment_amount_cents) FROM events WHERE user_id = '<id>' AND commitment_received = 'account_credit'
  RIGHT: SELECT sum(commitment_amount_cents) AS cents FROM events WHERE user_id = '<id>'
- Money columns are in cents.
- Always end with LIMIT 50 or less.

Examples that work:
SELECT sum(commitment_amount_cents) AS cents FROM events WHERE user_id = '<relationship id>' LIMIT 1
SELECT count(commitment_received) AS promises, count(commitment_broken) AS broken FROM events WHERE user_id = '<relationship id>' LIMIT 1
SELECT user_id, count(commitment_broken) AS broken FROM events WHERE entity_kind = 'relationship' GROUP BY user_id LIMIT 50
SELECT commitment_received AS kind, count(commitment_received) AS n FROM events WHERE entity_kind = 'relationship' GROUP BY commitment_received LIMIT 50
SELECT count(call_ended) AS calls, avg(call_duration_seconds) AS avg_seconds FROM events WHERE user_id = '<org id>' LIMIT 1
SELECT user_id, count(vendor_outcome) AS no_shows FROM events WHERE entity_kind = 'vendor' AND vendor_outcome = 'no_show' GROUP BY user_id ORDER BY no_shows DESC LIMIT 10
SELECT user_id, sum(booked_cents) AS cents FROM events WHERE entity_kind = 'unit' AND event_datetime >= '2026-01-01' GROUP BY user_id ORDER BY cents DESC LIMIT 10
SELECT avg(replace_cents) AS avg_cents, count(replace_cents) AS n FROM events WHERE entity_kind = 'asset' AND asset_registered = 'water_heater' LIMIT 1
SELECT user_id, avg(approval_response_seconds) AS avg_seconds FROM events WHERE entity_kind = 'owner' GROUP BY user_id LIMIT 10
SELECT count(access_outcome) AS wasted_trips FROM events WHERE entity_kind = 'unit' AND access_outcome = 'no_access' LIMIT 1
SELECT avg(manager_touches) AS touches, avg(days_to_fix) AS days FROM events WHERE entity_kind = 'pm' LIMIT 1`;

/** Events sent to Keewano recently enough that a query can't see them yet. */
async function recentTypedEvents(userId: string) {
  const since = new Date(Date.now() - 25 * 60_000);
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.userId, userId), isNotNull(events.typed), or(isNull(events.memorySyncedAt), gte(events.memorySyncedAt, since))));
  return rows.map((r) => ({ type: r.type, business: r.orgKey, at: r.occurredAt.toISOString(), summary: r.summary }));
}

export async function askKeewano(question: string, userId: string): Promise<{ answer: string; sql: string; rows: number; ms: number } | null> {
  const memory = getMemory();
  if (!(memory instanceof KeewanoMemory)) return null;
  const orgs = await listOrganizations();
  const entities = {
    pm: entityUuid({ type: "pm", id: userId }),
    portfolio: entityNames().map((e) => ({ kind: e.kind, name: e.name, user_id: entityUuid({ type: e.kind as "vendor", id: e.id }) })),
    user: entityUuid({ type: "user", id: userId }),
    relationships: orgs.map((o) => ({ business: o.name, user_id: entityUuid({ type: "relationship", id: `${userId}:${o.key}` }) })),
    orgs: orgs.map((o) => ({ business: o.name, user_id: entityUuid({ type: "org", id: o.key }) })),
  };
  const llm = getLLM();
  const draft = await llm.structured({
    name: "keewano-sql",
    system: SQL_SYSTEM,
    prompt: `<columns>\n${CATALOG.map((c) => `${c.name}: ${COLUMN_NOTES[c.name] ?? c.dataType}`).join("\n")}\n</columns>\n\n<entities>\n${JSON.stringify(entities, null, 2)}\n</entities>\n\n<question>\n${question}\n</question>`,
    schema: SqlSchema,
    effort: "medium",
  });
  const sql = draft.sql.trim().replace(/;+\s*$/, "");
  if (!/^select\b/i.test(sql) || /;|\b(insert|update|delete|drop|alter|create|grant|copy)\b/i.test(sql) || sql.length > 4000) {
    throw new Error(`Refusing to run generated SQL: ${sql.slice(0, 120)}`);
  }
  const started = Date.now();
  const rows = await memory.sql(sql);
  const ms = Date.now() - started;
  // Keewano takes a while to make new events queryable; give the answer
  // step Telo's own recent writes so a question about the last few minutes
  // is still answered correctly.
  const recent = await recentTypedEvents(userId);
  const answer = await llm.structured({
    name: "keewano-answer",
    system:
      "Answer the user's question from the Keewano query result in one or two short sentences, text-message style. The rows are the source of truth: never contradict them. Money columns are in cents: say dollars. Translate ids into vendor, unit, owner and business names using the entity list. recent_events_not_yet_in_keewano are newer events the query can't see yet: add them only if they change the answer, and never count anything twice. If there's no data, say there's no record of it.",
    prompt: `<question>\n${question}\n</question>\n\n<entities>\n${JSON.stringify(entities)}\n</entities>\n\n<sql>\n${sql}\n</sql>\n\n<rows>\n${JSON.stringify(rows.slice(0, 50))}\n</rows>\n\n<recent_events_not_yet_in_keewano>\n${JSON.stringify(recent)}\n</recent_events_not_yet_in_keewano>`,
    schema: AnswerSchema,
    effort: "low",
  });
  console.info(`[keewano] ask "${question}" -> ${rows.length} rows in ${ms}ms`);
  return { answer: answer.reply, sql, rows: rows.length, ms };
}
