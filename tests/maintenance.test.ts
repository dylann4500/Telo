import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SimTurn } from "../src/server/voice/mock-scenarios";

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
const TOM = "+14155550124";
const LENA = "+14155550125";

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

describe("a tenant calls Telo's number", () => {
  it("opens a work order from what they said, and texts them back", async () => {
    const { getVoice } = await import("../src/server/voice");
    const { MockVoice } = await import("../src/server/voice/mock");
    const voice = getVoice();
    expect(voice).toBeInstanceOf(MockVoice);
    await (voice as InstanceType<typeof MockVoice>).simulateInboundCall("+14155550127", ["Hi, it's Grace at Linden Court. The dishwasher isn't draining, there's standing water in it."]);
    const task = await workOrder("ten_linden_house");
    expect(task.source).toBe("voice");
    const opened = await waitFor(async () => (await eventsOf(task.id)).find((e) => e.type === "wo.opened"), "the work order to open");
    expect(opened.typed).toMatchObject({ trade: "appliance", intakeChannel: "call" });
    await waitFor(async () => (await messagesOf(task.id)).find((x) => x.party?.id === "ten_linden_house" && x.direction === "out"), "a text back to Grace");
  }, 30_000);
});

describe("vendors who say call back later", () => {
  // The three plumbers, scripted by how many times each has been called in this test.
  const said = new Map<string, number>();
  let lines: Record<string, (n: number) => SimTurn[] | null> = {};
  const them = (text: string): SimTurn => ({ speaker: "other", text });
  const telo = (text: string): SimTurn => ({ speaker: "agent", text });
  const opening = telo("Hi, this is Telo, an AI assistant calling for Dylan at Bayside Property Management; this call is recorded. I have a plumbing job at 905 Pine Ave. When could someone come out?");
  const callback = (line: string) => [them("Hello, dispatch."), opening, them(line), telo("Okay, I'll call you back then. Thanks.")];
  const visit = (line: string, close: string) => [them("Hello, dispatch."), opening, them(line), telo(close)];
  let added = 0;

  beforeAll(async () => {
    const { SCENARIOS } = await import("../src/server/voice/mock-scenarios");
    for (const name of ["Summit Mechanical", "DripFix Plumbing", "FlowRight Plumbing & Rooter"]) {
      SCENARIOS.unshift({
        match: new RegExp(name.split(" ")[0], "i"),
        persona: () => {
          const n = (said.get(name) ?? 0) + 1;
          said.set(name, n);
          return lines[name]?.(n) ?? null;
        },
        script: () => "no_answer",
      });
      added++;
    }
  });
  afterAll(async () => {
    const { SCENARIOS } = await import("../src/server/voice/mock-scenarios");
    SCENARIOS.splice(0, added);
  });

  const plumbers = async () => {
    const { rankVendors } = await import("../src/server/portfolio/insights");
    return (await rankVendors("plumbing")).value.map((s) => s.vendor);
  };
  const until = (id: string, ok: (t: NonNullable<Awaited<ReturnType<Mods["repo"]["getTask"]>>>) => boolean, label: string) =>
    waitFor(async () => {
      const t = await m.repo.getTask(id);
      return t && ok(t) ? t : null;
    }, label);
  const days = (d: Date | null | undefined) => (d!.getTime() - Date.now()) / 86_400_000;

  it("calls back in three days, again in four when asked, books, and replaces a no-show", async () => {
    const [first, second, third] = await plumbers();
    said.clear();
    lines = {
      [first.name]: (n) =>
        n === 1
          ? callback("Our schedule is full this week. Call us back in three days and I'll have openings.")
          : n === 2
            ? callback("Still slammed, sorry. Try us again in four days.")
            : visit("Good news, we had a cancellation. You're booked for tomorrow at 2 pm. The repair is $220, plus our trip fee.", "Tomorrow at 2 PM. Thank you."),
      [second.name]: () => null,
      [third.name]: () => visit("We can be there tomorrow at 10 am. You're booked; it's $195 all in.", "Tomorrow at 10 AM, thank you."),
    };
    await text(TOM, "The bathroom faucet keeps dripping all night.");
    const task = await workOrder("ten_pine_2");

    // The first plumber asks for a call in three days and the second doesn't pick up. A drip can wait.
    const waiting = await until(task.id, (t) => t.status === "scheduled" && Boolean(t.followUp?.callback), "the callback to be scheduled");
    expect(waiting.context?.severity).toBe("routine");
    expect(waiting.followUp?.callback?.targetName).toBe(first.name);
    expect(days(waiting.wakeAt)).toBeGreaterThan(2);
    expect(days(waiting.wakeAt)).toBeLessThan(4);
    let msgs = await messagesOf(task.id);
    expect(msgs.some((x) => !x.party && x.body.includes(`${first.name} asked me to call back`))).toBe(true);
    expect(msgs.some((x) => x.party?.id === "ten_pine_2" && /asked me to call back/.test(x.body))).toBe(true);

    // Called back, they ask again: four more days, on its own.
    expect(await m.orchestrator.wakeTask(task.id)).toBe(true);
    const again = await until(task.id, (t) => t.status === "scheduled" && Boolean(t.wakeAt && t.wakeAt.getTime() > waiting.wakeAt!.getTime() + 12 * 3600_000), "the second callback");
    expect(again.followUp?.callback?.targetName).toBe(first.name);
    expect(days(again.wakeAt)).toBeGreaterThan(3);
    expect(days(again.wakeAt)).toBeLessThan(5);
    expect((await messagesOf(task.id)).some((x) => !x.party && /the second time they've asked/.test(x.body))).toBe(true);

    // The third call books.
    expect(await m.orchestrator.wakeTask(task.id)).toBe(true);
    const booked = await until(task.id, (t) => t.status === "scheduled" && t.context?.stage === "booked", "the booking");
    expect(booked.context?.booked).toMatchObject({ vendor: first.id, cents: 22_000 });
    expect(booked.context?.booked?.callId).toBeTruthy();

    // Nobody came: a no-show on their record, and the next plumber who hasn't been tried is booked.
    expect(await m.orchestrator.wakeTask(task.id)).toBe(true);
    await waitFor(async () => (await messagesOf(task.id)).some((x) => x.party?.id === "ten_pine_2" && /Reply Y or N/.test(x.body)), "the fixed? check");
    await text(TOM, "Nobody ever showed up.");
    const rebooked = await until(task.id, (t) => t.status === "scheduled" && t.context?.booked?.vendor === third.id, "the next plumber's booking");
    expect(rebooked.context?.stage).toBe("booked");
    const evs = await eventsOf(task.id);
    expect(evs.find((e) => e.type === "vendor.outcome")).toMatchObject({ typed: { vendorOutcome: "no_show" }, refs: { vendor: first.id } });
    expect(evs.find((e) => e.type === "commitment.broken")?.refs).toMatchObject({ vendor: first.id });
    expect(evs.filter((e) => e.type === "vendor.booked").map((e) => e.refs?.vendor)).toEqual([first.id, third.id]);
    msgs = await messagesOf(task.id);
    expect(msgs.some((x) => x.party?.id === "ten_pine_2" && new RegExp(`${first.name} didn't show`).test(x.body))).toBe(true);
  }, 60_000);

  it("doesn't let an urgent leak wait three days: the next plumber is called now", async () => {
    const [first, second, third] = await plumbers();
    said.clear();
    lines = {
      [first.name]: () => callback("Our schedule is full this week. Call us back in three days."),
      [second.name]: () => null,
      [third.name]: () => visit("We can come tomorrow at 9 am. You're booked; it's $240 all in.", "Tomorrow at 9 AM, thank you."),
    };
    await text(LENA, "Water is leaking under the kitchen sink and the cabinet is soaked.", 1);
    const task = await workOrder("ten_pine_3");
    const booked = await until(task.id, (t) => t.status === "scheduled" && t.context?.stage === "booked", "the booking");
    expect(booked.context?.severity).toBe("urgent");
    expect(booked.context?.booked?.vendor).toBe(third.id);
    expect((await messagesOf(task.id)).some((x) => !x.party && /shouldn't wait that long, so I'm calling/.test(x.body))).toBe(true);
  }, 60_000);
});
