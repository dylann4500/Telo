import * as agent from "./agent";
import type { TaskRow, UserRow } from "./db/schema";
import { TERMINAL_STATUSES } from "./domain/types";
import { getMemory, relationshipHistory } from "./memory";
import { recordEvent } from "./memory/events";
import { askKeewano } from "./memory/keewano-ask";
import { listCalls, listOrganizations, listRecentTasks, openQuestion } from "./tasks/repo";
import { nowContext } from "./time";

// "What's going on?" answered from live task state, plus event memory when
// the question is about the past.

function minutesSince(d: Date | null): number | null {
  return d ? Math.max(0, Math.round((Date.now() - d.getTime()) / 60_000)) : null;
}

export async function taskSnapshot(task: TaskRow) {
  const calls = await listCalls(task.id);
  const live = calls.find((c) => c.kind === "business" && ["queued", "ringing", "in_progress"].includes(c.status));
  const q = await openQuestion(task.id);
  let nowLine = task.statusDetail;
  if (live) {
    const mins = minutesSince(live.answeredAt);
    nowLine =
      live.status === "in_progress"
        ? `On the phone with ${live.targetName}${mins ? `, ${mins} min in` : ", just connected"}${live.statusDetail && !["Connected", "Ringing"].includes(live.statusDetail) ? ` (${live.statusDetail})` : ""}`
        : `Dialing ${live.targetName}`;
  }
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    now: nowLine,
    waitingOnYou: q ? q.prompt : null,
    result: task.result?.summary ?? null,
    confirmation: task.result?.confirmation ?? null,
    nextCallAt: task.status === "scheduled" && task.wakeAt ? task.wakeAt.toISOString() : null,
    callsMade: calls.filter((c) => c.kind === "business" && c.finishedAt).length,
    updatedAt: task.updatedAt.toISOString(),
  };
}

async function relevantSnapshots(userId: string) {
  const recent = await listRecentTasks(userId, 15);
  const cutoff = Date.now() - 3 * 86_400_000;
  const pick = recent.filter((t) => !TERMINAL_STATUSES.includes(t.status) || t.updatedAt.getTime() > cutoff).slice(0, 8);
  return Promise.all(pick.map(taskSnapshot));
}

// Words too common to name one business on their own.
const GENERIC_WORDS = new Set(["the", "bay", "city", "first", "great", "royal", "north", "south", "east", "west", "united", "national", "american", "pacific", "golden", "bright", "general", "global"]);

/**
 * Businesses a question names: the full name or an alias, or a distinctive
 * word of the name ("what did Harborview email me?" → Harborview Hotel).
 * People say the short name; the directory has the long one.
 */
export function mentionedBusinesses<T extends { name: string; aliases: string[] }>(question: string, orgs: T[]): T[] {
  const lower = question.toLowerCase();
  const full = orgs.filter((o) => [o.name, ...o.aliases].some((a) => a && a.length > 2 && lower.includes(a.toLowerCase())));
  if (full.length) return full;
  const words = new Set(lower.match(/[a-z0-9']+/g) ?? []);
  return orgs.filter((o) =>
    o.name
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .some((w) => w.length >= 5 && !GENERIC_WORDS.has(w) && words.has(w)),
  );
}

const ANALYTICAL = /\b(how many|how often|average|typical|usually|ever|most|total|count|percent|how long)\b/i;

export async function answerStatus(user: UserRow, question: string, opts: { needsHistory?: boolean } = {}): Promise<string> {
  const tasks = await relevantSnapshots(user.id);
  const orgs = await listOrganizations();
  const mentioned = mentionedBusinesses(question, orgs);

  // Population or "ever" questions go to Keewano itself when it's connected.
  if (getMemory().name === "keewano" && ANALYTICAL.test(question)) {
    const answer = await askKeewano(question, user.id).catch((err) => {
      console.error("[status] keewano ask failed", err);
      return null;
    });
    if (answer) {
      await recordEvent({
        userId: user.id,
        type: "memory.retrieved",
        summary: `Asked Keewano: "${question}"`,
        data: { via: "keewano-sql", sql: answer.sql, rows: answer.rows, ms: answer.ms, answer: answer.answer },
      });
      return answer.answer;
    }
  }

  const history: { business: string; occurredAt: string; summary: string; source?: string }[] = [];
  if (mentioned.length || opts.needsHistory) {
    for (const o of (mentioned.length ? mentioned : orgs).slice(0, 3)) {
      const h = await relationshipHistory(user.id, o.key, { sinceDays: 365, limit: 30 });
      history.push(...h.events.map((e) => ({ business: o.name, occurredAt: e.occurredAt, summary: e.summary, source: e.source })));
    }
  }
  const r = await agent.answerStatus({ question, now: nowContext(user.timezone), tasks, history });
  return r.reply;
}

/** A few plain lines for the voice line's prompt and the get_status tool. No sensitive values. */
export async function statusDigest(userId: string): Promise<string> {
  const tasks = await relevantSnapshots(userId);
  if (!tasks.length) return "No tasks in progress.";
  return tasks
    .map((t) => {
      const state = t.waitingOnYou ? `waiting on you: ${t.waitingOnYou}` : t.result ? `${t.status}: ${t.result}` : t.now ?? t.status;
      return `- ${t.title}: ${state}`;
    })
    .join("\n");
}
