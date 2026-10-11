import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { DialClient, type PhoneNumber } from "@getdial/sdk";
import { mask, setEnv } from "./env-file";

// npm run dial:setup: everything Dial needs, done through the API.
//   1. pick Telo's number and save DIAL_NUMBER_ID / TELO_PHONE_NUMBER
//   2. set the number's inbound prompt (the app keeps it current afterwards)
//   3. point the account webhook at PUBLIC_BASE_URL and save its secret
//   4. register Telo's MCP endpoint so Dial's agent can use Telo's tools mid-call
//   5. report account limits and anything that will block texting
// Safe to re-run (a new tunnel URL replaces the old webhook and MCP).

const API = "https://api.getdial.ai/api/v1";
const key = process.env.DIAL_API_KEY;
if (!key) {
  console.error("Put DIAL_API_KEY in .env.local first (Dial dashboard > API keys).");
  process.exit(1);
}
const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const dial = new DialClient({ apiKey: key, userAgent: "telo-setup/0.1" });

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

async function main() {
  // 1. Number
  const numbers = await dial.listNumbers();
  if (!numbers.length) throw new Error("This Dial account has no numbers yet. Create one in the dashboard first.");
  const wantImessage = process.env.TELO_USER_CHANNEL === "imessage";
  const pick =
    numbers.find((n) => n.id === process.env.DIAL_NUMBER_ID) ??
    (wantImessage ? numbers.find((n) => n.capabilities.includes("imessage")) : undefined) ??
    numbers.find((n) => n.setupStatus === "ready" && n.capabilities.includes("call")) ??
    numbers[0];
  setEnv({ DIAL_NUMBER_ID: pick.id, TELO_PHONE_NUMBER: pick.number });
  console.log(`● Number      ${pick.number} (${pick.capabilities.join(", ")}; ${pick.setupStatus}${pick.callingEnabled === false ? ", calling disabled" : ""})`);
  if (numbers.length > 1) console.log(`              other numbers: ${numbers.filter((n) => n.id !== pick.id).map((n: PhoneNumber) => n.number).join(", ")}`);

  // 2. Inbound prompt (needs TELO_USER_NAME from env, loaded above)
  const { inboundPrompt } = await import("../src/server/voice/inbound-prompt");
  await dial.setNumberProperties(pick.id, {
    inboundInstruction: inboundPrompt(""),
    inboundLanguage: "en-US",
    inboundVoiceGender: "female",
    nickname: "Telo",
  });
  console.log("● Voice line  inbound prompt set (the running app refreshes it with live status)");

  // 3 + 4 need a public URL.
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (!base || !base.startsWith("https://")) {
    console.log("○ Webhook     skipped: set PUBLIC_BASE_URL (run `npm run tunnel`), then run this again");
  } else {
    const target = `${base}/api/webhooks/dial`;
    const list = await api<{ webhooks: { id: string; targetUrl: string }[] }>("GET", "/webhooks");
    let hook = list.webhooks.find((w) => w.targetUrl === target);
    for (const w of list.webhooks.filter((w) => w.targetUrl !== target && w.targetUrl.endsWith("/api/webhooks/dial"))) {
      await api("DELETE", `/webhooks/${w.id}`);
      console.log(`              removed old webhook ${w.targetUrl}`);
    }
    if (!hook) {
      const created = await api<{ webhook?: { id: string }; id?: string }>("POST", "/webhooks", { targetUrl: target, eventTypes: ["*"] });
      hook = { id: created.webhook?.id ?? created.id!, targetUrl: target };
    }
    const { secret } = await api<{ secret: string }>("GET", `/webhooks/${hook.id}/secret`);
    setEnv({ DIAL_WEBHOOK_SECRET: secret });
    console.log(`● Webhook     ${target} (secret saved: ${mask(secret)})`);

    const token = process.env.TELO_MCP_TOKEN;
    if (!token) {
      console.log("○ Mid-call    skipped: run `npm run setup` to generate TELO_MCP_TOKEN, restart the app, then run this again");
    } else {
      const mcpUrl = `${base}/api/mcp`;
      const existing = await api<{ contextMcps?: { id: string; name: string; url: string }[] } | { id: string; name: string; url: string }[]>("GET", "/context-mcps").catch(() => []);
      const rows = Array.isArray(existing) ? existing : (existing.contextMcps ?? []);
      for (const m of rows.filter((m) => m.name === "Telo" || m.url.endsWith("/api/mcp"))) {
        await api("DELETE", `/context-mcps/${m.id}`).catch(() => {});
      }
      try {
        const res = await api<{ contextMcp?: { status?: string; toolCount?: number; authMode?: string } }>("POST", "/context-mcps", {
          name: "Telo",
          url: mcpUrl,
          headers: { Authorization: `Bearer ${token}` },
          timeoutMs: 60_000,
        });
        console.log(`● Mid-call    tools at ${mcpUrl} (${res.contextMcp?.status ?? "registered"}, ${res.contextMcp?.toolCount ?? "?"} tools)`);
      } catch (err) {
        console.log(`○ Mid-call    Dial couldn't reach ${mcpUrl}. Is the app running with this TELO_MCP_TOKEN? (${(err as Error).message.slice(0, 160)})`);
      }
    }
    await api("POST", `/webhooks/${hook.id}/ping`).catch(() => {});
  }

  // 5. Limits and texting
  const account = await api<{ limits?: { maxCallDurationSeconds: number; maxConcurrentCalls: number } | null }>("GET", "/account").catch(() => null);
  if (account?.limits) {
    console.log(`○ Account     free-tier limits: ${account.limits.maxCallDurationSeconds / 60} min per call, ${account.limits.maxConcurrentCalls} calls at once. Any top-up lifts them.`);
  } else if (account) {
    console.log("● Account     no free-tier call limits");
  }
  const detail = await api<{ tenDlc?: { status?: string } | null; capabilities?: string[] }>("GET", `/numbers/${pick.id}`).catch(() => null);
  if (!pick.capabilities.includes("imessage")) {
    const status = detail?.tenDlc?.status ?? "unknown";
    console.log(
      status === "approved"
        ? "● Texting     10DLC approved: SMS replies reach US phones"
        : `○ Texting     10DLC ${status}: US carriers block SMS replies from this number until it's approved. Texts TO Telo still work. Options: an iMessage number, a pre-approved number from Dial, or keep updates on Text + call (dashboard) so Telo phones you.`,
    );
  } else {
    console.log("● Texting     iMessage number: replies don't need 10DLC (have the user text first)");
  }
  if (!process.env.TELO_USER_PHONE) console.log("○ You         set TELO_USER_PHONE so texts from your phone are recognized");
  console.log("\nRestart the app so it picks up the new values.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
