import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { LLM } from "../src/server/agent/llm";
import type { SimTurn } from "../src/server/voice/mock-scenarios";

// The calls that don't go to plan: a business that says "call back in 3
// days", one that doesn't pick up, one that needs a detail Telo doesn't
// have, a wrong number, an account-holder-only policy, a business that
// promises to call back (and does), a call the user wants later, a
// business that stalls forever, and one that asks for a PIN. Rule-based
// model and canned businesses, so it runs offline in seconds; time is
// fast-forwarded by moving the task's wake time into the past.

const dir = mkdtempSync(path.join(os.tmpdir(), "telo-autonomy-"));
process.env.DATABASE_URL = `file:${path.join(dir, "telo.db")}`;
process.env.LLM_PROVIDER = "mock";
process.env.VOICE_PROVIDER = "mock";
process.env.MEMORY_PROVIDER = "local";
process.env.MOCK_CALL_SPEED = "40";
process.env.TELO_USER_NAME = "Dylan";
process.env.TELO_MAX_CALLS_PER_TASK = "3";
delete process.env.DEMO_TARGET_PHONE;
delete process.env.TELO_USER_PHONE;

const other = (text: string): SimTurn => ({ speaker: "other", text });
const agentSays = (text: string): SimTurn => ({ speaker: "agent", text });
const hello = agentSays("Hi, this is Telo, an AI assistant calling on behalf of Dylan.");

// Each business answers its nth call with the nth script ("no_answer" = it rings out).
const BUSINESSES: { name: string; phone: string; calls: (SimTurn[] | "no_answer")[] }[] = [
  {
    name: "Delta Airlines",
    phone: "+14155550101",
    calls: [
      [hello, other("Your refund request is in, but it takes three business days to process. Call back in 3 days and I can confirm it went through."), agentSays("Will do, thanks.")],
      [hello, other("Yes, I see it. The refund of $212 was processed this morning. Your reference number is RF5521."), agentSays("Thank you, RF5521.")],
    ],
  },
  {
    name: "Sunset Plumbing",
    phone: "+14155550102",
    calls: ["no_answer", [hello, other("Sunset Plumbing. Sure, we can come Tuesday at 9 AM. You're booked, confirmation SP4410."), agentSays("Great, SP4410.")]],
  },
  {
    name: "Northwind Telecom",
    phone: "+14155550103",
    calls: [
      [hello, other("I can help with that, but I'll need the account number to pull up the bill."), agentSays("I'll get it from Dylan and call back.")],
      [hello, other("Thanks, found it. I've removed the late fee. Confirmation NW7781."), agentSays("Thank you, NW7781.")],
    ],
  },
  {
    name: "Cedar Bank",
    phone: "+14155550110",
    calls: [
      [hello, other("I'll need the account number for that. We're closed for the weekend, so call back tomorrow with it."), agentSays("Will do, thank you.")],
      [hello, other("Got it. The overdraft fee is refunded. Confirmation CB4120."), agentSays("Thanks, CB4120.")],
    ],
  },
  {
    name: "Lumen Energy",
    phone: "+14155550112",
    calls: [[hello, other("Lumen Energy, how can I help?")]],
  },
  {
    name: "Pacific Gas",
    phone: "+14155550104",
    calls: [[hello, other("I'm sorry, for privacy I can only speak with the account holder. The account holder has to call us directly."), agentSays("Understood, thank you.")]],
  },
  {
    name: "Golden Crust Pizza",
    phone: "+14155550105",
    calls: [
      [hello, other("Hello? No, this is a private residence. You have the wrong number."), agentSays("Sorry to bother you.")],
      [hello, other("Golden Crust! A large pepperoni for pickup at 6:30 is all set under Dylan. Your confirmation number is GC3301."), agentSays("Thanks, GC3301.")],
    ],
  },
  {
    name: "Bayview Clinic",
    phone: "+14155550106",
    calls: [[hello, other("The doctor has to approve the refill first. We'll call you back tomorrow once she signs off."), agentSays("Thank you, we'll wait for your call.")]],
  },
  {
    name: "Mesa Pharmacy",
    phone: "+14155550111",
    calls: [[hello, other("It's not ready yet. We'll call you back tomorrow when it's ready."), agentSays("Thank you.")]],
  },
  {
    name: "Lakeside Orthodontics",
    phone: "+14155550107",
    calls: [[hello, other("Sure, I've moved the cleaning to Friday at 2 PM. Your confirmation number is LO5512."), agentSays("Thanks, LO5512.")]],
  },
  {
    name: "Evergreen Bank",
    phone: "+14155550108",
    calls: Array.from({ length: 5 }, () => [hello, other("I can't decide that today. Call back tomorrow and ask for a supervisor."), agentSays("Okay, thanks.")]),
  },
  {
    name: "Harbor Credit Union",
    phone: "+14155550109",
    calls: [[hello, other("For security I need the PIN on the account before I can make changes."), agentSays("I'm not able to share that. Dylan will contact you directly.")]],
  },
];

