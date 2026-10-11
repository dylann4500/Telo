import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaceCallInput, VoiceProvider } from "../src/server/voice/provider";

// "Text me" or "Text + call me": with calls on, anything that needs the user
// or reports a call also rings their phone, inside waking hours (or any time
// a business is waiting on the line, or while they're up talking to Telo).
// A recording fake stands in for Dial, so nothing is dialed or texted.

const dir = mkdtempSync(path.join(os.tmpdir(), "telo-updates-"));
process.env.DATABASE_URL = `file:${path.join(dir, "telo.db")}`;
process.env.LLM_PROVIDER = "mock";
process.env.VOICE_PROVIDER = "mock";
process.env.MEMORY_PROVIDER = "local";
process.env.MAIL_PROVIDER = "mock";
process.env.CALENDAR_PROVIDER = "off";
process.env.TELO_USER_NAME = "Dylan";
process.env.TELO_USER_PHONE = "+15555550123";
process.env.TELO_USER_CHANNEL = "sms";
delete process.env.DEMO_TARGET_PHONE;
delete process.env.TELO_CALL_UPDATES;

// Tue Oct 13 2026 in Los Angeles: 11:00 AM and 2:30 AM.
const DAY = new Date("2026-10-13T18:00:00Z");
const NIGHT = new Date("2026-10-13T09:30:00Z");

type Mods = {
  db: typeof import("../src/server/db/client");
  schema: typeof import("../src/server/db/schema");
  notify: typeof import("../src/server/notify");
  concierge: typeof import("../src/server/concierge");
  repo: typeof import("../src/server/tasks/repo");
  voice: typeof import("../src/server/voice");
  ingest: typeof import("../src/server/voice/ingest");
  background: typeof import("../src/server/background");
  inbox: typeof import("../src/server/inbox");
  mail: typeof import("../src/server/mail");
  seed: typeof import("../src/server/db/seed");
};
let m: Mods;
const texts: { to: string; body: string }[] = [];
const dialed: PlaceCallInput[] = [];

const fakeDial: VoiceProvider = {
  name: "dial",
  async placeCall(input) {
    dialed.push(input);
    return { providerCallId: `prov_${dialed.length}_${Date.now()}`, status: "queued" };
  },
  async getCall() {
    throw new Error("not used");
  },
  async stopCall() {},
  async sendMessage(input) {
    texts.push({ to: input.to, body: input.body });
    return { providerMessageId: `pm_${texts.length}_${Math.random().toString(36).slice(2)}` };
  },
  async setInboundInstruction() {},
};

beforeAll(async () => {
  m = {
    db: await import("../src/server/db/client"),
    schema: await import("../src/server/db/schema"),
    notify: await import("../src/server/notify"),
    concierge: await import("../src/server/concierge"),
    repo: await import("../src/server/tasks/repo"),
    voice: await import("../src/server/voice"),
    ingest: await import("../src/server/voice/ingest"),
    background: await import("../src/server/background"),
    inbox: await import("../src/server/inbox"),
    mail: await import("../src/server/mail"),
    seed: await import("../src/server/db/seed"),
  };
  await m.db.ensureDb();
});

beforeEach(async () => {
  texts.length = 0;
  dialed.length = 0;
  m.voice.setVoiceForTests(fakeDial);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(DAY);
  const { db, schema } = m;
  await db.db.delete(schema.messages);
  await db.db.delete(schema.calls);
  await db.db.update(schema.users).set({ callUpdates: true });
});

afterEach(() => {
  vi.useRealTimers();
  m.voice.setVoiceForTests(undefined);
});

async function voiceTask(title = "Ask Bayside Internet about the fee") {
  const id = `tsk_${Math.random().toString(36).slice(2, 10)}`;
  await m.db.db.insert(m.schema.tasks).values({ id, userId: "usr_default", title, request: title, source: "voice", status: "calling", targets: [{ name: "Bayside Internet", phone: "+15555550199", kind: "business" }] });
  return id;
}

