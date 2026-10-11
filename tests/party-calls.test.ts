import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { SimTurn } from "../src/server/voice/mock-scenarios";

// With texts blocked (10DLC), Telo phones the tenant and the owner instead.
// Priya approves Rapid Air's $650 on Telo's call while Luis holds; Maria says
// yes to the entry notice on a call, and later that it's fixed.

const dir = mkdtempSync(path.join(os.tmpdir(), "telo-party-"));
process.env.DATABASE_URL = `file:${path.join(dir, "telo.db")}`;
process.env.LLM_PROVIDER = "mock";
process.env.VOICE_PROVIDER = "mock";
process.env.MEMORY_PROVIDER = "local";
process.env.MAIL_PROVIDER = "off";
process.env.CALENDAR_PROVIDER = "off";
process.env.MOCK_CALL_SPEED = "40";
process.env.TELO_USER_NAME = "Dylan";
process.env.TELO_LIVE_POLL_SECONDS = "1";
process.env.TELO_LIVE_WAIT_SECONDS = "10";
process.env.TELO_PARTY_CALLS = "1";
delete process.env.TELO_PORTFOLIO_PHONES;
delete process.env.DEMO_TARGET_PHONE;
delete process.env.TELO_USER_PHONE;

let m: {
  db: typeof import("../src/server/db/client");
  schema: typeof import("../src/server/db/schema");
  concierge: typeof import("../src/server/concierge");
  repo: typeof import("../src/server/tasks/repo");
  orchestrator: typeof import("../src/server/orchestrator");
};

const telo = (text: string): SimTurn => ({ speaker: "agent", text });
const them = (text: string): SimTurn => ({ speaker: "other", text });
const answers = (said: string): SimTurn[] => [
  them("Hello?"),
  telo("Hi, this is Telo, the AI assistant for Bayside Property Management. This call is recorded."),
  them(said),
  { speaker: "agent", text: "One sec.", tool: { name: "ask_telo", args: { message: said } } },
  telo("Thanks, bye."),
];

beforeAll(async () => {
  m = {
    db: await import("../src/server/db/client"),
    schema: await import("../src/server/db/schema"),
    concierge: await import("../src/server/concierge"),
    repo: await import("../src/server/tasks/repo"),
    orchestrator: await import("../src/server/orchestrator"),
  };
  const { SCENARIOS } = await import("../src/server/voice/mock-scenarios");
  SCENARIOS.unshift({ match: /priya shah/i, persona: () => answers("Yes, approve it. And get a replacement quote too."), script: () => "no_answer" });
  SCENARIOS.unshift({ match: /maria gomez/i, persona: (n) => answers(n === 1 ? "Yes, that works for me." : "Yes, it's fixed. Thanks!"), script: () => "no_answer" });
  await m.db.ensureDb();
  await (await import("../src/server/portfolio/history")).seedPortfolioHistory();
});

async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, label: string, ms = 25_000): Promise<T> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe("Telo calls the tenant and the owner", () => {
  it("gets the owner's approval and the tenant's yes on calls, then closes", async () => {
    await m.concierge.handleInboundText({ from: "+14155550122", body: "Hi, the AC is out again. It's blowing warm air and it's 85 degrees in here.", channel: "sms", providerMessageId: "pc_1", media: ["https://example.test/a.jpg", "https://example.test/b.jpg"] });
    const task = await waitFor(async () => (await m.repo.listRecentTasks("usr_default", 10)).find((t) => t.context?.tenancy === "ten_alder_b"), "the work order");

    // Priya approves on Telo's call while Rapid Air holds; Maria says yes to the entry notice on hers.
    const ready = await waitFor(async () => {
      const t = await m.repo.getTask(task.id);
      return t?.status === "scheduled" && t.context?.accessConfirmed ? t : null;
    }, "the booking and Maria's yes");
    expect(ready.context?.booked).toMatchObject({ vendor: "ven_rapidair", cents: 65_000, ownerApproved: true });
    const calls = await m.repo.listCalls(task.id);
    expect(calls.filter((c) => c.kind === "party_update").map((c) => c.targetName)).toEqual(expect.arrayContaining(["Priya Shah", "Maria Gomez"]));
    const events = await m.db.db.select().from(m.schema.events).where(eq(m.schema.events.taskId, task.id));
    expect(events.find((e) => e.type === "approval.granted")?.typed).toMatchObject({ approvalChannel: "voice", approvalWhileHolding: true });
    let msgs = await m.db.db.select().from(m.schema.messages).where(eq(m.schema.messages.taskId, task.id));
    expect(msgs.find((x) => x.party?.id === "ten_alder_b" && /notice of entry/.test(x.body))).toMatchObject({ channel: "voice", status: "sent" });
    expect(msgs.some((x) => x.party?.id === "ten_alder_b" && x.direction === "out" && x.provider === "live-call" && /They'll be there/.test(x.body))).toBe(true);
    // FYIs aren't calls.
    expect(msgs.find((x) => x.party?.id === "own_shah" && /^Booked Rapid Air/.test(x.body))?.channel).not.toBe("voice");

    // The visit: "fixed?" is a call too, and Maria's yes closes it.
    expect(await m.orchestrator.wakeTask(task.id)).toBe(true);
    const done = await waitFor(async () => {
      const t = await m.repo.getTask(task.id);
      return t?.status === "completed" ? t : null;
    }, "the work order to close");
    expect(done.result?.confirmation).toBe("RA2231");
    msgs = await m.db.db.select().from(m.schema.messages).where(eq(m.schema.messages.taskId, task.id));
    expect(msgs.find((x) => x.party?.id === "ten_alder_b" && /Reply Y or N/.test(x.body))?.channel).toBe("voice");
  }, 60_000);
});
