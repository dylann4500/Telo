import { z } from "zod";
import { config } from "@/server/config";
import { ensureDb } from "@/server/db/client";
import { resetAll, seedBaseline, seedDemoHistory } from "@/server/db/seed";
import { syncPendingEvents } from "@/server/memory/events";
import { getVoice } from "@/server/voice";
import { MockVoice } from "@/server/voice/mock";

// Demo and development helpers. Disabled with TELO_DEV_TOOLS=false.

const SimCall = z.object({ lines: z.array(z.string().min(1)).min(1).max(12) });

export async function POST(req: Request, ctx: RouteContext<"/api/dev/[action]">) {
  if (!config.demo.devTools) return new Response("not found", { status: 404 });
  await ensureDb();
  const { action } = await ctx.params;
  switch (action) {
    case "seed": {
      const r = await seedDemoHistory();
      await syncPendingEvents(100);
      return Response.json({ ok: true, ...r });
    }
    case "reset": {
      await resetAll();
      await seedBaseline();
      return Response.json({ ok: true, note: config.memory.provider === "keewano" ? "Local data cleared. Keewano has no delete API, so its history stays." : "Local data cleared." });
    }
    case "simulate-call": {
      const voice = getVoice();
      if (!(voice instanceof MockVoice)) return Response.json({ error: "Only with the simulated phone line" }, { status: 400 });
      const parsed = SimCall.safeParse(await req.json().catch(() => ({})));
      if (!parsed.success) return Response.json({ error: "lines[] required" }, { status: 400 });
      const from = config.user.phone ?? "+15555550100";
      const greeting = `Hey ${config.user.name.split(" ")[0]}, it's Telo. What can I do?`;
      const id = await voice.simulateInboundCall(from, parsed.data.lines, [greeting]);
      return Response.json({ ok: true, providerCallId: id });
    }
    default:
      return new Response("unknown action", { status: 404 });
  }
}