type Mods = {
  db: typeof import("../src/server/db/client");
  schema: typeof import("../src/server/db/schema");
  concierge: typeof import("../src/server/concierge");
  repo: typeof import("../src/server/tasks/repo");
  background: typeof import("../src/server/background");
  voice: typeof import("../src/server/voice");
  llm: typeof import("../src/server/agent/llm");
};
let m: Mods;

beforeAll(async () => {
  m = {
    db: await import("../src/server/db/client"),
    schema: await import("../src/server/db/schema"),
    concierge: await import("../src/server/concierge"),
    repo: await import("../src/server/tasks/repo"),
    background: await import("../src/server/background"),
    voice: await import("../src/server/voice"),
    llm: await import("../src/server/agent/llm"),
  };
  await m.db.ensureDb();
  const { SCENARIOS } = await import("../src/server/voice/mock-scenarios");
  const { orgKeyFor } = await import("../src/server/ids");
  for (const b of BUSINESSES) {
    let n = 0;
    SCENARIOS.unshift({ match: new RegExp(`^${b.name}$`, "i"), persona: b.name, script: () => b.calls[Math.min(n++, b.calls.length - 1)] });
    await m.db.db.insert(m.schema.organizations).values({ key: orgKeyFor(b.name), name: b.name, phone: b.phone, aliases: [] }).onConflictDoNothing();
  }
});

async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, label: string, ms = 15_000): Promise<T> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const say = (text: string) => m.concierge.handleWebMessage("usr_default", text);
const latest = async () => (await m.repo.listRecentTasks("usr_default", 1))[0];
const status = (id: string, s: string) => waitFor(async () => {
  const t = await m.repo.getTask(id);
  return t?.status === s ? t : null;
}, `${id} to be ${s}`);
const businessCalls = async (id: string) => (await m.repo.listCalls(id)).filter((c) => c.kind === "business");
const lastMessage = async (taskId: string) => (await m.db.db.select().from(m.schema.messages).where(eq(m.schema.messages.taskId, taskId))).filter((x) => x.direction === "out").at(-1)?.body ?? "";

/** Time passes: the scheduled moment arrives and the background loop wakes the task. */
async function fastForward(taskId: string) {
  await m.db.db.update(m.schema.tasks).set({ wakeAt: new Date(Date.now() - 1000) }).where(eq(m.schema.tasks.id, taskId));
  await m.background.wakeScheduledTasks();
}