const say = (userId: string, body: string, kind: "result" | "update" | "question" | "report" | "approval", taskId: string, extra: { urgent?: boolean; noCall?: boolean } = {}) =>
  m.notify.notify({ userId, taskId, body, kind, dedupeKey: `${kind}:${taskId}:${body.length}`, ...extra });

/** The call Telo placed to the user is over, so the next one can ring. */
const hangUp = () => m.db.db.update(m.schema.calls).set({ status: "ended" });
const emailTask = async () => (await m.db.db.select().from(m.schema.tasks)).filter((t) => t.source === "email").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

const outbound = async (taskId?: string) =>
  (await m.db.db.select().from(m.schema.messages)).filter((x) => x.direction === "out" && (!taskId || x.taskId === taskId));

describe("calls on (the default)", () => {
  it("texts and also calls for a result, during the day", async () => {
    const task = await voiceTask();
    await say("usr_default", "Bayside removed the $15 fee. Confirmation B4410.", "result", task);
    expect(texts.map((t) => t.body)).toEqual(["Bayside removed the $15 fee. Confirmation B4410."]);
    expect(dialed).toHaveLength(1);
    expect(dialed[0].to).toBe("+15555550123");
    expect(dialed[0].instructions).toContain("Bayside removed the $15 fee");
    const rows = await outbound(task);
    expect(rows.map((r) => r.channel).sort()).toEqual(["sms", "voice"]);
  });

  it("only texts plain progress updates", async () => {
    const task = await voiceTask();
    await say("usr_default", "Calling Bayside now.", "update", task);
    expect(texts).toHaveLength(1);
    expect(dialed).toHaveLength(0);
  });

  it("calls for news from a call (report) and for questions", async () => {
    const task = await voiceTask();
    await say("usr_default", "They asked me to call back Wednesday.", "report", task);
    await hangUp();
    await say("usr_default", "What's your account number?", "question", task);
    expect(dialed).toHaveLength(2);
  });

  it("at night, only texts, unless the user has been talking to Telo or a business is waiting on the line", async () => {
    vi.setSystemTime(NIGHT);
    const task = await voiceTask();
    await say("usr_default", "Done: the refund went through.", "result", task);
    expect(texts).toHaveLength(1);
    expect(dialed).toHaveLength(0);

    await say("usr_default", "Bayside needs your account number. What is it?", "question", task, { urgent: true });
    expect(dialed).toHaveLength(1);
    await hangUp();

    await m.db.db.insert(m.schema.messages).values({ id: "msg_in_recent", userId: "usr_default", direction: "in", channel: "sms", kind: "chat", body: "any update?", status: "received" });
    await say("usr_default", "Pacific Coast says the refund is processed.", "result", task);
    expect(dialed).toHaveLength(2);
  });

  it("doesn't ring the user while they're already on the phone with Telo", async () => {
    const task = await voiceTask();
    await m.db.db.insert(m.schema.calls).values({ id: "call_user_live", userId: "usr_default", direction: "inbound", kind: "user_inbound", targetName: "Dylan", targetPhone: "+15555550123", purpose: "Dylan called Telo", status: "in_progress" });
    await say("usr_default", "Bayside removed the fee.", "result", task);
    expect(texts).toHaveLength(1);
    expect(dialed).toHaveLength(0);
  });

  it("never calls for a reminder (noCall)", async () => {
    const task = await voiceTask();
    await say("usr_default", "Still need you: what's the account number?", "question", task, { noCall: true });
    expect(dialed).toHaveLength(0);
  });

  it("a text the carrier rejects is marked failed and no longer becomes a call by itself", async () => {
    vi.setSystemTime(NIGHT); // outside calling hours, so the result only went out as a text
    const task = await voiceTask();
    await say("usr_default", "Done: fee removed.", "result", task);
    const sms = (await outbound(task)).find((r) => r.channel === "sms")!;
    await m.ingest.ingestVoiceEvent({ kind: "message.status", providerMessageId: sms.providerMessageId!, deliveryState: "failed", error: "unregistered sender" });
    const after = (await outbound(task)).find((r) => r.id === sms.id)!;
    expect(after.status).toBe("failed");
    expect(dialed).toHaveLength(0);
  });
});

