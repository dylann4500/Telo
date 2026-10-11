import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// End to end on the simulated stack (rule-based model, simulated phone
// line, local memory) with a throwaway database: the same code paths a live
// demo runs, minus the network.

const dir = mkdtempSync(path.join(os.tmpdir(), "telo-test-"));
process.env.DATABASE_URL = `file:${path.join(dir, "telo.db")}`;
process.env.LLM_PROVIDER = "mock";
process.env.VOICE_PROVIDER = "mock";
process.env.MEMORY_PROVIDER = "local";
process.env.MOCK_CALL_SPEED = "40";
process.env.TELO_USER_NAME = "Dylan";

type Mods = {
  db: typeof import("../src/server/db/client");
  schema: typeof import("../src/server/db/schema");
  seed: typeof import("../src/server/db/seed");
  concierge: typeof import("../src/server/concierge");
  repo: typeof import("../src/server/tasks/repo");
  background: typeof import("../src/server/background");
  orchestrator: typeof import("../src/server/orchestrator");
};
let m: Mods;

beforeAll(async () => {
  m = {
    db: await import("../src/server/db/client"),
    schema: await import("../src/server/db/schema"),
    seed: await import("../src/server/db/seed"),
    concierge: await import("../src/server/concierge"),
    repo: await import("../src/server/tasks/repo"),
    background: await import("../src/server/background"),
    orchestrator: await import("../src/server/orchestrator"),
  };
  await m.db.ensureDb();
});

async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, label: string, ms = 15_000): Promise<T> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const say = (text: string) => m.concierge.handleWebMessage("usr_default", text);
const latest = async () => (await m.repo.listRecentTasks("usr_default", 1))[0];

describe("a gym cancellation with a retention offer", () => {
  it("asks for the email, calls, pauses for the offer, calls back, finishes", async () => {
    await say("Cancel my gym membership at Equinox");
    const task = await latest();
    expect(task.status).toBe("needs_info");
    expect((await m.repo.openQuestion(task.id))?.fields.map((f) => f.key)).toContain("account_email");

    await say("dylan@example.com");
    const waiting = await waitFor(async () => {
      const t = await m.repo.getTask(task.id);
      return t?.status === "needs_approval" ? t : null;
    }, "the retention offer");
    const q = await m.repo.openQuestion(waiting.id);
    expect(q?.options.map((o) => o.id)).toEqual(["accept_offer", "keep_cancelling"]);

    const user = (await m.repo.getUser("usr_default"))!;
    await m.concierge.decideTask(user, task.id, "keep_cancelling", true, null);
    const done = await waitFor(async () => {
      const t = await m.repo.getTask(task.id);
      return t?.status === "completed" ? t : null;
    }, "completion");
    expect(done.result?.confirmation).toBe("18392");

    const calls = (await m.repo.listCalls(task.id)).filter((c) => c.kind === "business");
    expect(calls).toHaveLength(2); // the first call and the callback, nothing duplicated
    expect(calls[1].instructions).toMatch(/keep cancelling/i);
    // Sensitive task facts don't outlive the task.
    expect(done.facts.find((f) => f.key === "account_email")?.value).not.toBe("dylan@example.com");
  });
});

describe("memory carries over to the next call", () => {
  it("brings last week's promise into the call and records that it was broken", async () => {
    await m.seed.seedDemoHistory();
    await say("My bill is wrong again. Can you call them and figure it out?");
    const task = await latest();
    const done = await waitFor(async () => {
      const t = await m.repo.getTask(task.id);
      return t?.status === "completed" ? t : null;
    }, "the Comcast call");
    expect(done.targets[0].name).toBe("Comcast");
    expect(done.memory?.summary).toMatch(/A1832/);
    const [call] = await m.repo.listCalls(task.id);
    expect(call.instructions).toMatch(/A1832/);
    expect(call.analysis?.priorCommitments[0]?.status).toBe("broken");
    expect(done.result?.confirmation).toBe("C7714");
    const events = await m.db.db.select().from(m.schema.events);
    expect(events.some((e) => e.type === "commitment.broken" && e.taskId === task.id)).toBe(true);
  });
});

describe("status questions", () => {
  it("answers from live task state", async () => {
    await say("any update on everything?");
    const msgs = await m.repo.recentMessages("usr_default", 2);
    expect(msgs.at(-1)?.direction).toBe("out");
    expect(msgs.at(-1)?.kind).toBe("status");
  });
});

describe("webhook idempotency", () => {
  it("applies a redelivered Dial event once", async () => {
    const { db } = m.db;
    const { webhookReceipts, messages } = m.schema;
    const user = (await m.repo.getUser("usr_default"))!;
    await db.update(m.schema.users).set({ phone: "+14155550123" });
    const payload = {
      id: "evt_dupe",
      type: "message.received",
      data: { messageId: "msg_provider_1", from: "+14155550123", to: "+14155550100", body: "thanks!", channel: "sms", source: "external" },
    };
    await db.insert(webhookReceipts).values({ id: "dial:evt_dupe", provider: "dial", type: payload.type, payload, status: "received", receivedAt: new Date() });
    await m.background.processWebhookReceipt("dial:evt_dupe");
    await m.background.processWebhookReceipt("dial:evt_dupe");
    // The same message arriving under a second event id is still stored once.
    await db.insert(webhookReceipts).values({ id: "dial:evt_dupe2", provider: "dial", type: payload.type, payload, status: "received", receivedAt: new Date() });
    await m.background.processWebhookReceipt("dial:evt_dupe2");
    const stored = (await db.select().from(messages)).filter((x) => x.providerMessageId === "msg_provider_1");
    expect(stored).toHaveLength(1);
    expect(user.id).toBe("usr_default");
  });
});

describe("no double dialing", () => {
  it("places one call even when the task is advanced twice at once", async () => {
    await say("Book a table for 5 at Nopa around 7:30 tonight");
    const task = await latest();
    await Promise.all([m.orchestrator.advance(task.id), m.orchestrator.advance(task.id)]);
    await waitFor(async () => (await m.repo.getTask(task.id))?.status === "completed", "the reservation");
    const calls = (await m.repo.listCalls(task.id)).filter((c) => c.kind === "business");
    expect(calls).toHaveLength(1);
  });
});