describe("a business asks Telo to call back in 3 days", () => {
  it("schedules the call itself, tells the user when, then calls back and finishes", async () => {
    await say("Find out if Delta Airlines processed my refund for the cancelled flight");
    const task = await latest();
    const scheduled = await status(task.id, "scheduled");
    const days = (scheduled.wakeAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(2);
    expect(days).toBeLessThan(4.2);
    expect(scheduled.followUp?.callback?.targetName).toBe("Delta Airlines");
    expect(await lastMessage(task.id)).toMatch(/call/i);

    await fastForward(task.id);
    const done = await status(task.id, "completed");
    expect(done.result?.confirmation).toBe("RF5521");
    expect(await businessCalls(task.id)).toHaveLength(2);
  });
});

describe("nobody picks up", () => {
  it("waits before retrying instead of redialing at once, then gets through", async () => {
    await say("Book Sunset Plumbing to fix my leaking sink Tuesday morning");
    const task = await latest();
    const scheduled = await status(task.id, "scheduled");
    expect(scheduled.wakeAt!.getTime()).toBeGreaterThan(Date.now() + 5 * 60_000);
    expect(await lastMessage(task.id)).toMatch(/didn't pick up.*try again/i);
    const queued = (await businessCalls(task.id)).filter((c) => c.status === "planned");
    expect(queued.map((c) => c.attempt)).toEqual([2]);

    await fastForward(task.id);
    const done = await status(task.id, "completed");
    expect(done.result?.confirmation).toBe("SP4410");
  });
});

describe("the business needs a detail Telo doesn't have", () => {
  it("asks the user for it, then calls back with it", async () => {
    await say("Ask Northwind Telecom to remove the late fee on my bill");
    const task = await latest();
    await status(task.id, "needs_info");
    const q = await m.repo.openQuestion(task.id);
    expect(q?.fields.map((f) => f.key)).toEqual(["account_number"]);

    await say("it's 88213");
    const done = await status(task.id, "completed");
    expect(done.result?.confirmation).toBe("NW7781");
    const calls = await businessCalls(task.id);
    expect(calls).toHaveLength(2);
    expect(calls[1].instructions).toContain("88213");
  });
});

describe("the user answers before the business is open", () => {
  it("holds the callback until the time the business gave, says so, then calls", async () => {
    await say("Ask Cedar Bank to refund the overdraft fee");
    const task = await latest();
    await status(task.id, "needs_info");
    await say("88213");
    const waiting = await status(task.id, "scheduled");
    expect(waiting.wakeAt!.getTime()).toBeGreaterThan(Date.now() + 60 * 60_000);
    expect(await lastMessage(task.id)).toMatch(/I'll call Cedar Bank back tomorrow at 10:00 AM with that/);
    await fastForward(task.id);
    const done = await status(task.id, "completed");
    expect(done.result?.confirmation).toBe("CB4120");
    expect((await businessCalls(task.id)).at(-1)?.instructions).toContain("88213");
  });
});

describe("Telo's own calling account is out of credit", () => {
  it("says what to fix instead of blaming the business, and doesn't schedule a retry", async () => {
    const { setVoiceForTests } = await import("../src/server/voice");
    setVoiceForTests({
      name: "dial",
      placeCall: async () => {
        throw new Error('Dial API error 402: {"error":"Insufficient Dial credit. Add credit or start a subscription to continue."}');
      },
      getCall: async () => {
        throw new Error("not used");
      },
      stopCall: async () => {},
      sendMessage: async () => ({ providerMessageId: null }),
      setInboundInstruction: async () => {},
    });
    try {
      await say("Ask Lumen Energy why my bill went up");
      const task = await latest();
      const failed = await status(task.id, "failed");
      expect(failed.wakeAt).toBeNull();
      expect((await businessCalls(task.id)).map((c) => c.endReason)).toEqual(["account_error"]);
      expect(await lastMessage(task.id)).toMatch(/out of credit/);
    } finally {
      setVoiceForTests(undefined);
    }
  });
});

describe("only the account holder can do it", () => {
  it("stops after one call and tells the user what to do", async () => {
    await say("Ask Pacific Gas why my bill doubled");
    const task = await latest();
    await status(task.id, "failed");
    expect(await businessCalls(task.id)).toHaveLength(1);
    expect(await lastMessage(task.id)).toMatch(/account holder/i);
  });
});

describe("a wrong number", () => {
  it("drops the bad number, asks for the right one, and dials that", async () => {
    await say("Order a large pepperoni for pickup at 6:30pm from Golden Crust Pizza");
    const task = await latest();
    const waiting = await status(task.id, "needs_info");
    expect((await m.repo.openQuestion(task.id))?.fields.map((f) => f.key)).toEqual(["phone_golden-crust-pizza"]);
    expect(waiting.targets[0].phone).toBeNull();
    const org = await m.db.db.query.organizations.findFirst({ where: eq(m.schema.organizations.key, "golden-crust-pizza") });
    expect(org?.phone).toBeNull(); // nothing else dials it either

    await say("Try 415-555-0177");
    const done = await status(task.id, "completed");
    expect(done.result?.confirmation).toBe("GC3301");
    const calls = await businessCalls(task.id);
    expect(calls.map((c) => c.targetPhone)).toEqual(["+14155550105", "+14155550177"]);
  });
});

describe("the business says they'll call back", () => {
  it("schedules a check-in, and when they call Telo's line first, reads their message and finishes", async () => {
    await say("Ask Bayview Clinic to refill my allergy prescription");
    const task = await latest();
    await status(task.id, "scheduled");

    const line = m.voice.getVoice() as unknown as { simulateInboundCall(from: string, lines: string[], agent?: string[]): Promise<string> };
    await line.simulateInboundCall(
      "+14155550106",
      ["Hi, this is Rosa from Bayview Clinic returning your call for Dylan. The refill was approved and sent to the pharmacy. Reference number BC2290."],
      ["Hi, you've reached Telo, Dylan's assistant."],
    );
    const done = await status(task.id, "completed");
    expect(done.result?.confirmation).toBe("BC2290");
    const calls = await businessCalls(task.id);
    expect(calls.map((c) => c.direction)).toEqual(["outbound", "inbound"]); // no check-in call needed
  });
});

describe("a call center calls back from another number", () => {
  it("is matched to the task by the business it names, and finishes it", async () => {
    await say("Ask Mesa Pharmacy when my prescription will be ready");
    const task = await latest();
    await status(task.id, "scheduled");
    const line = m.voice.getVoice() as unknown as { simulateInboundCall(from: string, lines: string[], agent?: string[]): Promise<string> };
    await line.simulateInboundCall("+14155559876", ["Hi, this is Jo from Mesa Pharmacy. The prescription for Dylan is ready for pickup, reference number MP7710."], ["Hi, you've reached Telo, Dylan's assistant."]);
    const done = await status(task.id, "completed");
    expect(done.result?.confirmation).toBe("MP7710");
    const inbound = (await businessCalls(task.id)).find((c) => c.direction === "inbound");
    expect(inbound?.orgKey).toBe("mesa-pharmacy");
  });

  it("passes on a message from a caller Telo can't place", async () => {
    const line = m.voice.getVoice() as unknown as { simulateInboundCall(from: string, lines: string[], agent?: string[]): Promise<string> };
    await line.simulateInboundCall("+14155558765", ["Hi, this is Sam from Westside Auto. Your car is ready whenever you want to pick it up."], ["Hi, you've reached Telo, Dylan's assistant."]);
    const msgs = await m.repo.recentMessages("usr_default", 3);
    expect(msgs.at(-1)?.body).toMatch(/\+14155558765 called my line: "Hi, this is Sam from Westside Auto/);
  });
});

describe("the user wants the call later", () => {
  it("waits until the time they asked for, and calls right away if they say so", async () => {
    await say("Call Lakeside Orthodontics tomorrow at 9am to move my cleaning to Friday");
    const task = await latest();
    const scheduled = await status(task.id, "scheduled");
    const local = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23" }).format(scheduled.wakeAt!);
    expect(Number(local)).toBe(9);
    expect(await lastMessage(task.id)).toMatch(/tomorrow at 9:00/i);
    expect(await businessCalls(task.id)).toHaveLength(1); // planned, not placed

    await say("actually call them now");
    const done = await status(task.id, "completed");
    expect(done.result?.confirmation).toBe("LO5512");
  });
});

describe("a business that keeps putting it off", () => {
  it("gives up after the per-task call limit instead of calling forever", async () => {
    await say("Ask Evergreen Bank to waive my overdraft fee");
    const task = await latest();
    for (let i = 0; i < 2; i++) {
      await status(task.id, "scheduled");
      await fastForward(task.id);
      await waitFor(async () => (await m.repo.getTask(task.id))?.status !== "scheduled" && (await m.repo.getTask(task.id)), "the wake");
    }
    await status(task.id, "failed");
    expect((await businessCalls(task.id)).filter((c) => c.status !== "planned")).toHaveLength(3);
    expect(await lastMessage(task.id)).toMatch(/3 calls/);
  });
});

describe("a business wants a PIN", () => {
  it("never asks the user for it, and says they need to handle that part", async () => {
    const { MockLLM } = await import("../src/server/agent/mock-llm");
    const base = new MockLLM();
    const insistent: LLM = {
      name: "mock",
      async structured(req) {
        if (req.name === "decide-next" && req.prompt.includes("Harbor Credit Union")) {
          return req.schema.parse({
            action: "ask_info",
            userMessage: "Harbor needs your account PIN. What is it?",
            question: null,
            callback: null,
            scheduleAt: null,
            infoFields: [{ key: "account_pin", label: "Account PIN", question: "What's your account PIN?", sensitive: true }],
            result: null,
            learnedFacts: [],
          });
        }
        return base.structured(req);
      },
    };
    m.llm.setLLMForTests(insistent);
    try {
      await say("Ask Harbor Credit Union to raise my card limit");
      const task = await latest();
      await status(task.id, "failed");
      expect(await m.repo.openQuestion(task.id)).toBeUndefined();
      const sent = (await m.db.db.select().from(m.schema.messages).where(eq(m.schema.messages.taskId, task.id))).filter((x) => x.direction === "out");
      expect(sent.some((x) => /what is it\?|what's your account pin/i.test(x.body))).toBe(false);
      expect(sent.at(-1)?.body).toMatch(/never ask for or share/i);
    } finally {
      m.llm.setLLMForTests(undefined);
    }
  });
});
