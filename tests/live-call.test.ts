import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { SimTurn } from "../src/server/voice/mock-scenarios";

// Telo's help during a call, on the simulated line: the business asks for
// something only the user has, the agent asks through ask_user and waits
// (wait_for_answer) while the user answers by text; a decision made while
// the business waits; nobody answering in time; and a calendar check before
// accepting a time. The mock line calls the same tool code Dial's agent
// reaches through /api/mcp.

const dir = mkdtempSync(path.join(os.tmpdir(), "telo-live-"));
process.env.DATABASE_URL = `file:${path.join(dir, "telo.db")}`;
process.env.LLM_PROVIDER = "mock";
process.env.VOICE_PROVIDER = "mock";
process.env.MEMORY_PROVIDER = "local";
process.env.MAIL_PROVIDER = "off";
process.env.CALENDAR_PROVIDER = "mock";
process.env.MOCK_CALL_SPEED = "40";
process.env.TELO_USER_NAME = "Dylan";
process.env.TELO_LIVE_POLL_SECONDS = "1";
process.env.TELO_LIVE_WAIT_SECONDS = "4";
delete process.env.DEMO_TARGET_PHONE;
delete process.env.TELO_USER_PHONE;

const other = (text: string): SimTurn => ({ speaker: "other", text });
const agentSays = (text: string, more: Partial<SimTurn> = {}): SimTurn => ({ speaker: "agent", text, ...more });
const hello = agentSays("Hi, this is Telo, an AI assistant calling on behalf of Dylan.");
const askAccount: SimTurn[] = [
  agentSays("Let me check with Dylan, one moment.", { tool: { name: "ask_customer", args: { detail: "Account number", question: "What's the account number on the bill?" } } }),
  agentSays("", { tool: { name: "wait_for_customer" } }),
];

const BUSINESSES: { name: string; phone: string; calls: SimTurn[][] }[] = [
  {
    name: "Westbay Telecom",
    phone: "+14155550301",
    calls: [
      [
        hello,
        other("I can help with the late fee. I'll need the account number to pull it up."),
        ...askAccount,
        agentSays("It's {answer}.", { orElse: "I'll get that from Dylan and call you back." }),
        other("Thanks, found it. I've removed the late fee. Your confirmation number is WB7781."),
        agentSays("Thank you, WB7781."),
      ],
    ],
  },
  {
    name: "Eastline Gas",
    phone: "+14155550302",
    calls: [
      [
        hello,
        other("Sure. I'll need the account number to pull it up."),
        ...askAccount,
        agentSays("It's {answer}.", { orElse: "I'll get that from Dylan and call you back." }),
        other("No problem, call us back with it anytime."),
      ],
    ],
  },
  {
    name: "Northstar Fitness",
    phone: "+14155550303",
    calls: [
      [
        hello,
        other("Before I cancel, we can offer $18 a month instead of $65 if Dylan stays."),
        agentSays("Let me check with Dylan, one moment.", {
          tool: { name: "ask_customer", args: { detail: "Accept the $18/month offer?", question: "They offered $18/month to stay instead of cancelling.", options: ["Accept $18/month", "Keep cancelling"] } },
        }),
        agentSays("", { tool: { name: "wait_for_customer" } }),
        agentSays("Dylan says: {answer}.", { orElse: "I'll confirm with Dylan and call back." }),
        other("Understood. I've cancelled the membership. Your confirmation number is NS1234."),
        agentSays("Thank you, NS1234."),
      ],
    ],
  },
  {
    name: "Lakeshore Orthodontics",
    phone: "+14155550304",
    calls: [
      [
        hello,
        other("We can see Dylan next Tuesday at 10 am."),
        agentSays("Let me check Dylan's calendar.", { tool: { name: "check_calendar", args: { time: "Tuesday at 10 am" } } }),
        agentSays("That works for Dylan.", { orElse: "Dylan is busy then. Do you have anything later?" }),
        other("How about Tuesday at 2 pm?"),
        agentSays("Let me check.", { tool: { name: "check_calendar", args: { time: "Tuesday at 2 pm" } } }),
        agentSays("Tuesday at 2 works. Please book it.", { orElse: "That doesn't work either." }),
        other("You're booked for Tuesday at 2 pm. Confirmation LD5512."),
        agentSays("Thank you, LD5512."),
      ],
    ],
  },
];

type Mods = {
  db: typeof import("../src/server/db/client");
  schema: typeof import("../src/server/db/schema");
  concierge: typeof import("../src/server/concierge");
  repo: typeof import("../src/server/tasks/repo");
  live: typeof import("../src/server/live-call");
  calendar: typeof import("../src/server/calendar");
};
let m: Mods;