describe("texts only", () => {
  it("the dashboard toggle turns calls off", async () => {
    await m.concierge.setCallUpdates("usr_default", false, "dashboard");
    const task = await voiceTask();
    await say("usr_default", "Bayside removed the $15 fee. Confirmation B4410.", "result", task);
    expect(texts).toHaveLength(1);
    expect(dialed).toHaveLength(0);
  });

  it('"just text me" and "call me with updates" change it by message', async () => {
    m.voice.setVoiceForTests(undefined); // the simulated line: replies go to the dashboard thread
    await m.concierge.handleWebMessage("usr_default", "just text me from now on");
    expect((await m.repo.getUser("usr_default"))?.callUpdates).toBe(false);
    expect((await m.repo.recentMessages("usr_default", 1)).at(-1)?.body).toMatch(/just text you/);
    await m.concierge.handleWebMessage("usr_default", "actually call me with updates too");
    expect((await m.repo.getUser("usr_default"))?.callUpdates).toBe(true);
    expect((await m.repo.recentMessages("usr_default", 1)).at(-1)?.body).toMatch(/call too/);
  });

  it("restarting the app keeps the user's choice", async () => {
    await m.concierge.setCallUpdates("usr_default", false, "dashboard");
    await m.seed.seedBaseline();
    expect((await m.repo.getUser("usr_default"))?.callUpdates).toBe(false);
  });
});

describe("a call Telo offers from an email", () => {
  it("found at night: waits on the dashboard, then goes out once as a text in the morning", async () => {
    vi.setSystemTime(NIGHT);
    const mail = m.mail.getMail() as import("../src/server/mail/mock").MockMail;
    mail.deliver({ from: "billing@coastline.example", fromName: "Coastline Cable", subject: "Your bill went up", text: "Hi Dylan, your bill went from $70.00 to $85.00 because of a new equipment fee. Please call us if this looks wrong." });
    await m.inbox.pollInbox();
    const task = await emailTask();
    expect(task.status).toBe("needs_approval");
    expect(texts).toHaveLength(0);
    expect(dialed).toHaveLength(0);
    expect((await outbound(task.id)).map((r) => r.channel)).toEqual(["web"]);

    await m.background.deliverMorningOffers(); // still night: nothing
    expect(texts).toHaveLength(0);

    vi.setSystemTime(new Date("2026-10-13T15:05:00Z")); // 8:05 AM
    await m.background.deliverMorningOffers();
    await m.background.deliverMorningOffers();
    expect(texts).toHaveLength(1);
    expect(texts[0].body).toMatch(/Coastline Cable emailed/);
    expect(dialed).toHaveLength(0); // overnight finds never ring the phone
    const q = await m.repo.openQuestion(task.id);
    expect((q?.context as { deferred?: boolean }).deferred).toBe(false);
  });

  it("found during the day: texts and, with calls on, calls", async () => {
    const mail = m.mail.getMail() as import("../src/server/mail/mock").MockMail;
    mail.deliver({ from: "billing@sunnet.example", fromName: "SunNet Fiber", subject: "Charge on your account", text: "Hi Dylan, a $40.00 late fee was added to your account. Please call us if this looks wrong." });
    await m.inbox.pollInbox();
    const task = await emailTask();
    expect(task.status).toBe("needs_approval");
    expect(texts.at(-1)?.body).toMatch(/SunNet Fiber emailed/);
    expect(dialed).toHaveLength(1);
  });
});

describe("after Telo calls the user", () => {
  it("their thanks on the call doesn't get a text back", async () => {
    m.voice.setVoiceForTests(undefined);
    const before = (await outbound()).length;
    await m.concierge.handleUserInput({ user: (await m.repo.getUser("usr_default"))!, text: "TELO: Hi Dylan, it's Telo. Your refund went through.\nDYLAN: Hello? Thanks so much.", channel: "voice", via: "call_transcript" });
    expect((await outbound()).length).toBe(before);
  });
});

