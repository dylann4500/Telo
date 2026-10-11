import { config } from "@/server/config";
import { ensureDb } from "@/server/db/client";
import { callTool, TOOLS } from "@/server/live-call";

// Telo's MCP server, registered with Dial as a "Context MCP". Dial's voice
// agent can call these tools during any call on the account, so every tool
// authorizes itself from Dial's per-call headers (src/server/live-call.ts):
//   X-Dial-Direction: inbound | outbound
//   X-Dial-User-Number: the other party (the caller, or who Telo called)
// The line's owner gets status and requests; a business Telo called gets
// progress, ask_customer / wait_for_customer and check_calendar. Dial reads the
// tool list once, when the Context MCP is registered: rerun dial:setup after
// adding a tool. Streamable HTTP transport, stateless, JSON responses only.

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(m: Rpc, headers: Headers) {
  if (m.id === undefined || m.id === null) return null; // a notification: nothing to return
  switch (m.method) {
    case "initialize":
      return ok(m.id, {
        protocolVersion: typeof m.params?.protocolVersion === "string" ? m.params.protocolVersion : "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "telo", version: "0.2.0" },
        instructions:
          "Telo's tools. get_status and ask_telo are for calls with the line's owner. On a call to a business: report_progress, ask_customer then wait_for_customer when the business needs something only the customer has (they text the customer, not the person on the phone), and check_calendar before accepting a time. Say a short line before a tool that makes them wait.",
      });
    case "ping":
      return ok(m.id, {});
    case "tools/list":
      return ok(m.id, { tools: TOOLS });
    case "tools/call": {
      const name = String(m.params?.name ?? "");
      const args = (m.params?.arguments as Record<string, unknown>) ?? {};
      try {
        const r = await callTool(name, args, { direction: headers.get("x-dial-direction"), other: headers.get("x-dial-user-number") });
        return ok(m.id, { content: [{ type: "text", text: r.text }], ...(r.isError ? { isError: true } : {}) });
      } catch (err) {
        console.error("[mcp] tool failed", name, err);
        return ok(m.id, { content: [{ type: "text", text: "Telo couldn't do that right now. Carry on, and say you'll follow up if it mattered." }], isError: true });
      }
    }
    default:
      return fail(m.id, -32601, `Method not found: ${m.method}`);
  }
}

export async function POST(req: Request) {
  if (config.voice.mcpToken && req.headers.get("authorization") !== `Bearer ${config.voice.mcpToken}`) {
    return new Response("unauthorized", { status: 401 });
  }
  await ensureDb();
  let body: Rpc | Rpc[];
  try {
    body = await req.json();
  } catch {
    return Response.json(fail(null, -32700, "Parse error"), { status: 400 });
  }
  const batch = Array.isArray(body) ? body : [body];
  const results = (await Promise.all(batch.map((m) => handle(m, req.headers)))).filter(Boolean);
  if (!results.length) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? results : results[0]);
}

export async function GET() {
  // No server-initiated stream: this server only answers requests.
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
