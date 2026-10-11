import { and, eq, gte, isNotNull, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { events } from "../db/schema";
import { getLLM } from "../agent/llm";
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
  entity_kind: "string: user | task | org | relationship (first event of every batch; holds forward)",
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
};

const SQL_SYSTEM = `You write one read-only SQL query for KeewanoDB, an event database.
- There is one table, events. Columns: user_id (text, the entity id), event_datetime, plus one column per event type (listed below).
- Each event-type column is a step function: its value holds forward from one occurrence until the next. WHERE clauses select stretches of each entity's timeline.
- Selecting bare columns with no aggregate emits one row per occurrence of the selected event columns.
- Supported: SELECT, WHERE, GROUP BY, ORDER BY, LIMIT, aggregates (count, sum, avg, min, max), count(DISTINCT user_id), FILTER (WHERE ...), subqueries in FROM, occurrence(col), and count(col) in WHERE as a per-entity gate.
- Not supported: JOIN, CTE (WITH), window functions, UNION, writes.
- Entities: each relationship (one user with one business), each org (a business across users), each task, each user is its own user_id. Use the ids given, or entity_kind = 'relationship' / 'org' / 'task' to cover all entities of a kind.
- Context columns (amounts, confirmation numbers, durations) are written just before their anchor event. Total or average them directly. Never add a condition on the anchor column when aggregating its amount.
  WRONG (returns nothing): SELECT sum(commitment_amount_cents) FROM events WHERE user_id = '<id>' AND commitment_received = 'account_credit'
  RIGHT: SELECT sum(commitment_amount_cents) AS cents FROM events WHERE user_id = '<id>'
- FILTER (WHERE ...) allows only one comparison, IN or BETWEEN on one event column.
- Money columns are in cents.
- Always end with LIMIT 50 or less.

Examples that work:
SELECT sum(commitment_amount_cents) AS cents FROM events WHERE user_id = '<relationship id>' LIMIT 1
SELECT count(commitment_received) AS promises, count(commitment_broken) AS broken FROM events WHERE user_id = '<relationship id>' LIMIT 1
SELECT user_id, count(commitment_broken) AS broken FROM events WHERE entity_kind = 'relationship' GROUP BY user_id LIMIT 50
SELECT commitment_received AS kind, count(commitment_received) AS n FROM events WHERE entity_kind = 'relationship' GROUP BY commitment_received LIMIT 50
SELECT count(call_ended) AS calls, avg(call_duration_seconds) AS avg_seconds FROM events WHERE user_id = '<org id>' LIMIT 1`;

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
      "Answer the user's question from the Keewano query result in one or two short sentences, text-message style. The rows are the source of truth: never contradict them. Money columns are in cents: say dollars. Translate ids into business names using the entity list. recent_events_not_yet_in_keewano are newer events the query can't see yet: add them only if they change the answer, and never count anything twice. If there's no data, say there's no record of it.",
    prompt: `<question>\n${question}\n</question>\n\n<entities>\n${JSON.stringify(entities)}\n</entities>\n\n<sql>\n${sql}\n</sql>\n\n<rows>\n${JSON.stringify(rows.slice(0, 50))}\n</rows>\n\n<recent_events_not_yet_in_keewano>\n${JSON.stringify(recent)}\n</recent_events_not_yet_in_keewano>`,
    schema: AnswerSchema,
    effort: "low",
  });
  console.info(`[keewano] ask "${question}" -> ${rows.length} rows in ${ms}ms`);
  return { answer: answer.reply, sql, rows: rows.length, ms };
}
