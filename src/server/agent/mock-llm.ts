import type { z } from "zod";
import { formatWhen, localIso, localParts, zonedTime } from "../time";
import type { LLM, StructuredRequest } from "./llm";

// A rule-based stand-in for the model, used when no ANTHROPIC_API_KEY is set
// and in tests. It handles the demo scenarios well enough to exercise every
// path (questions, approvals, multi-call quotes, status replies). It is not
// meant to be smart; real runs use Claude.

type Blocks = Record<string, unknown>;

function parseBlocks(prompt: string): Blocks {
  const out: Blocks = {};
  const re = /<([a-z_]+)>\n([\s\S]*?)\n<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt))) {
    const raw = m[2];
    try {
      out[m[1]] = JSON.parse(raw);
    } catch {
      out[m[1]] = raw;
    }
  }
  return out;
}

const YES = /\b(yes|yeah|yep|ok|okay|sure|accept|book it|do it|go ahead|sounds good|please do)\b/i;
const NO = /\b(no|nope|don't|do not|decline|keep cancel\w*|continue cancel\w*|just cancel\w*)\b/i;
const STATUS = /\b(status|update|how'?s|how is|how are|what'?s happening|any news|progress|did they|what did|what happened|where are we)\b/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const PHONE = /\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
const MONEY = /\$\s?(\d+(?:\.\d{2})?)/g;

interface Dir {
  name: string;
  phone: string | null;
  aliases: string[];
}

function findInDirectory(text: string, directory: Dir[]): Dir[] {
  const t = text.toLowerCase();
  return directory.filter((d) => [d.name, ...d.aliases].some((a) => a && t.includes(a.toLowerCase())));
}

function categorize(text: string): string {
  if (/\b(cancel|membership|subscription|pause)\b/i.test(text)) return "membership";
  if (/\b(quote|quotes|price|prices|estimate|cheapest|shops|under \$)\b/i.test(text)) return "quotes";
  if (/\b(bill|charge|charged|refund|outage|credit|internet|warranty)\b/i.test(text)) return "support";
  if (/\b(reserv|table|book|appointment|dentist|reschedul|seat)\w*/i.test(text)) return "reservation";
  return "inquiry";
}

function moneyValues(text: string): number[] {
  return [...text.matchAll(MONEY)].map((m) => Number(m[1]));
}

/** The "now" block: "2026-10-10T19:05:00-07:00 (Saturday, ..., America/Los_Angeles)". */
function clock(b: Blocks): { now: Date; tz: string } {
  const raw = String(b.now ?? "");
  const iso = raw.match(/^\S+/)?.[0];
  const tz = raw.match(/, ([A-Za-z_]+\/[A-Za-z_]+)\)$/)?.[1] ?? "America/Los_Angeles";
  const now = iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso) : new Date();
  return { now, tz };
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** "in 3 days", "tomorrow", "next week", "on Thursday" (at an optional "9 am") → a local time. */
function laterTime(text: string, b: Blocks): string | null {
  const { now, tz } = clock(b);
  const t = text.toLowerCase();
  let days: number | null = null;
  const inDays = t.match(/\bin (\d+|two|three|four|five) (business )?days?\b/);
  if (inDays) days = Number(inDays[1]) || { two: 2, three: 3, four: 4, five: 5 }[inDays[1]] || null;
  else if (/\btomorrow\b/.test(t)) days = 1;
  else if (/\b(next week|in a week|a week from)\b/.test(t)) days = 7;
  else {
    const day = DAYS.findIndex((d) => new RegExp(`\\b(on |this |next )?${d}\\b`).test(t));
    if (day >= 0) days = ((day - localParts(now, tz).weekday + 7) % 7) || 7;
  }
  if (days === null) return null;
  const at = t.match(/\bat (\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  let hour = 10;
  let minute = 0;
  if (at) {
    hour = (Number(at[1]) % 12) + (at[3] === "pm" ? 12 : 0);
    minute = Number(at[2] ?? 0);
  }
  const p = localParts(new Date(now.getTime() + days * 86_400_000), tz);
  return localIso(zonedTime(p.year, p.month, p.day, hour, minute, tz), tz);
}

/** "tonight between 8 and 9" → today's evening window, in the user's timezone. */
function tonightWindow(text: string, b: Blocks): { startsAt: string; endsAt: string; label: string } | null {
  const m = text.match(/\btonight between (\d{1,2})(?::(\d{2}))? and (\d{1,2})(?::(\d{2}))?/i);
  if (!m) return null;
  const { now, tz } = clock(b);
  const p = localParts(now, tz);
  const h = (x: string) => (Number(x) % 12) + 12;
  const start = zonedTime(p.year, p.month, p.day, h(m[1]), Number(m[2] ?? 0), tz);
  const end = zonedTime(p.year, p.month, p.day, h(m[3]), Number(m[4] ?? 0), tz);
  return { startsAt: localIso(start, tz), endsAt: localIso(end, tz), label: `tonight ${m[1]}-${m[3]} PM` };
}

function confirmationNumbers(text: string): string[] {
  const out = new Set<string>();
  const re = /(?:confirmation|reference|ticket|case)(?:\s+(?:number|no\.?|#))?(?:\s+is)?[\s:#]*([A-Z0-9][A-Z0-9-]{3,})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) if (/\d/.test(m[1])) out.add(m[1].toUpperCase());
  return [...out];
}

export class MockLLM implements LLM {
  readonly name = "mock" as const;

  async structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
    const b = parseBlocks(req.prompt);
    const result = this.dispatch(req.name, b);
    return req.schema.parse(result) as z.infer<S>;
  }

  private dispatch(name: string, b: Blocks): unknown {
    switch (name) {
      case "route-inbound":
        return this.route(b);
      case "understand-task":
        return this.understand(b);
      case "plan-calls":
        return this.plan(b);
      case "analyze-call":
        return this.analyze(b);
      case "decide-next":
        return this.decide(b);
      case "answer-status":
        return this.status(b);
      case "brief-history":
        return this.brief(b);
      case "read-email":
        return this.readEmail(b);
      case "simulate-call":
        return { outcome: "answered", turns: [] };
      case "resolve-time":
        return { startsAt: laterTime(String(b.said ?? ""), b) };
      case "triage-maintenance":
        return this.triage(b);
      default:
        throw new Error(`MockLLM has no handler for ${name}`);
    }
  }

  private route(b: Blocks) {
    // A call transcript is read for what the caller said, not Telo's lines.
    const text =
      b.latest_message != null
        ? String(b.latest_message)
        : String(b.call_transcript ?? "")
            .split("\n")
            .filter((l) => l.trim() && !/^TELO:/.test(l))
            .map((l) => l.replace(/^[A-Z][A-Z .'-]{0,30}:\s*/, ""))
            .join(" ");
    const tasks = (b.open_tasks as Array<{
      id: string;
      title: string;
      status: string;
      openQuestion: { kind: string; fields: { key: string }[]; options: { id: string; label: string }[] } | null;
    }>) ?? [];
    const containsSecret = /\b(password|passcode|pin)\b[^a-z]*\w*\d/i.test(text) || /\b\d{3}-\d{2}-\d{4}\b/.test(text);
    const base = { taskId: null, request: null, answers: [], decision: null, query: null, needsHistory: false, preference: null, updates: null };
    const waiting = tasks.find((t) => t.openQuestion);
    const lower = text.toLowerCase();

    if (/\b(just text me|only text( me)?|text me instead|stop calling me|don'?t call me)\b/i.test(text)) {
      return { containsSecret, actions: [{ ...base, type: "set_updates", updates: "text" }], reply: null };
    }
    if (/\b(call me (with|for) updates|call me too|call me as well|also call me|phone me when)\b/i.test(text)) {
      return { containsSecret, actions: [{ ...base, type: "set_updates", updates: "call" }], reply: null };
    }

    if (STATUS.test(text) && !/\b(can you|please|call)\b/i.test(text)) {
      const about = tasks.find((t) => t.title.toLowerCase().split(/\s+/).some((w) => w.length > 3 && lower.includes(w)));
      const needsHistory = /last time|before|previous|ever|promis|history|how often|how many/i.test(text);
      return { containsSecret, actions: [{ ...base, type: "status", taskId: about?.id ?? null, query: text, needsHistory }], reply: null };
    }
    if (waiting?.openQuestion?.kind === "approval" && (YES.test(text) || NO.test(text))) {
      const options = waiting.openQuestion.options;
      const byLabel = options.find((o) =>
        o.label.toLowerCase().split(/\W+/).some((w) => w.length > 3 && lower.includes(w)),
      );
      const approve = !NO.test(text) || Boolean(byLabel);
      const option = byLabel ?? (approve ? options[0] : options[options.length - 1]);
      return {
        containsSecret,
        actions: [{ ...base, type: "decide", taskId: waiting.id, decision: { optionId: option?.id ?? null, approve, note: null } }],
        reply: null,
      };
    }
    const newRequest = /^\s*(ask|call|book|cancel|find|schedule|reschedule|get|have|tell|order)\b/i.test(text);
    if (waiting?.openQuestion?.kind === "info" && !newRequest && !/\b(can you|could you|please call)\b/i.test(text)) {
      const fields = waiting.openQuestion.fields;
      const answers = fields.map((f, i) => {
        if (/email/i.test(f.key)) return { key: f.key, value: text.match(EMAIL)?.[0] ?? text };
        if (/phone|number/i.test(f.key) && PHONE.test(text)) return { key: f.key, value: text.match(PHONE)![0] };
        return { key: f.key, value: i === 0 ? text : "" };
      }).filter((a) => a.value);
      return { containsSecret, actions: [{ ...base, type: "provide_info", taskId: waiting.id, answers }], reply: null };
    }
    const scheduled = tasks.find((t) => t.status === "scheduled");
    if (scheduled && /\b(call (them|it) (now|right away)|call now|don'?t wait)\b/i.test(text)) {
      return { containsSecret, actions: [{ ...base, type: "retry_task", taskId: scheduled.id }], reply: null };
    }
    const failed = tasks.find((t) => t.status === "failed");
    if (failed && /\b(try again|retry|give it another)\b/i.test(text)) {
      return { containsSecret, actions: [{ ...base, type: "retry_task", taskId: failed.id }], reply: null };
    }
    if (/^\s*(hi|hey|hello|thanks|thank you|ty)\b/i.test(text) && text.length < 40) {
      return { containsSecret, actions: [{ ...base, type: "chat" }], reply: "Hey! Text me anything that needs a phone call and I'll handle it." };
    }
    if (/\b(stop|never ?mind|cancel that)\b/i.test(text) && tasks[0]) {
      return { containsSecret, actions: [{ ...base, type: "cancel_task", taskId: tasks[0].id }], reply: null };
    }
    return { containsSecret, actions: [{ ...base, type: "new_task", request: text }], reply: null };
  }

  private understand(b: Blocks) {
    const request = String(b.request ?? "");
    const directory = (b.directory as Dir[]) ?? [];
    const category = categorize(request);
    let targets = findInDirectory(request, directory);
    const recent = (b.recent_businesses as { business: string; lastTask: string }[] | undefined) ?? [];
    if (!targets.length && /\b(again|them|back|same)\b/i.test(request) && recent.length) {
      const hit = recent.find((r) => category === "support" ? /bill|fix|credit/i.test(r.lastTask) : true) ?? recent[0];
      targets = directory.filter((d) => d.name === hit.business.split(", ")[0]);
    }
    if (category === "quotes" && targets.length === 0) {
      const service = request.match(/\b(windshield|plumb\w*|dent\w*|repair|movers?|locksmith)\b/i)?.[0]?.toLowerCase();
      if (service) targets = directory.filter((d) => d.aliases.some((a) => a.toLowerCase().includes(service.slice(0, 6)))).slice(0, 3);
    }
    const typedPhone = request.match(PHONE)?.[0] ?? null;
    const known = (b.facts_already_provided as { key: string; value: string }[] | undefined) ?? [];
    const email = request.match(EMAIL)?.[0] ?? known.find((f) => /email/i.test(f.key))?.value ?? null;
    const name = targets[0]?.name ?? null;
    const missing: unknown[] = [];
    const facts: unknown[] = [];
    if (email) facts.push({ key: "account_email", label: "Email on the account", value: email, sensitive: true });
    if (!targets.length && !typedPhone) {
      missing.push({ key: "business", label: "Business", question: "Which business should I call, and what's their number?", sensitive: false, required: true });
    }
    if (category === "membership" && !email) {
      missing.push({ key: "account_email", label: "Email on the account", question: "What's the email on the membership?", sensitive: true, required: true });
    }
    const availability = typeof b.user_availability === "string" ? b.user_availability : null;
    const userName = (b.user_profile as { name?: string } | undefined)?.name ?? "the user";
    const calendarLine = availability ? `Free on ${userName}'s calendar: ${availability.split("; ").slice(0, 3).join("; ")}` : null;
    const firstFree = availability?.match(/^([^:]+): ([^,;-]+)/);
    if (category === "reservation" && !availability && !/\b\d{1,2}(:\d{2})?\s*(am|pm)?\b|tonight|tomorrow|morning|afternoon|evening/i.test(request)) {
      missing.push({ key: "time", label: "Preferred time", question: "What day and time works?", sensitive: false, required: true });
    }
    const verb = { membership: "Cancel", support: "Sort out bill with", reservation: "Book", quotes: "Get quotes", inquiry: "Call", other: "Call" }[category] ?? "Call";
    const title =
      category === "quotes"
        ? `Get quotes: ${request.match(/windshield|plumber|repair/i)?.[0] ?? "service"}`
        : category === "membership"
          ? `Cancel ${name ?? "membership"} membership`
          : category === "support"
            ? name ? `Fix ${name} bill` : "Fix a bill"
            : category === "reservation"
              ? `Book ${name ?? "a table"}`
              : `${verb} ${name ?? "business"}`;
    const ask = missing.map((m) => (m as { question: string }).question).join(" ");
    const callAt = /\bcall\b/i.test(request) ? laterTime(request, b) : null;
    const when = callAt ? formatWhen(new Date(callAt), clock(b).tz, { now: clock(b).now }) : null;
    return {
      title,
      goal: request,
      category,
      needsPhoneCall: true,
      targets: targets.length
        ? targets.map((t) => ({ name: t.name, phone: t.phone, kind: "business" as const }))
        : typedPhone
          ? [{ name: "the business", phone: typedPhone, kind: "business" as const }]
          : [],
      facts,
      missing,
      constraints: [...moneyValues(request).map((v) => `Budget up to $${v}`), ...(category === "reservation" && calendarLine ? [calendarLine] : [])],
      usesUserTime: category === "reservation" || category === "quotes",
      callAt,
      authority: {
        allowed: ["Do exactly what was asked", "Ask about policies, fees and timing"],
        askFirst: ["Retention offers or discounts instead of the requested action", "Any new fee or contract", "Anything different from the request"],
        never: ["Share passwords or PINs"],
        spendLimitUsd: moneyValues(request)[0] ?? null,
      },
      acknowledgement: missing.length
        ? `On it. ${ask}`
        : when
          ? `Got it. I'll call ${name ?? "them"} ${when}.`
          : category === "reservation" && firstFree
            ? `On it. You're free ${firstFree[1]} from ${firstFree[2].trim()}, so I'll aim for that.`
            : `On it. I'll call ${name ?? "them"} and let you know how it goes.`,
    };
  }

  private plan(b: Blocks) {
    const task = b.task as { title: string; goal: string | null; request: string };
    const targets = (b.targets as { name: string }[]) ?? [];
    const history = String(b.prior_history_with_business ?? "(none)");
    const followUp = b.follow_up as { userDecision: string | null; callback?: { targetName?: string } | null } | undefined;
    const facts = (b.facts as { key: string }[]) ?? [];
    const legTargets = followUp?.callback?.targetName ? [{ name: followUp.callback.targetName }] : targets;
    return {
      strategy: legTargets.length > 1 ? "Call each business and compare." : `Call ${legTargets[0]?.name ?? "the business"} directly.`,
      parallel: false,
      legs: legTargets.map((t) => ({
        targetName: t.name,
        purpose: followUp ? `Follow up: ${followUp.userDecision ?? "continue"}` : task.title,
        objective: followUp ? `${task.goal ?? task.request}. The user decided: ${followUp.userDecision ?? "continue"}.` : task.goal ?? task.request,
        openingLine: `Hi, this is Telo, an AI assistant calling on behalf of my client about ${task.title.toLowerCase()}.`,
        talkingPoints: [task.goal ?? task.request, ...(history !== "(none)" ? [history] : []), ...(followUp?.userDecision ? [`The customer's decision: ${followUp.userDecision}`] : [])],
        mayDisclose: facts.map((f) => f.key),
        decisionRules: ["Defer any offer that changes the request"],
        collect: ["Confirmation number", "Any fees or dates"],
        fallback: "Ask for the right department or a callback number.",
      })),
      userUpdate: `Calling ${legTargets.map((t) => t.name).join(", ")} now.`,
    };
  }

  private analyze(b: Blocks) {
    const transcript = String(b.transcript ?? "");
    const them = transcript.split("\n").filter((l) => l.startsWith("THEM:")).join(" ");
    const all = transcript;
    const history = String(b.prior_history_given_to_agent ?? "");
    // New numbers only: the ones the business gave on this call, not ones quoted from history.
    const confs = confirmationNumbers(them).filter((n) => !history.toUpperCase().includes(n));
    const prices = moneyValues(them);
    const base = {
      facts: [] as { label: string; value: string }[],
      offers: [] as unknown[],
      commitments: [] as unknown[],
      confirmationNumbers: confs,
      repName: them.match(/\bthis is ([A-Z][a-z]+)/)?.[1] ?? them.match(/\bmy name is ([A-Z][a-z]+)/)?.[1] ?? null,
      quote: null as unknown,
      decisionNeeded: null as unknown,
      priorCommitments: [] as unknown[],
      callbackAt: null as string | null,
      infoRequested: [] as { label: string; reason: string }[],
      booking: null as unknown,
    };
    const tonight = tonightWindow(them, b);
    if (/booked|got you down|moved it|scheduled you|see you (then|tomorrow)/i.test(them)) {
      const startsAt = tonight?.startsAt ?? laterTime(them, b);
      const where = (b.call_brief as { targetName?: string } | undefined)?.targetName;
      if (startsAt) base.booking = { title: `${(b.task as { title: string }).title}${where ? ` (${where})` : ""}`, startsAt, endsAt: tonight?.endsAt ?? null, location: null };
    }
    const priorConf = (String(b.prior_history_given_to_agent ?? "") + " " + JSON.stringify(b.call_brief ?? "")).match(/confirmation ([A-Z0-9]{4,})/i)?.[1] ?? null;
    if (/never (got )?applied|wasn't applied|was not applied|don't see (it|the credit)|no record/i.test(all) && priorConf) {
      base.priorCommitments.push({ kind: "account_credit", description: "Previously promised credit was never applied", status: "broken", confirmationNumber: priorConf.toUpperCase() });
    }
    if (!them.trim()) {
      return { ...base, outcome: "no_answer", summary: "Nobody picked up.", nextStep: "Try again later." };
    }
    if (/wrong number|no one (here )?by that name|this is a (private )?residence|not (a|the) business/i.test(them)) {
      return { ...base, outcome: "wrong_number", summary: "Wrong number: it isn't the business.", nextStep: "Get the right number." };
    }
    if (/only (speak|talk|discuss)\w* (with|to) the account holder|account holder (has|needs|will need) to/i.test(them)) {
      return { ...base, outcome: "failed", summary: "They'll only discuss the account with the account holder.", nextStep: "The user has to call themselves." };
    }
    const needed = them.match(/\b(?:need|have|get) (?:the|your) (account number|member(?:ship)? (?:id|number)|date of birth|order number)\b/i)?.[1];
    if (needed && !confs.length) {
      const label = needed[0].toUpperCase() + needed.slice(1).toLowerCase();
      return {
        ...base,
        outcome: "partial",
        summary: `They need the ${needed.toLowerCase()} to go further.`,
        infoRequested: [{ label, reason: "To find the account" }],
        callbackAt: laterTime(them, b),
        nextStep: `Get the ${needed.toLowerCase()} and call back.`,
      };
    }
    const callLater = /\b(call (us |me )?back|try (us |again)|check back|check again|reach out again)\b/i.test(them) || /\b(we|i)('| wi)ll call you back\b/i.test(them);
    const later = callLater ? laterTime(them, b) : null;
    if (later && !confs.length) {
      return {
        ...base,
        outcome: "callback_required",
        summary: `They asked for a call back later.`,
        callbackAt: later,
        commitments: /\b(we|i)('| wi)ll call you back\b/i.test(them) ? [{ by: "business", kind: "callback", description: "Call back", amountUsd: null, due: later }] : [],
        nextStep: "Call back then.",
      };
    }
    const deferred = /confirm with|check with|get back to you|call (you )?back/i.test(all);
    // The user already decided while the business waited on the line.
    const decidedLive = ((b.answered_during_call as { answer: string }[] | undefined) ?? []).some((x) => /^Decided:/.test(x.answer));
    if (deferred && !decidedLive && /\/\s?month|per month|a month|discount|instead/i.test(them)) {
      const price = prices[0] ?? null;
      return {
        ...base,
        outcome: "needs_user_decision",
        summary: `They offered ${price ? `$${price}/month` : "a discount"} to stay instead of cancelling.`,
        offers: [{ kind: "retention_discount", description: `Stay for ${price ? `$${price}/month` : "a discount"}`, priceUsd: price, requiresDecision: true }],
        decisionNeeded: {
          question: `They offered ${price ? `$${price}/month` : "a discount"} instead of cancelling. Accept the offer, or keep cancelling?`,
          options: [
            { id: "accept_offer", label: `Accept ${price ? `$${price}/month` : "the offer"}` },
            { id: "keep_cancelling", label: "Keep cancelling" },
          ],
        },
        nextStep: "Ask the user, then call back.",
      };
    }
    const noAvail = /no availability|fully booked|booked up|can't do|cannot do|nothing until/i.test(them);
    const isQuote = /quote|price|estimate|replace|diagnostic|trip fee/i.test(String((b.call_brief as { purpose?: string })?.purpose ?? "") + them);
    if (isQuote && (prices.length || noAvail)) {
      const when = tonight?.label ?? them.match(/\b(tomorrow|today|monday|tuesday|wednesday|thursday|friday)\b[^.]*?\b(\d{1,2}(:\d{2})?\s*(am|pm)?)/i)?.[0] ?? null;
      return {
        ...base,
        outcome: noAvail ? "partial" : "success",
        summary: noAvail ? "No availability in the requested window." : `Quoted $${prices[0]}${when ? `, ${when}` : ""}.`,
        quote: { priceUsd: noAvail ? null : prices[0] ?? null, availability: noAvail ? "none" : when, notes: null },
        nextStep: "Compare quotes.",
      };
    }
    const credit = prices.length ? `$${prices[0]}` : null;
    const ends = them.match(/\bends ([A-Z][a-z]+ \d{1,2})/)?.[1];
    const when = them.match(/\b(tomorrow|today|tonight|thursday|friday)\b[^.]*?\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i)?.[0];
    const conf = confs[0];
    const summary = /cancel/i.test(them) && conf
      ? `Cancelled.${ends ? ` The membership ends ${ends}.` : ""} Confirmation ${conf}.`
      : credit && /credit/i.test(them)
        ? `${credit} credit applied${base.priorCommitments.length ? " (the one promised last time was never applied)" : ""}.${conf ? ` Confirmation ${conf}.` : ""}`
        : /booked|got you down|moved it/i.test(them)
          ? `Booked${when ? ` for ${when}` : ""}.${conf ? ` Confirmation ${conf}.` : ""}`
          : conf
            ? `Done. Confirmation ${conf}.`
            : "They took care of it.";
    return {
      ...base,
      outcome: "success",
      summary,
      commitments: credit
        ? [{ by: "business", kind: /refund/i.test(them) ? "refund" : "account_credit", description: `Apply ${credit}`, amountUsd: prices[0], due: null }]
        : /cancel/i.test(them) && confs.length
          ? [{ by: "business", kind: "cancellation", description: "Cancel the membership", amountUsd: null, due: them.match(/\b(?:ends|effective|through|until) ([A-Z][a-z]+ \d{1,2})/)?.[1] ?? null }]
          : [],
      nextStep: "Report back to the user.",
    };
  }

  /** Keyword triage of a tenant's report: trade, severity, emergencies. */
  private triage(b: Blocks) {
    const report = String(b.report ?? "");
    const t = report.toLowerCase();
    const first = String(b.tenant_first_name ?? "there");
    const photos = Number(b.photos_sent ?? 0);
    const gas = /smell(s|ing)? (of )?gas|gas smell|gas leak/.test(t);
    const fire = /\bfire\b|smoke|sparks?|sparking/.test(t);
    const co = /carbon monoxide|\bco alarm|co detector/.test(t);
    const flood = /flood|pouring|burst|gushing|water everywhere/.test(t);
    const rules: [RegExp, string, string, string][] = [
      [/\b(ac|a\/c|air ?condition\w*|cooling|blowing warm)\b/, "hvac", "ac_no_cool", "AC not cooling"],
      [/\b(heat|heater|furnace)\b/, "hvac", "no_heat", "No heat"],
      [/hot water|water heater/, "plumbing", "wh_no_hot_water", "No hot water"],
      [/\b(leak|leaking|drip|toilet|sink|clog|drain|pipe)\b/, "plumbing", /toilet|clog|drain/.test(t) ? "drain_clog" : "sink_leak", /toilet|clog|drain/.test(t) ? "Clogged drain" : "Leak"],
      [/\b(outlet|power|breaker|lights?|electric\w*)\b/, "electrical", "outlet_dead", "Power out to part of the unit"],
      [/\b(fridge|refrigerator|dishwasher|washer|dryer|stove|oven|range)\b/, "appliance", "appliance_broken", "Appliance not working"],
      [/\b(lock|key|door won'?t)\b/, "locks", "lock_broken", "Lock problem"],
      [/\b(roof|ceiling stain)\b/, "roof", "roof_leak", "Roof leak"],
    ];
    const hit = rules.find(([re]) => re.test(t));
    const [trade, jobCode, title] = hit ? [hit[1], hit[2], hit[3]] : ["general", "general_repair", "Repair needed"];
    const emergency = gas ? "gas" : fire ? "fire" : co ? "co" : flood ? "water" : "none";
    const severity = emergency !== "none" ? "emergency" : /hvac|plumbing|locks|electrical/.test(trade) ? "urgent" : "routine";
    const needPhotos = photos === 0 && emergency === "none";
    const ask = trade === "hvac" ? "a photo of the thermostat and the outdoor unit" : trade === "plumbing" ? "a photo of the leak and what's under it" : "a photo of the problem";
    return {
      title,
      problem: report.replace(/\s+/g, " ").trim().slice(0, 200),
      trade,
      severity,
      emergency,
      jobCode,
      needPhotos,
      tenantReply: needPhotos
        ? `Thanks ${first}, I'm lining up a vendor now and will text you a time. Can you send ${ask}?`
        : `Thanks ${first}, I'm lining up a vendor now and will text you a time.`,
      safetyMessage:
        gas || co ? "Please leave the home now and call 911 from outside, then the gas company. Don't flip switches or use anything that sparks." : fire ? "Get out now and call 911." : flood ? "If it's safe, shut the water valve under the sink or at the main. Move valuables away from the water." : null,
    };
  }

  private decide(b: Blocks) {
    const calls = (b.calls_so_far as {
      target: string;
      attempt: number;
      analysis: {
        outcome: string;
        summary: string;
        confirmationNumbers: string[];
        decisionNeeded: { question: string; options: unknown[] } | null;
        quote: { priceUsd: number | null; availability: string | null } | null;
        callbackAt: string | null;
        infoRequested: { label: string }[];
      } | null;
    }[]) ?? [];
    const remaining = (b.planned_calls_not_yet_made as unknown[]) ?? [];
    const task = b.task as { title: string; category: string | null };
    const last = calls[calls.length - 1];
    const a = last?.analysis;
    const base = { question: null, callback: null, result: null, learnedFacts: [], scheduleAt: null, infoFields: [] };
    const decision = b.users_latest_decision as string | undefined;
    const mails = (b.emails as { from: string | null; kind: string | null; summary: string | null; confirmationNumber: string | null }[] | undefined) ?? [];
    const settling = mails.filter((m) => m.confirmationNumber && ["refund", "receipt", "confirmation"].includes(m.kind ?? "")).at(-1);
    if (settling && (!a || ["callback_required", "partial", "no_answer", "voicemail"].includes(a.outcome))) {
      const msg = `${settling.from} emailed: ${settling.summary} No need to call them again.`;
      return { ...base, action: "complete", userMessage: msg, result: { outcome: "success", summary: settling.summary ?? "Settled by email.", confirmation: settling.confirmationNumber } };
    }
    const followUp = (purpose: string) => ({ targetName: last.target, purpose, objective: task.title, talkingPoints: [purpose] });
    if (a?.outcome === "callback_required" && a.callbackAt) {
      return { ...base, action: "schedule", scheduleAt: a.callbackAt, callback: followUp("Follow up as they asked"), userMessage: "" };
    }
    if (a?.outcome === "wrong_number") {
      const field = { key: `phone_${last.target.toLowerCase()}`, label: `${last.target}'s number`, question: `What's the right number for ${last.target}?`, sensitive: false };
      return { ...base, action: "ask_info", infoFields: [field], userMessage: `That number wasn't ${last.target}. ${field.question}` };
    }
    if (a?.infoRequested?.length) {
      const fields = a.infoRequested.map((r) => ({ key: r.label.toLowerCase().replace(/\W+/g, "_"), label: r.label, question: `What's your ${r.label.toLowerCase()}?`, sensitive: true }));
      return { ...base, action: "ask_info", infoFields: fields, callback: followUp("Give them what they asked for"), userMessage: `${last.target} needs your ${fields.map((f) => f.label.toLowerCase()).join(" and ")}. ${fields[0].question}` };
    }
    if (a?.outcome === "failed" && /account holder/i.test(a.summary)) {
      const msg = `${last.target} will only talk to the account holder, so you'll need to call them yourself.`;
      return { ...base, action: "fail", userMessage: msg, result: { outcome: "failed", summary: a.summary, confirmation: null } };
    }
    if (a?.outcome === "needs_user_decision" && a.decisionNeeded && !decision) {
      return { ...base, action: "ask_user", userMessage: a.decisionNeeded.question, question: { prompt: a.decisionNeeded.question, options: a.decisionNeeded.options } };
    }
    if (a?.outcome === "needs_user_decision" && decision) {
      return { ...base, action: "callback", userMessage: `Got it. Calling ${last.target} back now.`, callback: { targetName: last.target, purpose: `Tell them: ${decision}`, objective: decision, talkingPoints: [decision] } };
    }
    if ((a?.outcome === "no_answer" || a?.outcome === "voicemail") && (last?.attempt ?? 1) < Number(b.max_attempts_per_call ?? 2)) {
      return { ...base, action: "retry", userMessage: "" };
    }
    if (remaining.length) return { ...base, action: "next_call", userMessage: "" };
    if (a?.outcome === "success" && a.confirmationNumbers.length) {
      const conf = a.confirmationNumbers[0];
      return { ...base, action: "complete", userMessage: a.summary, result: { outcome: "success", summary: a.summary, confirmation: conf } };
    }
    if (task.category === "quotes") {
      const quotes = calls
        .filter((c) => c.analysis?.quote?.priceUsd != null)
        .sort((x, y) => (x.analysis!.quote!.priceUsd! - y.analysis!.quote!.priceUsd!));
      const best = quotes[0];
      if (best && !decision) {
        const msg = `${best.target} can do it${best.analysis!.quote!.availability ? ` ${best.analysis!.quote!.availability}` : ""} for $${best.analysis!.quote!.priceUsd}. Want me to book it?`;
        return { ...base, action: "ask_user", userMessage: msg, question: { prompt: msg, options: [{ id: "book", label: "Book it" }, { id: "skip", label: "Don't book" }] } };
      }
      if (best && decision && /book/i.test(decision)) {
        return { ...base, action: "callback", userMessage: `Booking with ${best.target}.`, callback: { targetName: best.target, purpose: "Book the quoted appointment", objective: `Book at the quoted price of $${best.analysis!.quote!.priceUsd}`, talkingPoints: ["Book the slot they offered"] } };
      }
    }
    if (a && ["success", "partial"].includes(a.outcome)) {
      const conf = a.confirmationNumbers[0] ?? null;
      return { ...base, action: "complete", userMessage: a.summary, result: { outcome: a.outcome === "success" ? "success" : "partial", summary: a.summary, confirmation: conf } };
    }
    return { ...base, action: "fail", userMessage: `I couldn't get through on "${task.title}". Want me to try again later?`, result: { outcome: "failed", summary: a?.summary ?? "Could not complete.", confirmation: null } };
  }

  private readEmail(b: Blocks) {
    const email = b.email as { from: string; fromName: string | null; subject: string; text: string };
    const directory = (b.directory as string[]) ?? [];
    const tasks = (b.open_tasks as { id: string; status: string; businesses: string[] }[]) ?? [];
    const all = `${email.subject}\n${email.text}`;
    const lower = all.toLowerCase();
    const businessy = /receipt|order|refund|confirm|booking|reservation|appointment|bill|statement|invoice|claim|payment|charge|delivery|shipped|cancel|account/i.test(all);
    const marketing = /unsubscribe|newsletter|% off|sale ends/i.test(all) && !/receipt|refund/i.test(all);
    const relevant = businessy && !marketing;
    const business = directory.find((d) => lower.includes(d.toLowerCase())) ?? email.fromName ?? email.from.split("@")[1] ?? null;
    const needsCall = /denied|declined|overdue|past due|wrong|incorrect|please call|call us|missed|dispute/i.test(all);
    const kind = /refund/i.test(all) ? "refund" : /appointment/i.test(all) ? "appointment" : needsCall ? "problem" : /bill|statement|invoice/i.test(all) ? "bill" : /receipt|order/i.test(all) ? "receipt" : /confirm/i.test(all) ? "confirmation" : "other";
    const amount = moneyValues(all)[0] ?? null;
    const conf = confirmationNumbers(all)[0] ?? null;
    const task = tasks.find((t) => t.businesses.some((x) => x.toLowerCase() === (business ?? "").toLowerCase()));
    return {
      relevant,
      business: relevant ? business : null,
      kind,
      summary: relevant ? `${email.subject.replace(/\.$/, "")}${amount != null && !email.subject.includes("$") ? ` ($${amount})` : ""}.` : "",
      amountUsd: amount,
      confirmationNumber: conf,
      taskId: relevant ? task?.id ?? null : null,
      settlesTask: Boolean(relevant && task && conf && !needsCall && ["refund", "receipt", "confirmation"].includes(kind)),
      needsCall: relevant && needsCall,
      callReason: relevant && needsCall ? `Call ${business} about the ${kind}` : null,
      phone: all.match(PHONE)?.[0] ?? null,
    };
  }

  private status(b: Blocks) {
    const tasks = (b.tasks as { title: string; status: string; now: string | null; result: string | null }[]) ?? [];
    const history = (b.history as { summary: string; occurredAt: string }[]) ?? [];
    const q = String(b.question ?? "").toLowerCase();
    if (/last time|before|previous|promis/.test(q) && history.length) {
      const h = history.slice(-3).map((e) => `${e.occurredAt.slice(0, 10)}: ${e.summary}`).join("; ");
      return { reply: `Here's what I have: ${h}.` };
    }
    if (!tasks.length) return { reply: "Nothing in progress right now. Text me anything that needs a call." };
    return { reply: tasks.slice(0, 3).map((t) => `${t.title}: ${t.now ?? t.result ?? t.status}`).join(" ") };
  }

  private brief(b: Blocks) {
    const events = (b.history_events as { id: string; summary: string; occurredAt: string; type: string }[]) ?? [];
    // Promises, offers and their fate are what the next call needs.
    const relevant = events.filter((e) => /^(commitment|offer)\./.test(e.type));
    if (!relevant.length) return { summary: "", relevantEventIds: [] };
    const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric" });
    return {
      summary: relevant.map((e) => `On ${day(e.occurredAt)}, ${e.summary.replace(/^(\w+) promised: /, "$1 promised ")}.`).join(" "),
      relevantEventIds: relevant.map((e) => e.id),
    };
  }
}