beforeAll(async () => {
  m = {
    db: await import("../src/server/db/client"),
    schema: await import("../src/server/db/schema"),
    concierge: await import("../src/server/concierge"),
    repo: await import("../src/server/tasks/repo"),
    live: await import("../src/server/live-call"),
    calendar: await import("../src/server/calendar"),
  };
  await m.db.ensureDb();
  const { SCENARIOS } = await import("../src/server/voice/mock-scenarios");
  const { orgKeyFor } = await import("../src/server/ids");
  for (const b of BUSINESSES) {
    let n = 0;
    SCENARIOS.unshift({ match: new RegExp(`^${b.name}$`, "i"), persona: () => b.calls[Math.min(n++, b.calls.length - 1)], script: () => b.calls[0] });
    await m.db.db.insert(m.schema.organizations).values({ key: orgKeyFor(b.name), name: b.name, phone: b.phone, aliases: [] }).onConflictDoNothing();
  }
});

async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, label: string, ms = 20_000): Promise<T> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const say = (text: string) => m.concierge.handleWebMessage("usr_default", text);
const taskFor = (title: RegExp) => waitFor(async () => (await m.repo.listRecentTasks("usr_default", 10)).find((t) => title.test(t.request)), `a task for ${title}`);
const status = (id: string, s: string) => waitFor(async () => {
  const t = await m.repo.getTask(id);
  return t?.status === s ? t : null;
}, `${id} to be ${s}`);
const liveQuestion = (id: string) => waitFor(() => m.repo.openLiveQuestion(id), "a question asked during the call");
const businessCalls = async (id: string) => (await m.repo.listCalls(id)).filter((c) => c.kind === "business");
const sent = async (id: string) => (await m.db.db.select().from(m.schema.messages).where(eq(m.schema.messages.taskId, id))).filter((x) => x.direction === "out").map((x) => x.body);

describe("the business needs a detail during the call", () => {
  it("asks the user while they wait, passes the answer on in the same call, and finishes", async () => {
    await say("Ask Westbay Telecom to remove the late fee on my bill");
    const task = await taskFor(/Westbay/);
    const q = await liveQuestion(task.id);
    expect(q.kind).toBe("info");
    expect(q.fields.map((f) => f.key)).toEqual(["account_number"]);
    expect((await sent(task.id)).some((b) => /on the phone with Westbay Telecom and they need your account number/i.test(b))).toBe(true);
    expect((await m.repo.getTask(task.id))?.statusDetail).toMatch(/Waiting on you: account number/);

    await say("55012");
    const done = await status(task.id, "completed");
    const calls = await businessCalls(task.id);
    expect(done.result?.confirmation).toBe("WB7781");
    expect(calls).toHaveLength(1); // no callback needed
    expect(calls[0].transcript.map((t) => t.text)).toContain("It's 55012.");
    expect((await sent(task.id)).some((b) => /Telling Westbay Telecom now/.test(b))).toBe(true);
    const events = await m.db.db.select().from(m.schema.events).where(eq(m.schema.events.taskId, task.id));
    expect(events.map((e) => e.type)).toContain("call.asked_user");

    // The task page's flow: one step per stage, the mid-call exchange inside the call.
    const { buildTaskDetail } = await import("../src/server/dto");
    const flow = (await buildTaskDetail(task.id))!.flow;
    expect(flow.map((s) => s.kind)).toEqual(["request", "understand", "memory", "plan", "call", "done"]);
    const call = flow.find((s) => s.kind === "call")!;
    expect(call.title).toBe("Called Westbay Telecom");
    expect(call.badges).toContain("WB7781");
    expect(call.children.map((c) => c.title)).toEqual(expect.arrayContaining(["Asked you while they waited", "You answered"]));
    expect(call.told.map((t) => t.body).join(" ")).toMatch(/on the phone with Westbay Telecom/);
    expect(flow.at(-1)?.decided).toBe(true);
    expect(flow.find((s) => s.kind === "understand")?.decided).toBe(false);
  });

  it("if the user doesn't answer in time, the agent wraps up and Telo asks the usual way", async () => {
    await say("Ask Eastline Gas why my bill doubled");
    const task = await taskFor(/Eastline/);
    const q = await liveQuestion(task.id);
    const waiting = await status(task.id, "needs_info");
    const calls = await businessCalls(task.id);
    expect(calls[0].transcript.map((t) => t.text)).toContain("I'll get that from Dylan and call you back.");
    expect(calls[0].transcript.some((t) => /still checking|bearing with me/.test(t.text))).toBe(true); // something said while waiting
    const lapsed = (await m.repo.listQuestions(task.id)).find((x) => x.id === q.id);
    expect(lapsed?.status).toBe("cancelled");
    const open = await m.repo.openQuestion(task.id);
    expect(open?.fields.map((f) => f.key)).toEqual(["account_number"]);
    expect((open?.context as { live?: boolean }).live).toBeUndefined();
    expect(waiting.followUp?.callback?.targetName).toBe("Eastline Gas");
  });
});

