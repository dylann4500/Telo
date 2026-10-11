import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

// The property-management demo on the simulated stack: Maria texts that Unit
// B's AC is out, with two photos. Telo triages it, ranks the HVAC vendors from
// the portfolio's history (CoolBreeze's two no-shows push it down) and calls
// Summit and Rapid Air at once. Rapid Air's $650 is over Priya's $500 limit,
// so Telo texts her while Luis holds; she approves and asks for a replacement
// quote. Maria gets the window and the entry notice, Summit a polite no. At
// the visit, "fixed" closes the work order with Rapid Air's promise kept.

const dir = mkdtempSync(path.join(os.tmpdir(), "telo-pm-"));
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
delete process.env.DEMO_TARGET_PHONE;
delete process.env.TELO_USER_PHONE;
delete process.env.TELO_PORTFOLIO_PHONES;

const MARIA = "+14155550122";
const PRIYA = "+14155550111";
const AISHA = "+14155550123";

type Mods = {
  db: typeof import("../src/server/db/client");
  schema: typeof import("../src/server/db/schema");
  concierge: typeof import("../src/server/concierge");
  repo: typeof import("../src/server/tasks/repo");
  orchestrator: typeof import("../src/server/orchestrator");
  keewano: typeof import("../src/server/memory/keewano");
};
let m: Mods;

