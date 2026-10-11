import type { FlowStepDTO } from "@/lib/types";
import type { CallRow, EventRow, MessageRow, TaskRow } from "./db/schema";
import { formatWhen } from "./time";

// "How Telo handled it": a task's events, calls and messages folded into a
// short list of steps for the dashboard (one line each, the full text one
// click away), instead of a wall of event summaries. Each step says which
// systems did the work (Claude, Keewano, Dial, Gmail, Calendar), what the
// user was told and how, and whether its facts went to Keewano.

type Step = FlowStepDTO;
type Tone = Step["tone"];

const OUTCOME: Record<string, { label: string; tone: Tone }> = {
  success: { label: "Got it done", tone: "done" },
  partial: { label: "Partly done", tone: "work" },
  needs_user_decision: { label: "Needs your decision", tone: "wait" },
  callback_required: { label: "Call back later", tone: "work" },
  failed: { label: "Didn't work", tone: "bad" },
  no_answer: { label: "No answer", tone: "muted" },
  voicemail: { label: "Voicemail", tone: "muted" },
  wrong_number: { label: "Wrong number", tone: "bad" },
};

const CATEGORY: Record<string, string> = {
  reservation: "Booking",
  membership: "Membership",
  support: "Billing or support",
  quotes: "Quotes",
  inquiry: "Question",
  other: "Other",
};

function clip(text: string | null | undefined, n = 120): { detail: string | null; more: string | null } {
  const t = text?.trim();
  if (!t) return { detail: null, more: null };
  if (t.length <= n) return { detail: t, more: null };
  return { detail: `${t.slice(0, n).replace(/\s+\S*$/, "")}…`, more: t };
}

/** "Asked you for: Account number" → "Account number". */
const after = (summary: string) => summary.replace(/^[^:]{0,60}:\s*/, "");
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

function step(kind: Step["kind"], id: string, at: Date, fields: Partial<Step> & { title: string }): Step {
  return { id, kind, at: at.toISOString(), detail: null, more: null, tone: "work", systems: [], badges: [], children: [], told: [], memory: null, decided: false, ...fields };
}