describe("a decision while the business waits", () => {
  it("takes the user's choice mid-call and acts on it without a callback", async () => {
    await say("Cancel my Northstar Fitness membership, the email on it is dylan@example.com");
    const task = await taskFor(/Northstar/);
    const q = await liveQuestion(task.id);
    expect(q.kind).toBe("approval");
    expect(q.options.map((o) => o.label)).toEqual(["Accept $18/month", "Keep cancelling"]);
    await say("keep cancelling");
    const done = await status(task.id, "completed");
    expect(done.result?.confirmation).toBe("NS1234");
    expect(await businessCalls(task.id)).toHaveLength(1);
    const call = (await businessCalls(task.id))[0];
    expect(call.transcript.map((t) => t.text)).toContain("Dylan says: Keep cancelling.");
    expect(call.analysis?.outcome).toBe("success");
  });
});

describe("checking the calendar during the call", () => {
  it("turns down a busy time, accepts a free one, and books it", async () => {
    const tz = "America/Los_Angeles";
    const ten = (await m.live.resolveSpokenTime("Tuesday at 10 am", tz))!;
    const cal = m.calendar.getCalendar() as unknown as { addBusy(a: Date, b: Date): void; created: { title: string; start: Date }[] };
    cal.addBusy(ten, new Date(ten.getTime() + 3600_000));
    await say("Book a cleaning at Lakeshore Orthodontics");
    const task = await taskFor(/Lakeshore/);
    const done = await status(task.id, "completed");
    expect(done.result?.confirmation).toBe("LD5512");
    const call = (await businessCalls(task.id))[0];
    const lines = call.transcript.map((t) => t.text);
    expect(lines).toContain("Dylan is busy then. Do you have anything later?");
    expect(lines).toContain("Tuesday at 2 works. Please book it.");
    const checks = (await m.db.db.select().from(m.schema.events).where(eq(m.schema.events.taskId, task.id))).filter((e) => e.type === "calendar.checked");
    expect(checks.map((e) => (e.data as { free: boolean }).free)).toEqual([false, true]);
    expect(cal.created.some((e) => /Lakeshore/.test(e.title))).toBe(true);
  });
});

describe("who may use which tool", () => {
  it("lists every tool and checks the caller on each request", async () => {
    const { POST } = await import("../src/app/api/mcp/route");
    const rpc = async (body: unknown, headers: Record<string, string> = {}) =>
      (await POST(new Request("http://x/api/mcp", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }))).json();
    const list = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(["get_status", "ask_telo", "report_progress", "ask_customer", "wait_for_customer", "check_calendar"]);

    // A stranger calling in can't ask Telo for anything.
    const stranger = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_status", arguments: {} } }, { "x-dial-direction": "inbound", "x-dial-user-number": "+14155559999" });
    expect(stranger.result.isError).toBe(true);
    // No call in progress with that number: no ask_user.
    const nobody = await rpc(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "ask_customer", arguments: { detail: "Account number", question: "?" } } },
      { "x-dial-direction": "outbound", "x-dial-user-number": "+14155550301" },
    );
    expect(nobody.result.isError).toBe(true);
  });

  it("never asks the user for a PIN, and doesn't ask for what the user already gave", async () => {
    const id = "tsk_live_rules";
    await m.db.db.insert(m.schema.tasks).values({
      id,
      userId: "usr_default",
      title: "Raise the limit at Harbor Bank",
      request: "Raise the limit at Harbor Bank",
      source: "web",
      status: "calling",
      targets: [{ name: "Harbor Bank", phone: "+14155550399", kind: "business" }],
      facts: [{ key: "account_number", label: "Account number", value: "88213", sensitive: true, source: "user" }],
    });
    await m.db.db.insert(m.schema.calls).values({ id: "call_live_rules", userId: "usr_default", taskId: id, direction: "outbound", kind: "business", seq: 1, targetName: "Harbor Bank", targetPhone: "+14155550399", purpose: "Raise the limit", status: "in_progress" });
    const headers = { direction: "outbound", other: "+14155550399" };
    const pin = await m.live.callTool("ask_customer", { detail: "Account PIN", question: "What's your PIN?" }, headers);
    expect(pin.text).toMatch(/Never ask Dylan for that/);
    const known = await m.live.callTool("ask_customer", { detail: "Account number", question: "What's the account number?" }, headers);
    expect(known.text).toMatch(/already gave Telo this. Account number: 88213/);
    expect(await m.repo.openQuestion(id)).toBeUndefined();
    const nothingAsked = await m.live.callTool("wait_for_customer", {}, headers);
    expect(nothingAsked.text).toMatch(/haven't asked/);
  });
});
