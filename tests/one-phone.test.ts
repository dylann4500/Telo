import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

// A rehearsal with one phone for every vendor: the same number can't ring
// twice at once, so the vendors are called one after the other. Summit
// can't come until Thursday; Rapid Air books tonight once the owner approves.

const dir = mkdtempSync(path.join(os.tmpdir(), "telo-onephone-"));
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
process.env.TELO_PORTFOLIO_PHONES = JSON.stringify({ ven_summit: "+15105550000", ven_rapidair: "+15105550000" });
delete process.env.DEMO_TARGET_PHONE;
delete process.env.TELO_USER_PHONE;

let m: {
  db: typeof import("../src/server/db/client");
  schema: typeof import("../src/server/db/schema");
  concierge: typeof import("../src/server/concierge");
  repo: typeof import("../src/server/tasks/repo");
};

beforeAll(async () => {
  m = {
    db: await import("../src/server/db/client"),
    schema: await import("../src/server/db/schema"),
    concierge: await import("../src/server/concierge"),
    repo: await import("../src/server/tasks/repo"),
  };
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

let n = 0;
const text = (from: string, body: string, photos = 0) =>
  m.concierge.handleInboundText({ from, body, channel: "sms", providerMessageId: `one_${n++}`, media: Array.from({ length: photos }, (_, i) => `https://example.test/o${n}-${i}.jpg`) });

describe("one phone for every vendor", () => {
  it("calls the vendors one at a time, then books", async () => {
    await text("+14155550122", "Hi, the AC is out again. It's blowing warm air and it's 85 degrees in here.", 2);
    const task = await waitFor(async () => (await m.repo.listRecentTasks("usr_default", 10)).find((t) => t.context?.tenancy === "ten_alder_b"), "the work order");
    const q = await waitFor(
      async () => (await m.db.db.select().from(m.schema.questions).where(eq(m.schema.questions.taskId, task.id))).find((x) => x.status === "open" && (x.context as { party?: { id: string } }).party?.id === "own_shah"),
      "the owner's question",
    );
    expect(q).toBeTruthy();
    await text("+14155550111", "Yes, approve it. And get a replacement quote too.");
    const booked = await waitFor(async () => {
      const t = await m.repo.getTask(task.id);
      return t?.status === "scheduled" && t.context?.stage === "booked" ? t : null;
    }, "the booking");
    expect(booked.plan?.parallel).toBe(false);
    expect(booked.context?.booked?.vendor).toBe("ven_rapidair");
    const calls = (await m.repo.listCalls(task.id)).filter((c) => c.kind === "business").sort((a, b) => a.seq - b.seq);
    expect(calls.map((c) => c.targetName)).toEqual(["Summit Mechanical", "Rapid Air Heating & Cooling"]);
    expect(calls.every((c) => c.targetPhone === "+15105550000")).toBe(true);
    // Never two at once on the one phone.
    expect(calls[1].startedAt!.getTime()).toBeGreaterThanOrEqual(calls[0].endedAt!.getTime());
  }, 60_000);
});