export function buildFlow(task: TaskRow, calls: CallRow[], events: EventRow[], messages: MessageRow[], tz: string, memory: "keewano" | "local"): Step[] {
  const steps: Step[] = [];
  const how = task.source === "voice" ? "on a call" : task.source === "web" ? "in the dashboard" : task.source === "email" ? null : "by text";
  steps.push(
    step("request", `req_${task.id}`, task.createdAt, {
      title: how ? `You asked ${how}` : "Spotted in your email",
      ...clip(task.request, 140),
      tone: "muted",
      systems: how ? ["you"] : ["gmail", "claude"],
    }),
  );

  // One step per business call, built from the call row, with what happened during it inside.
  const business = calls.filter((c) => c.kind === "business" && c.status !== "planned");
  const callStep = new Map<string, Step>();
  for (const c of business) {
    const a = c.analysis;
    const live = ["queued", "ringing", "in_progress"].includes(c.status);
    const outcome = a ? OUTCOME[a.outcome] : undefined;
    const inbound = c.direction === "inbound";
    const s = step("call", `call_${c.id}`, c.startedAt ?? c.createdAt, {
      title: inbound ? `${c.targetName} called back` : live ? `On the phone with ${c.targetName}` : `Called ${c.targetName}`,
      ...clip(a?.summary ?? (live ? c.statusDetail : c.endReason === "account_error" ? `Couldn't place the call: ${c.statusDetail ?? "Dial refused it"}` : c.statusDetail), 150),
      tone: live ? "live" : outcome?.tone ?? (c.status === "failed" ? "bad" : "muted"),
      systems: a ? ["dial", "claude"] : ["dial"],
      badges: [
        ...(c.attempt > 1 ? [`try ${c.attempt}`] : []),
        ...(outcome ? [outcome.label] : live ? ["Live"] : []),
        ...(c.durationSec ? [clock(c.durationSec)] : []),
        ...(a?.confirmationNumbers ?? []),
      ],
    });
    callStep.set(c.id, s);
    steps.push(s);
  }
  // The call that was on at a moment (for answers given mid-call, which carry no call id).
  const callAt = (at: Date) =>
    business.find((c) => (c.answeredAt ?? c.startedAt ?? c.createdAt) <= at && (!c.endedAt || c.endedAt.getTime() + 5000 >= at.getTime()));

  const child = (s: Step, e: EventRow, title: string, detail: string | null, tone: Tone) => s.children.push({ title, detail, at: e.occurredAt.toISOString(), tone });
  const eventSteps = new Map<string, Step>(); // event id → the step it landed in (for Keewano dots)

  for (const e of events) {
    const inCall = e.callId ? callStep.get(e.callId) : undefined;
    if (inCall) {
      eventSteps.set(e.id, inCall);
      switch (e.type) {
        case "call.asked_user":
          child(inCall, e, "Asked you while they waited", after(e.summary), "wait");
          break;
        case "calendar.checked": {
          const free = (e.data as { free?: boolean }).free;
          child(inCall, e, free ? "Checked your calendar: free" : "Checked your calendar: busy", e.summary.replace(/^Checked your calendar for /, "").replace(/: (free|busy)$/, ""), free ? "done" : "wait");
          if (!inCall.systems.includes("calendar")) inCall.systems.push("calendar");
          break;
        }
        case "business.fact_discovered":
          child(inCall, e, "Learned", e.summary, "work");
          break;
        case "offer.received":
          child(inCall, e, "Offer", after(e.summary), "wait");
          break;
        case "commitment.received":
          child(inCall, e, "They promised", after(e.summary), "work");
          break;
        case "commitment.fulfilled":
          child(inCall, e, "An earlier promise was kept", after(e.summary), "done");
          break;
        case "commitment.broken":
          child(inCall, e, "An earlier promise was broken", after(e.summary), "bad");
          break;
        case "confirmation.received":
          break; // a badge already
        default:
          break; // started, connected, completed, transcript read: the step itself
      }
      continue;
    }
    switch (e.type) {
      case "task.created":
        eventSteps.set(
          e.id,
          pushStep(steps, step("understand", e.id, e.occurredAt, {
            title: "Understood the request",
            ...clip(task.goal ?? e.summary.replace(/^New task:\s*/, ""), 140),
            systems: ["claude"],
            badges: task.category ? [CATEGORY[task.category] ?? task.category] : [],
          })),
        );
        break;
      case "task.info_requested":
        eventSteps.set(e.id, pushStep(steps, step("ask", e.id, e.occurredAt, { title: /asked for:/.test(e.summary) ? `${e.summary.split(" asked for:")[0]} needs details` : "Asked you", ...clip(after(e.summary)), tone: "wait", systems: ["claude", "you"], decided: true })));
        break;
      case "task.info_received": {
        const call = (e.data as { live?: boolean }).live ? callAt(e.occurredAt) : undefined;
        if (call && callStep.get(call.id)) {
          child(callStep.get(call.id)!, e, "You answered", after(e.summary), "done");
          eventSteps.set(e.id, callStep.get(call.id)!);
        } else eventSteps.set(e.id, pushStep(steps, step("answer", e.id, e.occurredAt, { title: "You answered", ...clip(after(e.summary)), tone: "done", systems: ["you"] })));
        break;
      }
      case "memory.retrieved": {
        const data = e.data as { source?: string; trace?: { via: string; rows: number; ms: number }[] };
        const none = /^No earlier history/.test(e.summary);
        const sql = (data.trace ?? []).find((t) => t.via === "keewano-sql");
        const recent = (data.trace ?? []).filter((t) => t.via === "local").reduce((n, t) => n + t.rows, 0);
        eventSteps.set(
          e.id,
          pushStep(steps, step("memory", e.id, e.occurredAt, {
            title: none ? "Checked past calls" : "Remembered past calls",
            ...clip(none ? `Nothing on file yet${task.targets.length ? ` with ${task.targets.map((t) => t.name).join(", ")}` : ""}. This call starts the record.` : e.summary.replace(/^Remembered:\s*/, ""), 160),
            tone: none ? "muted" : "work",
            systems: data.source === "keewano" || sql ? (none ? ["keewano"] : ["keewano", "claude"]) : none ? [] : ["claude"],
            badges: [
              ...(sql ? [`Keewano SQL · ${sql.rows} rows · ${sql.ms} ms`] : data.source === "local" ? ["Local memory"] : []),
              ...(sql && recent && !none ? [`+${recent} too recent for Keewano`] : []),
            ],
          })),
        );
        break;
      }
      case "task.plan_generated": {
        const legs = Number((e.data as { legs?: number }).legs ?? 1);
        eventSteps.set(e.id, pushStep(steps, step("plan", e.id, e.occurredAt, { title: legs > 1 ? `Planned ${legs} calls` : "Planned the call", ...clip(e.summary.replace(/^Plan:\s*/, ""), 150), systems: ["claude"] })));
        break;
      }
      case "followup.required": {
        const data = e.data as { wakeAt?: string; reason?: string };
        const title = data.reason === "retry" ? "Will try again" : data.wakeAt ? "Calling back later" : "Calling back now";
        const when = data.wakeAt ? new Date(data.wakeAt) : null;
        eventSteps.set(
          e.id,
          pushStep(steps, step("schedule", e.id, e.occurredAt, {
            title,
            ...clip(e.summary, 150),
            systems: ["claude"],
            badges: when ? [formatWhen(when, tz, { absolute: true })] : [],
            decided: true,
          })),
        );
        break;
      }
      case "approval.requested": {
        const offer = /email/.test(e.summary) && task.source === "email";
        eventSteps.set(e.id, pushStep(steps, step("ask", e.id, e.occurredAt, { title: offer ? "Offered to call" : "Asked you to decide", ...clip(after(e.summary)), tone: "wait", systems: ["claude", "you"], decided: !offer })));
        break;
      }
      case "approval.granted":
      case "approval.denied": {
        const call = /during the call/.test(e.summary) ? callAt(e.occurredAt) : undefined;
        if (call && callStep.get(call.id)) {
          child(callStep.get(call.id)!, e, "You decided", after(e.summary), "done");
          eventSteps.set(e.id, callStep.get(call.id)!);
        } else eventSteps.set(e.id, pushStep(steps, step("answer", e.id, e.occurredAt, { title: "You decided", ...clip(after(e.summary)), tone: e.type === "approval.granted" ? "done" : "muted", systems: ["you"] })));
        break;
      }
      case "email.received": {
        const [who, ...rest] = e.summary.split(" emailed: ");
        eventSteps.set(e.id, pushStep(steps, step("email", e.id, e.occurredAt, { title: `Email from ${who}`, ...clip(rest.join(" emailed: ") || e.summary, 150), systems: ["gmail", "claude"], badges: (e.typed?.confirmationNumber ? [e.typed.confirmationNumber] : []) })));
        break;
      }
      case "calendar.event_created":
        eventSteps.set(e.id, pushStep(steps, step("calendar", e.id, e.occurredAt, { title: "Added to your calendar", ...clip(after(e.summary)), tone: "done", systems: ["calendar"] })));
        break;
      case "task.completed":
        eventSteps.set(
          e.id,
          pushStep(steps, step("done", e.id, e.occurredAt, {
            title: "Done",
            ...clip(task.result?.summary ?? after(e.summary), 200),
            tone: "done",
            systems: ["claude"],
            badges: task.result?.confirmation ? [task.result.confirmation] : [],
            decided: true,
          })),
        );
        break;
      case "task.failed":
      case "task.cancelled":
        eventSteps.set(
          e.id,
          pushStep(steps, step("stopped", e.id, e.occurredAt, { title: e.type === "task.cancelled" ? "Cancelled" : "Stopped", ...clip(task.result?.summary ?? after(e.summary), 200), tone: e.type === "task.cancelled" ? "muted" : "bad", systems: e.type === "task.cancelled" ? ["you"] : ["claude"], decided: e.type === "task.failed" })),
        );
        break;
      default:
        break; // message.sent goes on the step it belongs to, below; preferences and the rest aren't steps
    }
  }

  steps.sort((a, b) => a.at.localeCompare(b.at));
  // "Claude decided": only for what came out of reading a call or an email, not the questions before the first call.
  for (const [i, s] of steps.entries()) {
    if (s.decided) s.decided = steps.slice(0, i).some((x) => x.kind === "call" || x.kind === "email");
  }

  // Keewano: a step's typed facts were mirrored (or are waiting to be).
  for (const e of events) {
    const s = eventSteps.get(e.id);
    if (!s || !e.typed) continue;
    s.memory = { where: memory, synced: Boolean(e.memorySyncedAt) && (s.memory?.synced ?? true) };
  }

  // What the user was told, on the step it followed. A text that was also phoned in shows once, as a call.
  const out = messages.filter((m) => m.direction === "out" && m.taskId === task.id && m.kind !== "email").sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  for (const m of out) {
    const at = m.createdAt.toISOString();
    const owner = [...steps].reverse().find((s) => s.at <= at) ?? steps[0];
    // Said on a call the user was already on (Dial's agent relayed it), or Telo phoned them with it.
    const onTheirCall = m.channel === "voice" && (m.provider === "live-call" || ["ack", "reply", "update", "status"].includes(m.kind));
    const how: Step["told"][number]["how"] = onTheirCall ? "voice" : m.channel === "voice" ? "call" : m.channel === "web" ? "app" : "text";
    const same = owner.told.find((t) => t.body === m.body);
    if (same) {
      if (how === "call" || how === "voice") same.how = how;
      same.delivered ||= m.status !== "failed";
      continue;
    }
    owner.told.push({ how, body: m.body, delivered: m.status !== "failed" });
  }
  return steps;
}

function pushStep(steps: Step[], s: Step): Step {
  steps.push(s);
  return s;
}
