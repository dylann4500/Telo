import { eq } from "drizzle-orm";
import { config } from "../config";
import { orgKeyFor } from "../ids";
import { db } from "./client";
import { calls, events, messages, organizations, questions, tasks, users, webhookReceipts } from "./schema";

// Baseline data every run needs (the user and a business directory), plus
// the demo backstory: a call to Comcast last week where a rep promised a
// $20 credit under confirmation A1832.

interface DirectoryEntry {
  name: string;
  phone: string | null;
  aliases: string[];
}

function directory(): DirectoryEntry[] {
  const demo = config.demo.targetPhone;
  const defaults: DirectoryEntry[] = [
    { name: "Comcast", phone: demo, aliases: ["xfinity", "internet", "cable"] },
    { name: "Equinox", phone: demo, aliases: ["gym", "equinox gym"] },
    { name: "Bay Auto Glass", phone: demo, aliases: ["windshield", "auto glass"] },
    { name: "Mission Glass Co", phone: demo, aliases: ["windshield", "auto glass"] },
    { name: "Golden Gate Windshield", phone: demo, aliases: ["windshield", "auto glass"] },
    { name: "Nopa", phone: demo, aliases: ["restaurant", "dinner"] },
    { name: "Bright Smile Dental", phone: demo, aliases: ["dentist", "dental"] },
  ];
  const raw = process.env.TELO_DIRECTORY;
  if (!raw) return defaults;
  try {
    const custom = JSON.parse(raw) as { name: string; phone?: string; aliases?: string[] }[];
    const merged = new Map(defaults.map((d) => [orgKeyFor(d.name), d]));
    for (const c of custom) merged.set(orgKeyFor(c.name), { name: c.name, phone: c.phone ?? demo, aliases: c.aliases ?? merged.get(orgKeyFor(c.name))?.aliases ?? [] });
    return [...merged.values()];
  } catch {
    console.warn("[seed] TELO_DIRECTORY is not valid JSON; using the default directory");
    return defaults;
  }
}

export async function seedBaseline() {
  const u = config.user;
  await db
    .insert(users)
    .values({ id: u.id, name: u.name, phone: u.phone, channel: u.channel, callUpdates: u.callUpdates, timezone: u.timezone })
    .onConflictDoUpdate({
      target: users.id,
      // Keep a phone linked by text when TELO_USER_PHONE is unset, and the
      // user's own text/call choice (callUpdates is only the starting value).
      set: { name: u.name, channel: u.channel, timezone: u.timezone, ...(u.phone ? { phone: u.phone } : {}) },
    });
  for (const d of directory()) {
    await db
      .insert(organizations)
      .values({ key: orgKeyFor(d.name), name: d.name, phone: d.phone, aliases: d.aliases })
      .onConflictDoUpdate({ target: organizations.key, set: d.phone ? { aliases: d.aliases, phone: d.phone } : { aliases: d.aliases } });
  }
}

const daysAgo = (n: number, h = 10, m = 14) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, m, 0, 0);
  return d;
};

