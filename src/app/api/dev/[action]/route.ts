import { z } from "zod";
import { config } from "@/server/config";
import { ensureDb } from "@/server/db/client";
import { resetAll, seedBaseline } from "@/server/db/seed";
import { seedPortfolioHistory } from "@/server/portfolio/history";
import { syncPendingEvents } from "@/server/memory/events";
import { getVoice } from "@/server/voice";
import { MockVoice } from "@/server/voice/mock";
import { pollInbox } from "@/server/inbox";
import { getMail } from "@/server/mail";
import { MockMail } from "@/server/mail/mock";
import { after } from "next/server";
import { handleInboundText } from "@/server/concierge";
import { getOwner, getTenancy, getVendor } from "@/server/portfolio";

// Sample mail for the simulated inbox: one Telo just files away, one it offers to call about.
const EMAILS = {
  receipt: {
    from: "refunds@skyway-air.example",
    fromName: "Skyway Airlines",
    subject: "Your refund of $212.00 has been processed",
    text: "Hi Dylan,\n\nYour refund for booking QX7P2L (SFO to JFK, Oct 3) has been processed to your original card. Amount: $212.00. Refund reference RF5521. It can take 5 to 10 business days to appear.\n\nSkyway Airlines",
  },
  problem: {
    from: "billing@comcast.example",
    fromName: "Comcast",
    subject: "Your bill has gone up",
    text: "Hi Dylan,\n\nYour monthly bill is increasing from $80.00 to $95.00 starting Nov 1 because of a new equipment fee. If this looks wrong, please call us at 1-800-934-6489.\n\nComcast Xfinity",
  },
} as const;

// Demo and development helpers. Disabled with TELO_DEV_TOOLS=false.

const SimCall = z.object({ lines: z.array(z.string().min(1)).min(1).max(12), from: z.string().optional() });
// A text from someone in the portfolio (tenant, owner, vendor), by party id: the demo's other phones.
const SimText = z.object({ from: z.string().min(3), text: z.string().max(1000).default(""), photos: z.number().int().min(0).max(4).default(0) });

export async function POST(req: Request, ctx: RouteContext<"/api/dev/[action]">) {
  if (!config.demo.devTools) return new Response("not found", { status: 404 });
  await ensureDb();
  const { action } = await ctx.params;
  switch (action) {
    case "seed": {
      // The portfolio's history before Telo: what Keewano knows on day one.
      const r = await seedPortfolioHistory();
      await syncPendingEvents(200);
      return Response.json({ ok: true, ...r });
    }
    case "call-party-again": {
      // The last call to a tenant or owner, placed again (it went to voicemail, or they missed it).
      const { db } = await import("@/server/db/client");
      const { calls } = await import("@/server/db/schema");
      const { desc, eq } = await import("drizzle-orm");
      const { retryPartyCall } = await import("@/server/maintenance");
      const [last] = await db.select().from(calls).where(eq(calls.kind, "party_update")).orderBy(desc(calls.createdAt)).limit(1);
      if (!last) return Response.json({ error: "No call to a tenant or owner yet" }, { status: 404 });
      const callId = await retryPartyCall(last.id);
      return Response.json({ ok: Boolean(callId), callId, to: last.targetName, note: callId ? undefined : "They've answered since, so no new call" });
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
      // From the manager by default, or from a tenant in the portfolio (a repair report by phone).
      const tenant = parsed.data.from ? getTenancy(parsed.data.from) : undefined;
      const from = tenant?.phone ?? config.user.phone ?? "+15555550100";
      const greeting = tenant ? "This is Telo, the AI assistant for Bayside Property Management. This call is recorded. What's going on?" : `Hey ${config.user.name.split(" ")[0]}, it's Telo. What can I do?`;
      const id = await voice.simulateInboundCall(from, parsed.data.lines, [greeting]);
      return Response.json({ ok: true, providerCallId: id });
    }
    case "simulate-text": {
      if (getVoice().name !== "mock") return Response.json({ error: "Only with the simulated phone line" }, { status: 400 });
      const parsed = SimText.safeParse(await req.json().catch(() => ({})));
      if (!parsed.success) return Response.json({ error: "from (a party id) and text required" }, { status: 400 });
      const party = parsed.data.from.startsWith("ten_") ? getTenancy(parsed.data.from) : (getOwner(parsed.data.from) ?? getVendor(parsed.data.from));
      if (!party) return Response.json({ error: `No party ${parsed.data.from}` }, { status: 404 });
      const media = Array.from({ length: parsed.data.photos }, (_, i) => `https://demo.telo.local/photos/${parsed.data.from}-${Date.now()}-${i + 1}.jpg`);
      after(() =>
        handleInboundText({ from: party.phone, body: parsed.data.text, channel: "sms", providerMessageId: `sim_${Date.now().toString(36)}`, media }).catch((err) => console.error("[dev] simulated text failed", err)),
      );
      return Response.json({ ok: true });
    }
    case "check-email": {
      if (!getMail()) return Response.json({ error: "Email isn't connected (npm run google:connect)" }, { status: 400 });
      const n = await pollInbox();
      return Response.json({ ok: true, note: n ? `Read ${n} new email${n === 1 ? "" : "s"}.` : "No new email." });
    }
    case "simulate-email": {
      const mail = getMail();
      if (!(mail instanceof MockMail)) return Response.json({ error: "Only with the simulated inbox (MAIL_PROVIDER=mock)" }, { status: 400 });
      const { preset } = (await req.json().catch(() => ({}))) as { preset?: keyof typeof EMAILS };
      const sample = EMAILS[preset ?? "receipt"] ?? EMAILS.receipt;
      mail.deliver(sample);
      const n = await pollInbox();
      return Response.json({ ok: true, note: `Delivered "${sample.subject}"; read ${n} new email${n === 1 ? "" : "s"}.` });
    }
    default:
      return new Response("unknown action", { status: 404 });
  }
}
