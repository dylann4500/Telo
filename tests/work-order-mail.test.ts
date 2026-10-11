import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

// Mail and the calendar around a work order: Rapid Air is booked for Unit B
// tonight and the visit goes on the manager's calendar. Then Luis emails to
// move it to tomorrow at 10: the booking, the calendar event, the tenant's
// entry notice and the visit check all follow. Maria answers by email too.

const dir = mkdtempSync(path.join(os.tmpdir(), "telo-mail-"));
process.env.DATABASE_URL = `file:${path.join(dir, "telo.db")}`;
process.env.LLM_PROVIDER = "mock";
process.env.VOICE_PROVIDER = "mock";
process.env.MEMORY_PROVIDER = "local";
process.env.MAIL_PROVIDER = "mock";
process.env.CALENDAR_PROVIDER = "mock";
process.env.MOCK_CALL_SPEED = "40";
process.env.TELO_USER_NAME = "Dylan";
process.env.TELO_LIVE_POLL_SECONDS = "1";
process.env.TELO_LIVE_WAIT_SECONDS = "10";
process.env.TELO_PORTFOLIO_EMAILS = JSON.stringify({ ven_rapidair: "luis@rapidair.example", ten_alder_b: "maria.gomez@example.com" });
delete process.env.TELO_PORTFOLIO_PHONES;
delete process.env.DEMO_TARGET_PHONE;
delete process.env.TELO_USER_PHONE;

let m: {
  db: typeof import("../src/server/db/client");
  schema: typeof import("../src/server/db/schema");
  concierge: typeof import("../src/server/concierge");
  repo: typeof import("../src/server/tasks/repo");
  inbox: typeof import("../src/server/inbox");
  mail: InstanceType<typeof import("../src/server/mail/mock").MockMail>;
  calendar: InstanceType<typeof import("../src/server/calendar/mock").MockCalendar>;
};

beforeAll(async () => {
  const { getMail } = await import("../src/server/mail");
  const { getCalendar } = await import("../src/server/calendar");
  m = {
    db: await import("../src/server/db/client"),
    schema: await import("../src/server/db/schema"),
    concierge: await import("../src/server/concierge"),
    repo: await import("../src/server/tasks/repo"),
    inbox: await import("../src/server/inbox"),
    mail: getMail() as never,
    calendar: getCalendar() as never,
  };
  await m.db.ensureDb();
  await (await import("../src/server/portfolio/history")).seedPortfolioHistory();
  await m.inbox.pollInbox(); // the empty inbox's first look
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
  m.concierge.handleInboundText({ from, body, channel: "sms", providerMessageId: `mail_${n++}`, media: Array.from({ length: photos }, (_, i) => `https://example.test/m${n}-${i}.jpg`) });
const messagesOf = async (taskId: string) => m.db.db.select().from(m.schema.messages).where(eq(m.schema.messages.taskId, taskId));

describe("mail and the calendar on a work order", () => {
  it("puts the visit on the calendar, and a vendor's email moves it", async () => {
    await text("+14155550122", "Hi, the AC is out again. It's blowing warm air and it's 85 degrees in here.", 2);
    const task = await waitFor(async () => (await m.repo.listRecentTasks("usr_default", 10)).find((t) => t.context?.tenancy === "ten_alder_b"), "the work order");
    await waitFor(
      async () => (await m.db.db.select().from(m.schema.questions).where(eq(m.schema.questions.taskId, task.id))).find((x) => x.status === "open" && (x.context as { party?: { id: string } }).party?.id === "own_shah"),
      "the owner's question",
    );
    await text("+14155550111", "Yes, approve it. And get a replacement quote too.");
    const booked = await waitFor(async () => {
      const t = await m.repo.getTask(task.id);
      return t?.status === "scheduled" && t.context?.booked?.calendarEventId ? t : null;
    }, "the booking on the calendar");
    const event = m.calendar.created.find((e) => e.id === booked.context!.booked!.calendarEventId)!;
    expect(event.title).toBe("Rapid Air Heating & Cooling: AC not cooling at 1418 Alder St, Unit B");
    expect(event.description).toMatch(/Tenant: Maria Gomez\. Confirmation RA2231\./);
    expect(event.start.toISOString()).toBe(booked.context!.booked!.startsAt);

    // Luis emails to move the visit to tomorrow at 10.
    m.mail.deliver({ from: "luis@rapidair.example", fromName: "Luis Ortega", subject: "Tonight's visit at Alder St", text: "Hi, our tech is stuck on another job. Can we move the visit to tomorrow at 10 am instead?\n\nLuis\nRapid Air Heating & Cooling" });
    expect(await m.inbox.pollInbox()).toBe(1);
    const moved = (await m.repo.getTask(task.id))!;
    const start = new Date(moved.context!.booked!.startsAt!);
    expect(start.getTime()).not.toBe(new Date(booked.context!.booked!.startsAt!).getTime());
    expect(start.getTime() - Date.now()).toBeGreaterThan(8 * 3600_000);
    expect(moved.context).toMatchObject({ stage: "booked", reschedules: 1, accessConfirmed: false });
    expect(moved.wakeAt!.getTime()).toBe(start.getTime() + 30 * 60_000);
    expect(event.start.getTime()).toBe(start.getTime()); // the calendar event moved with it
    const msgs = await messagesOf(task.id);
    expect(msgs.some((x) => x.party?.id === "ven_rapidair" && x.direction === "in" && x.channel === "email")).toBe(true);
    expect(msgs.some((x) => x.party?.id === "ten_alder_b" && /moved the visit to tomorrow at 10 AM\. This is your updated notice of entry/.test(x.body))).toBe(true);
    expect(msgs.some((x) => !x.party && /Rapid Air Heating & Cooling emailed to move the visit at 1418 Alder St, Unit B to tomorrow at 10 AM.*I moved it on your calendar/.test(x.body))).toBe(true);

    // Maria answers the new notice by email: the same as her text.
    m.mail.deliver({ from: "maria.gomez@example.com", fromName: "Maria Gomez", subject: "Re: Notice of entry", text: "Yes, that works for me.\n\nOn Sun, Telo wrote:\n> moved the visit" });
    expect(await m.inbox.pollInbox()).toBe(1);
    const ok = (await m.repo.getTask(task.id))!;
    expect(ok.context?.accessConfirmed).toBe(true);
    expect((await messagesOf(task.id)).some((x) => x.party?.id === "ten_alder_b" && x.direction === "in" && x.channel === "email" && x.body === "Yes, that works for me.")).toBe(true);
  }, 60_000);
});