/** Last week's Comcast call. Idempotent: fixed ids, so re-running changes nothing. */
export async function seedDemoHistory(): Promise<{ created: boolean }> {
  const userId = config.user.id;
  const taskId = "tsk_demo_comcast_oct";
  if (await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) })) return { created: false };
  const start = daysAgo(8);
  const at = (min: number, sec = 0) => new Date(start.getTime() + min * 60_000 + sec * 1000);
  const callId = "call_demo_comcast_oct";
  const orgKey = orgKeyFor("Comcast");
  const due = new Date(start.getTime() + 7 * 86_400_000);

  await db.insert(tasks).values({
    id: taskId,
    userId,
    title: "Fix Comcast bill",
    request: "My Comcast bill jumped this month. Can you call and figure out why?",
    source: "sms",
    status: "completed",
    statusDetail: "Done",
    category: "support",
    goal: "Find out why the bill went up and get it corrected",
    orgKey,
    targets: [{ name: "Comcast", phone: config.demo.targetPhone, kind: "business" }],
    facts: [{ key: "confirmation_1_0", label: "Confirmation from Comcast", value: "A1832", sensitive: false, source: "call" }],
    result: { outcome: "success", summary: "The promo rate had ended. Comcast promised a $20 service credit on the next bill, confirmation A1832.", confirmation: "A1832" },
    createdAt: start,
    updatedAt: at(16),
    completedAt: at(16),
  });
  await db.insert(calls).values({
    id: callId,
    userId,
    taskId,
    direction: "outbound",
    kind: "business",
    seq: 1,
    attempt: 1,
    orgKey,
    targetName: "Comcast",
    targetPhone: config.demo.targetPhone,
    purpose: "Ask why the bill went up",
    status: "ended",
    statusDetail: "Call ended",
    provider: "mock",
    providerCallId: "demo_comcast_oct",
    startedAt: at(1),
    answeredAt: at(2),
    endedAt: at(15),
    finishedAt: at(15),
    analyzedAt: at(16),
    durationSec: 780,
    endReason: "completed",
    transcript: [
      { speaker: "agent", text: "Hi, this is Telo, an AI assistant calling on behalf of my client about their bill.", at: null },
      { speaker: "other", text: "Sure. I see the promotional rate ended last cycle, which is why it went up.", at: null },
      { speaker: "agent", text: "They weren't told it was ending. Is there anything you can do?", at: null },
      { speaker: "other", text: "I can put a $20 service credit on the next statement. Your confirmation number is A1832.", at: null },
      { speaker: "agent", text: "Thank you. A $20 credit on the next statement, confirmation A1832.", at: null },
    ],
    analysis: {
      outcome: "success",
      summary: "Promo rate ended. Rep promised a $20 service credit on the next statement, confirmation A1832.",
      facts: [{ label: "Why the bill went up", value: "Promotional rate ended" }],
      offers: [],
      commitments: [{ by: "business", kind: "account_credit", description: "$20 service credit on the next statement", amountUsd: 20, due: due.toISOString() }],
      priorCommitments: [],
      confirmationNumbers: ["A1832"],
      repName: null,
      quote: null,
      decisionNeeded: null,
      callbackAt: null,
      infoRequested: [],
      nextStep: "Check the next bill for the credit.",
    },
    createdAt: at(1),
  });
  const ev = (id: string, minute: number, sec: number, type: string, summary: string, typed: Record<string, unknown> | null, extra: Partial<typeof events.$inferInsert> = {}) => ({
    id: `evt_seed_${id}`,
    userId,
    taskId,
    orgKey,
    type,
    summary,
    typed: typed as never,
    occurredAt: at(minute, sec),
    ...extra,
  });
  await db
    .insert(events)
    .values([
      ev("created", 0, 0, "task.created", "New task: Fix Comcast bill", { taskKind: "dispute_bill" }),
      ev("start", 1, 0, "call.started", "Calling Comcast: Ask why the bill went up", { purpose: "dispute_bill", briefUsed: false }, { callId }),
      ev("conn", 2, 0, "call.connected", "Connected to Comcast", null, { callId }),
      ev("end", 15, 1, "call.completed", "Call with Comcast: promo rate ended; rep promised a $20 service credit.", { outcome: "resolved", durationSeconds: 780 }, { callId }),
      ev("fact", 15, 2, "business.fact_discovered", "Why the bill went up: Promotional rate ended", null, { callId }),
      ev("commit", 15, 3, "commitment.received", "Comcast promised: $20 service credit on the next statement (confirmation A1832)", { commitmentKind: "account_credit", amountCents: 2000, dueAt: due.toISOString(), confirmationNumber: "A1832" }, { callId }),
      ev("conf", 15, 4, "confirmation.received", "Confirmation A1832 from Comcast", { confirms: "credit", confirmationNumber: "A1832" }, { callId }),
      ev("done", 16, 0, "task.completed", "Finished: Comcast promised a $20 credit (A1832).", { outcome: "resolved" }),
    ])
    .onConflictDoNothing();
  await db.insert(messages).values([
    { id: "msg_seed_1", userId, taskId, direction: "in", channel: "sms", kind: "chat", body: "My Comcast bill jumped this month. Can you call and figure out why?", status: "received", createdAt: start },
    { id: "msg_seed_2", userId, taskId, direction: "out", channel: "sms", kind: "result", body: "Done. The promo rate had ended. Comcast promised a $20 credit on your next bill, confirmation A1832.", status: "sent", createdAt: at(16) },
  ]).onConflictDoNothing();
  return { created: true };
}

/** Dev only: wipe operational data. Keewano has no delete API, so remote history stays. */
export async function resetAll() {
  await db.delete(questions);
  await db.delete(messages);
  await db.delete(calls);
  await db.delete(events);
  await db.delete(tasks);
  await db.delete(webhookReceipts);
}