beforeAll(async () => {
  m = {
    db: await import("../src/server/db/client"),
    schema: await import("../src/server/db/schema"),
    concierge: await import("../src/server/concierge"),
    repo: await import("../src/server/tasks/repo"),
    orchestrator: await import("../src/server/orchestrator"),
    keewano: await import("../src/server/memory/keewano"),
  };
  await m.db.ensureDb();
  const { seedPortfolioHistory } = await import("../src/server/portfolio/history");
  await seedPortfolioHistory();
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

let n = 0;
const text = (from: string, body: string, photos = 0) =>
  m.concierge.handleInboundText({ from, body, channel: "sms", providerMessageId: `test_${n++}`, media: Array.from({ length: photos }, (_, i) => `https://example.test/p${n}-${i}.jpg`) });
const workOrder = (tenancy: string) =>
  waitFor(async () => (await m.repo.listRecentTasks("usr_default", 10)).find((t) => t.context?.kind === "maintenance" && t.context.tenancy === tenancy), `a work order for ${tenancy}`);
const status = (id: string, s: string) =>
  waitFor(async () => {
    const t = await m.repo.getTask(id);
    return t?.status === s ? t : null;
  }, `${id} to be ${s}`);
const eventsOf = async (taskId: string) => m.db.db.select().from(m.schema.events).where(eq(m.schema.events.taskId, taskId));
const messagesOf = async (taskId: string) => m.db.db.select().from(m.schema.messages).where(eq(m.schema.messages.taskId, taskId));

describe("a tenant reports a broken AC", () => {
  it("runs from the text to the closed work order", async () => {
    await text(MARIA, "Hi, the AC is out again. It's blowing warm air and it's 85 degrees in here.", 2);
    const task = await workOrder("ten_alder_b");

    // Triage and memory: the unit's history and the vendors' records decide who gets called.
    const calling = await status(task.id, "calling");
    expect(calling.context).toMatchObject({ trade: "hvac", asset: "ast_alder_b_ac", photoCount: 2, replaceQuote: true });
    expect(calling.context?.ranked?.slice(0, 2)).not.toContain("ven_coolbreeze");
    expect(calling.memory?.summary).toMatch(/third ac failure at this unit since June/i);
    expect(calling.memory?.summary).toMatch(/CoolBreeze HVAC no-showed 2 times/);
    const placed = (await m.repo.listCalls(task.id)).filter((c) => c.kind === "business");
    expect(placed.map((c) => c.targetName).sort()).toEqual(["Rapid Air Heating & Cooling", "Summit Mechanical"]);
    expect(placed.every((c) => c.status !== "planned")).toBe(true); // both at once

    // $650 is over the owner's $500 limit: Priya is asked by text while Rapid Air holds.
    const q = await waitFor(
      async () => (await m.db.db.select().from(m.schema.questions).where(eq(m.schema.questions.taskId, task.id))).find((x) => x.status === "open" && (x.context as { party?: { id: string } }).party?.id === "own_shah"),
      "the owner's question",
    );
    expect(q.options.map((o) => o.label)).toContain("Approve $650 and get a replacement quote");
    await text(PRIYA, "Yes, approve it. And get a replacement quote too.");

    // Booked: Maria gets the window and the entry notice, Summit a polite no.
    const booked = await status(task.id, "scheduled");
    expect(booked.context?.stage).toBe("booked");
    expect(booked.context?.booked).toMatchObject({ vendor: "ven_rapidair", cents: 65_000, confirmation: "RA2231", ownerApproved: true });
    const msgs = await messagesOf(task.id);
    expect(msgs.some((x) => x.party?.id === "ten_alder_b" && /notice of entry/.test(x.body))).toBe(true);
    expect(msgs.some((x) => x.party?.id === "ven_summit" && /booked another company/.test(x.body))).toBe(true);
    expect(msgs.some((x) => x.party?.id === "own_shah" && /^Booked Rapid Air/.test(x.body))).toBe(true);

    let evs = await eventsOf(task.id);
    const types = evs.map((e) => e.type);
    for (const t of ["wo.opened", "approval.requested", "approval.granted", "vendor.booked", "entry_notice.sent", "commitment.received"]) expect(types).toContain(t);
    expect(evs.filter((e) => e.type === "quote.received").map((e) => e.typed?.quoteCents).sort()).toEqual([18_000, 65_000]);
    expect(evs.find((e) => e.type === "approval.granted")?.typed).toMatchObject({ approvalKind: "replace", amountCents: 65_000, approvalChannel: "sms", approvalWhileHolding: true });
    expect(evs.find((e) => e.type === "wo.opened")?.typed).toMatchObject({ trade: "hvac", intakeChannel: "mms", photoCount: 2 });

    // The visit: "on the way?" and "fixed?", then Maria's Y closes it.
    expect(await m.orchestrator.wakeTask(task.id)).toBe(true);
    await waitFor(async () => (await messagesOf(task.id)).some((x) => x.party?.id === "ten_alder_b" && /Reply Y or N/.test(x.body)), "the fixed? check");
    await text(MARIA, "Y, it's fixed. Thank you!");
    const done = await status(task.id, "completed");
    expect(done.result?.confirmation).toBe("RA2231");
    evs = await eventsOf(task.id);
    expect(evs.find((e) => e.type === "vendor.outcome")?.typed).toMatchObject({ vendorOutcome: "on_time" });
    expect(evs.find((e) => e.type === "commitment.fulfilled")?.typed).toMatchObject({ commitmentKind: "arrival" });
    expect(evs.find((e) => e.type === "asset.repaired")?.typed).toMatchObject({ assetType: "ac", repairCents: 65_000, repeatWithin90d: true });
    const closed = evs.find((e) => e.type === "wo.completed")!;
    expect(closed.typed).toMatchObject({ woOutcome: "fixed_first_visit", tenantConfirmed: true, managerTouches: 0 });
    // It reaches Keewano on the vendor's, unit's, owner's and firm's streams.
    expect(m.keewano.keewanoEntitiesFor({ ...closed, typed: closed.typed, refs: closed.refs }).map((r) => r.type)).toEqual(["task", "unit", "vendor", "owner", "pm"]);
  }, 60_000);
});

describe("a tenant smells gas", () => {
  it("gets safety instructions first, the manager is paged, and no vendor is called", async () => {
    await text(AISHA, "I smell gas in the kitchen, it's strong");
    const task = await workOrder("ten_pine_1");
    const done = await status(task.id, "completed");
    const msgs = await messagesOf(done.id);
    expect(msgs.some((x) => x.party?.id === "ten_pine_1" && /call 911/.test(x.body))).toBe(true);
    expect(msgs.some((x) => !x.party && x.direction === "out" && /Emergency at 905 Pine Ave/.test(x.body))).toBe(true);
    expect((await eventsOf(done.id)).find((e) => e.type === "emergency.routed")?.typed).toMatchObject({ emergencyKind: "gas", emergencyRoute: "tenant_911" });
    expect((await m.repo.listCalls(done.id)).length).toBe(0);
  }, 30_000);
});

describe("an owner texts with nothing waiting on them", () => {
  it("goes to the manager", async () => {
    await text(PRIYA, "How's the Alder St duplex doing?");
    const fwd = await waitFor(
      async () => (await m.db.db.select().from(m.schema.messages)).find((x) => !x.party && x.direction === "out" && /Priya Shah \(owner\) texted/.test(x.body)),
      "the forwarded text",
    );
    expect(fwd.body).toMatch(/Alder St duplex/);
  });
});
