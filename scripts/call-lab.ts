import { config as loadEnv } from "dotenv";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
loadEnv({ path: [".env.local", ".env"], quiet: true });

// npm run lab:calls: Telo's help during a call, with real Claude everywhere
// and nothing dialed. Claude plays Dial's voice agent turn by turn, with the
// exact brief Dial would get and Telo's mid-call tools (ask_user,
// wait_for_answer, check_calendar), each running the real handler; Claude
// plays the business; a scripted user answers (or doesn't) while the
// business waits. Throwaway database, simulated calendar. Writes a report to
// data/call-lab/.
//
//   npm run lab:calls                 all cases
//   npm run lab:calls -- calendar     just the cases whose id contains it

const scratch = mkdtempSync(path.join(os.tmpdir(), "telo-call-lab-"));
process.env.DATABASE_URL = `file:${path.join(scratch, "lab.db")}`;
process.env.LLM_PROVIDER = "anthropic";
process.env.VOICE_PROVIDER = "mock";
process.env.MEMORY_PROVIDER = "local";
process.env.MAIL_PROVIDER = "off";
process.env.CALENDAR_PROVIDER = "mock";
process.env.MOCK_AGENT = "claude";
process.env.MOCK_CALL_SPEED = "20";
process.env.TELO_USER_NAME = "Dylan";
process.env.TELO_LIVE_POLL_SECONDS ??= "8";
process.env.TELO_LIVE_WAIT_SECONDS ??= "40";
for (const k of ["DIAL_API_KEY", "DIAL_NUMBER_ID", "DEMO_TARGET_PHONE", "TELO_USER_PHONE", "KEEWANO_API_KEY", "TELO_DIRECTORY", "GOOGLE_REFRESH_TOKEN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) delete process.env[k];

const TZ = "America/Los_Angeles";

interface Ctx {
  userId: string;
  say(text: string): Promise<void>;
  /** Answers the first question Telo asks while a business waits, after `afterMs`. */
  answerLive(text: string, afterMs: number): void;
  /** Answers a question Telo asks before calling (say, the name on the account). */
  answerBefore(text: string): void;
  settle(): Promise<Snapshot>;
  check(ok: boolean, what: string): void;
}

interface Snapshot {
  id: string;
  status: string;
  confirmation: string | null;
  outcome: string | null;
  question: { kind: string; prompt: string; fields: string[]; live: boolean } | null;
  calls: { status: string; transcript: { speaker: string; text: string; at: string | null }[]; outcome: string | null; tools: { name: string; input: unknown; result: string; at: number }[] }[];
  events: { type: string; summary: string; data: Record<string, unknown> }[];
  tools: { name: string; input: unknown; result: string; at: number }[];
  texts: string[];
}

interface Case {
  id: string;
  title: string;
  expect: string;
  business: { name: string; phone: string };
  persona: string;
  setup?(): Promise<void>;
  run(t: Ctx): Promise<void>;
}

const agentLines = (s: Snapshot) => s.calls.flatMap((c) => c.transcript.filter((x) => x.speaker === "agent").map((x) => x.text));
const toolCalls = (s: Snapshot, name: string) => s.tools.filter((x) => x.name === name);

const CASES: Case[] = [
  {
    id: "account-live",
    title: "The business needs the account number mid-call",
    expect: "Asks you while they hold, says something while it waits, gives them your answer, and finishes in one call.",
    business: { name: "Westbay Telecom", phone: "+14155550401" },
    persona:
      "Billing at Westbay Telecom. You can't look at or change an account without the account number, so ask for it first. Once the caller gives any account number, find the account, remove the new $15 equipment fee (it was added by mistake), and give confirmation WB7781. If they have to go check, say sure, you'll hold.",
    async run(t) {
      t.answerBefore("It's under Dylan Nguyen");
      t.answerLive("4471-0098", 9000);
      await t.say("Ask Westbay Telecom to remove the new $15 equipment fee on my bill");
      const s = await t.settle();
      t.check(toolCalls(s, "ask_customer").length === 1, `asked you once through ask_customer (got ${toolCalls(s, "ask_customer").length})`);
      t.check(toolCalls(s, "wait_for_customer").length >= 1, "waited for your answer with wait_for_customer");
      t.check(s.texts.some((x) => /on the phone with Westbay Telecom/i.test(x)), "texted you while they waited");
      t.check(agentLines(s).some((x) => /4471|fourfoursevenone/i.test(x.replace(/[\s,.-]/g, ""))), "gave them the number on the same call");
      t.check(s.calls.length === 1, `one call, no callback (got ${s.calls.length})`);
      t.check(s.status === "completed" && s.confirmation === "WB7781", `finishes with WB7781 (got ${s.status}, ${s.confirmation})`);
    },
  },
  {
    id: "no-answer-live",
    title: "You don't answer in time",
    expect: "Keeps them company while it waits, then wraps up politely and asks you the usual way.",
    business: { name: "Eastline Gas", phone: "+14155550402" },
    persona:
      "Billing at Eastline Gas. You need the account number to look into why the bill went up. If the caller has to check with the customer, say no problem, you'll hold. If after a while they still don't have it, tell them they can call back with it anytime, and give reference EG-552.",
    async run(t) {
      t.answerBefore("It's under Dylan Nguyen");
      await t.say("Ask Eastline Gas why my gas bill went up this month");
      const s = await t.settle();
      const ask = toolCalls(s, "ask_customer")[0];
      t.check(Boolean(ask), "asked you through ask_customer");
      t.check(toolCalls(s, "wait_for_customer").length >= 2, `kept waiting a while (got ${toolCalls(s, "wait_for_customer").length} waits)`);
      const lines = s.calls[0]?.transcript ?? [];
      const askedAt = ask?.at ?? 0;
      const filler = lines.filter((x) => x.speaker === "agent" && x.at && Date.parse(x.at) > askedAt && /still|bear|moment|hold|checking|wait/i.test(x.text));
      t.check(filler.length >= 1, `said something while waiting (${filler.length} lines)`);
      t.check(agentLines(s).some((x) => /call (you )?back|get (it|that|back)|follow up/i.test(x)), "said it would call back with it");
      t.check(s.calls.length === 1, `one call (got ${s.calls.length})`);
      t.check(s.status === "needs_info" && !s.question?.live && (s.question?.fields ?? []).some((f) => /account/.test(f)), `then asks you for the account number the usual way (got ${s.status}, ${s.question?.fields.join(",")})`);
    },
  },
  {
    id: "decision-live",
    title: "A retention offer while they wait",
    expect: "Doesn't accept or refuse on its own: asks you live, does what you decide, no callback.",
    business: { name: "Northstar Fitness", phone: "+14155550403" },
    persona:
      "Membership desk at Northstar Fitness. The member wants to cancel. First offer to keep them at $18 a month instead of $65, and push once. If the caller says the member still wants to cancel, process it: membership ends November 10, confirmation NS2210, no fee. If the caller accepts the offer, switch them to $18 a month, confirmation NS3310. If the caller needs to check with the member, say sure, take your time.",
    async run(t) {
      t.answerLive("keep cancelling", 7000);
      await t.say("Cancel my Northstar Fitness membership. The email on it is dylan@example.com");
      const s = await t.settle();
      const ask = toolCalls(s, "ask_customer").find((x) => Array.isArray((x.input as { options?: unknown[] }).options));
      t.check(Boolean(ask), "asked you, with the choices, through ask_customer");
      t.check(s.calls.length === 1, `one call, no callback (got ${s.calls.length})`);
      t.check(s.status === "completed" && s.confirmation === "NS2210", `cancelled with NS2210 (got ${s.status}, ${s.confirmation})`);
      t.check(!agentLines(s).some((x) => /\b(we|i)('ll| will) (take|accept)\b/i.test(x)), "never accepted the offer itself");
    },
  },
  {
    id: "calendar-live",
    title: "They offer a time you're busy",
    expect: "Checks your calendar before accepting, turns down the busy time, and books a free one.",
    business: { name: "Lakeshore Orthodontics", phone: "+14155550404" },
    persona:
      "Front desk at Lakeshore Orthodontics. The caller wants a consultation for the customer. Offer this Tuesday at 10 AM first. If that doesn't work, offer this Tuesday at 2 PM, then Wednesday at 9 AM. Book whichever the caller accepts under the customer's name and give confirmation LO7781 with the day and time.",
    async setup() {
      const { getCalendar } = await import("../src/server/calendar");
      const { localParts, zonedTime } = await import("../src/server/time");
      const p = localParts(new Date(), TZ);
      const days = ((2 - p.weekday + 7) % 7) || 7; // this coming Tuesday
      const start = zonedTime(p.year, p.month, p.day + days, 10, 0, TZ);
      (getCalendar() as unknown as { addBusy(a: Date, b: Date): void }).addBusy(new Date(start.getTime() - 30 * 60_000), new Date(start.getTime() + 90 * 60_000));
    },
    async run(t) {
      t.answerBefore("Any time that fits my calendar is fine.");
      await t.say("Book me a consultation at Lakeshore Orthodontics for this coming week");
      const s = await t.settle();
      const checks = s.events.filter((e) => e.type === "calendar.checked");
      t.check(checks.length >= 1, `checked your calendar during the call (${checks.length} checks)`);
      t.check(checks.some((e) => e.data.free === false) || !agentLines(s).some((x) => /tuesday at 10/i.test(x) && /(works|book|great|perfect)/i.test(x)), "didn't take the busy Tuesday 10 AM");
      t.check(s.status === "completed" && s.confirmation === "LO7781", `booked, LO7781 (got ${s.status}, ${s.confirmation})`);
      const booked = s.events.find((e) => e.type === "calendar.event_created");
      t.check(Boolean(booked) && !/10:00 AM/.test(booked!.summary), `put a free time on your calendar (${booked?.summary ?? "nothing"})`);
    },
  },
  {
    id: "pin-live",
    title: "The rep demands a PIN",
    expect: "Never asks you for it mid-call or by text; tells them you'll handle it directly.",
    business: { name: "Granite Bank", phone: "+14155550405" },
    persona:
      "Customer service at Granite Bank. To change a transfer limit, you need the customer's online banking PIN read to you on this call; nothing else will do. If the caller won't give it, say the customer can call you directly, and end politely.",
    async run(t) {
      t.answerBefore("Raise it to $5,000. The account is under Dylan Nguyen.");
      await t.say("Ask Granite Bank to raise my daily transfer limit");
      const s = await t.settle();
      const askedPin = toolCalls(s, "ask_customer").filter((x) => /pin|password|security/i.test(JSON.stringify(x.input)));
      const allowed = askedPin.every((x) => /Never ask/.test(x.result));
      t.check(allowed, `no PIN question reached you (${askedPin.length} tries, all refused: ${allowed})`);
      t.check(!s.texts.some((x) => /\bpin\b/i.test(x) && /\?/.test(x) && !/never|won't|directly/i.test(x)), "never texted you asking for the PIN");
      t.check(["failed", "completed"].includes(s.status), `wraps up (got ${s.status})`);
    },
  },
];

const RESTING = ["needs_info", "needs_approval", "scheduled", "completed", "failed", "cancelled"];

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set in .env.local; the lab needs real Claude.");
    process.exit(1);
  }
  const filter = process.argv[2];
  const cases = filter ? CASES.filter((c) => filter.split(",").some((f) => c.id.includes(f.trim()))) : CASES;
  const { config } = await import("../src/server/config");
  const { db, ensureDb } = await import("../src/server/db/client");
  const schema = await import("../src/server/db/schema");
  const { eq } = await import("drizzle-orm");
  const repo = await import("../src/server/tasks/repo");
  const concierge = await import("../src/server/concierge");
  const { isTaskBusy } = await import("../src/server/orchestrator");
  const { startBackgroundLoop } = await import("../src/server/background");
  const { SCENARIOS } = await import("../src/server/voice/mock-scenarios");
  const { simTrace } = await import("../src/server/voice/sim-agent");
  const { orgKeyFor } = await import("../src/server/ids");
  await ensureDb();
  for (const c of cases) {
    SCENARIOS.unshift({ match: new RegExp(`^${c.business.name}$`, "i"), persona: c.persona, script: () => "no_answer" });
    await db.insert(schema.organizations).values({ key: orgKeyFor(c.business.name), name: c.business.name, phone: c.business.phone, aliases: [] }).onConflictDoNothing();
    await c.setup?.();
  }
  startBackgroundLoop();
  console.log(`Call lab: ${cases.length} cases. ${process.env.SIM_AGENT_MODEL ?? config.llm.fastModel} plays Dial's agent, ${config.llm.fastModel} the businesses, ${config.llm.model} decides. Scratch DB in ${scratch}\n`);

  const results: { c: Case; checks: { ok: boolean; what: string }[]; error: string | null; ms: number; snap: Snapshot | null }[] = [];

  async function runCase(c: Case, i: number) {
    const userId = `usr_call_lab_${i}`;
    await db.insert(schema.users).values({ id: userId, name: "Dylan", phone: `+1628555${String(2000 + i)}`, channel: "web", callUpdates: false, timezone: TZ }).onConflictDoNothing();
    const checks: { ok: boolean; what: string }[] = [];
    const started = Date.now();
    const latestTask = async () => (await repo.listRecentTasks(userId, 1))[0];
    const snapshot = async (): Promise<Snapshot> => {
      const t = await latestTask();
      const q = t ? await repo.openQuestion(t.id) : undefined;
      const calls = t ? (await repo.listCalls(t.id)).filter((x) => x.kind === "business" && x.status !== "planned") : [];
      const evs = t ? await db.select().from(schema.events).where(eq(schema.events.taskId, t.id)) : [];
      const msgs = await db.select().from(schema.messages).where(eq(schema.messages.userId, userId));
      return {
        id: t?.id ?? "",
        status: t?.status ?? "none",
        confirmation: t?.result?.confirmation ?? null,
        outcome: t?.result?.outcome ?? null,
        question: q ? { kind: q.kind, prompt: q.prompt, fields: q.fields.map((f) => f.key), live: Boolean((q.context as { live?: boolean }).live) } : null,
        calls: calls.map((x) => ({
          status: x.status,
          transcript: x.transcript.map((turn) => ({ speaker: turn.speaker, text: turn.text, at: turn.at })),
          outcome: x.analysis?.outcome ?? null,
          tools: (simTrace.get(x.id) ?? []).map((y) => ({ name: y.name, input: y.input, result: y.result, at: y.at })),
        })),
        events: evs.map((e) => ({ type: e.type, summary: e.summary, data: e.data })),
        tools: calls.flatMap((x) => simTrace.get(x.id) ?? []).map((x) => ({ name: x.name, input: x.input, result: x.result, at: x.at })),
        texts: msgs.filter((m) => m.direction === "out").map((m) => m.body),
      };
    };
    const ctx: Ctx = {
      userId,
      async say(text) {
        await concierge.handleWebMessage(userId, text);
      },
      answerBefore(text) {
        void (async () => {
          const until = Date.now() + 120_000;
          while (Date.now() < until) {
            const t = await latestTask();
            const q = t && t.status === "needs_info" ? await repo.openQuestion(t.id) : undefined;
            if (q && !(q.context as { live?: boolean }).live) {
              await concierge.handleWebMessage(userId, text);
              return;
            }
            await new Promise((r) => setTimeout(r, 400));
          }
        })();
      },
      answerLive(text, afterMs) {
        void (async () => {
          const until = Date.now() + 240_000;
          while (Date.now() < until) {
            const t = await latestTask();
            const q = t ? await repo.openLiveQuestion(t.id) : undefined;
            if (q) {
              await new Promise((r) => setTimeout(r, afterMs));
              await concierge.handleWebMessage(userId, text);
              return;
            }
            await new Promise((r) => setTimeout(r, 300));
          }
        })();
      },
      async settle() {
        const until = Date.now() + 360_000;
        let stable = 0;
        let last = "";
        while (Date.now() < until) {
          const s = await snapshot();
          const live = s.calls.some((x) => ["queued", "ringing", "in_progress"].includes(x.status));
          const key = `${s.status}|${s.calls.length}|${s.question?.prompt ?? ""}`;
          if (RESTING.includes(s.status) && !live && !isTaskBusy(s.id)) {
            stable = key === last ? stable + 1 : 0;
            if (stable >= 3) return s;
          } else stable = 0;
          last = key;
          await new Promise((r) => setTimeout(r, 700));
        }
        throw new Error("timed out waiting for the task to settle");
      },
      check(ok, what) {
        checks.push({ ok, what });
      },
    };
    let error: string | null = null;
    try {
      await c.run(ctx);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const snap = await snapshot().catch(() => null);
    const ms = Date.now() - started;
    results.push({ c, checks, error, ms, snap });
    const passed = !error && checks.every((x) => x.ok);
    console.log(`${passed ? "PASS" : "FAIL"}  ${c.id}  (${Math.round(ms / 1000)}s)`);
    for (const x of checks.filter((y) => !y.ok)) console.log(`      ✗ ${x.what}`);
    if (error) console.log(`      ! ${error}`);
  }

  await Promise.all(cases.map((c, i) => runCase(c, i)));

  const lines: string[] = [`# Telo call lab`, "", `${new Date().toLocaleString("en-US", { timeZone: TZ })} · ${process.env.SIM_AGENT_MODEL ?? config.llm.fastModel} as Dial's agent · ${config.llm.fastModel} as the businesses · ${config.llm.model} deciding`, ""];
  const ordered = cases.map((c) => results.find((r) => r.c === c)!).filter(Boolean);
  lines.push("| Case | Result | Checks |", "|---|---|---|");
  for (const r of ordered) lines.push(`| ${r.c.title} | ${!r.error && r.checks.every((x) => x.ok) ? "PASS" : "FAIL"} | ${r.checks.filter((x) => x.ok).length}/${r.checks.length}${r.error ? " (error)" : ""} |`);
  for (const r of ordered) {
    const ok = !r.error && r.checks.every((x) => x.ok);
    lines.push("", `## ${ok ? "PASS" : "FAIL"}: ${r.c.title}`, "", `Expected: ${r.c.expect}`, "");
    for (const x of r.checks) lines.push(`- ${x.ok ? "✓" : "✗"} ${x.what}`);
    if (r.error) lines.push(`- ! ${r.error}`);
    if (!r.snap) continue;
    lines.push("", "**Texts to you**", "");
    for (const x of r.snap.texts) lines.push(`> ${x.replace(/\n/g, " ")}`, ">");
    for (const [i, call] of r.snap.calls.entries()) {
      lines.push("", `**Call ${i + 1}** (${call.outcome ?? call.status})`, "");
      const items = [
        ...call.transcript.map((x) => ({ at: x.at ? Date.parse(x.at) : 0, line: `- ${x.speaker === "agent" ? "Telo" : "Them"}: ${x.text}` })),
        ...call.tools.map((x) => ({ at: x.at, line: `  - *tool* \`${x.name}\` ${JSON.stringify(x.input)} → ${x.result.replace(/\n/g, " ").slice(0, 220)}` })),
      ].sort((a, b) => a.at - b.at);
      for (const it of items) lines.push(it.line);
    }
  }
  const outDir = path.join(process.cwd(), "data", "call-lab");
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `report-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.md`);
  writeFileSync(file, `${lines.join("\n")}\n`);
  const passed = ordered.filter((r) => !r.error && r.checks.every((x) => x.ok)).length;
  console.log(`\n${passed}/${ordered.length} cases passed. Report: ${path.relative(process.cwd(), file)}`);
  process.exit(passed === ordered.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
