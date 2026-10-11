import type { z } from "zod";
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
const NO = /\b(no|nope|don't|do not|decline|keep cancel|continue cancel|just cancel)\b/i;
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
      case "simulate-call":
        return { outcome: "answered", turns: [] };
      default:
        throw new Error(`MockLLM has no handler for ${name}`);
    }
  }

  private route(b: Blocks) {
    const text = String(b.latest_message ?? b.call_transcript ?? "");
    const tasks = (b.open_tasks as Array<{
      id: string;
      title: string;
      status: string;
      openQuestion: { kind: string; fields: { key: string }[]; options: { id: string; label: string }[] } | null;
    }>) ?? [];
    const containsSecret = /\b(password|passcode|pin)\b[^a-z]*\w*\d/i.test(text) || /\b\d{3}-\d{2}-\d{4}\b/.test(text);
    const base = { taskId: null, request: null, answers: [], decision: null, query: null, needsHistory: false, preference: null };
    const waiting = tasks.find((t) => t.openQuestion);
    const lower = text.toLowerCase();

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
    if (waiting?.openQuestion?.kind === "info" && !/\b(can you|could you|please call)\b/i.test(text)) {
      const fields = waiting.openQuestion.fields;
      const answers = fields.map((f, i) => {
        if (/email/i.test(f.key)) return { key: f.key, value: text.match(EMAIL)?.[0] ?? text };
        if (/phone|number/i.test(f.key) && PHONE.test(text)) return { key: f.key, value: text.match(PHONE)![0] };
        return { key: f.key, value: i === 0 ? text : "" };
      }).filter((a) => a.value);
      return { containsSecret, actions: [{ ...base, type: "provide_info", taskId: waiting.id, answers }], reply: null };
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
    if (email) facts.push({ key: "account_email", label: "Email on the account", value: email, sensitive: false });
    if (!targets.length && !typedPhone) {
      missing.push({ key: "business", label: "Business", question: "Which business should I call, and what's their number?", sensitive: false, required: true });
    }
    if (category === "membership" && !email) {
      missing.push({ key: "account_email", label: "Email on the account", question: "What's the email on the membership?", sensitive: false, required: true });
    }
    if (category === "reservation" && !/\b\d{1,2}(:\d{2})?\s*(am|pm)?\b|tonight|tomorrow|morning|afternoon|evening/i.test(request)) {
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
      constraints: moneyValues(request).map((v) => `Budget up to $${v}`),
      authority: {
        allowed: ["Do exactly what was asked", "Ask about policies, fees and timing"],
        askFirst: ["Retention offers or discounts instead of the requested action", "Any new fee or contract", "Anything different from the request"],
        never: ["Share passwords or PINs"],
        spendLimitUsd: moneyValues(request)[0] ?? null,
      },
      acknowledgement: missing.length ? `On it. ${ask}` : `On it. I'll call ${name ?? "them"} and let you know how it goes.`,
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
    };
    const priorConf = (String(b.prior_history_given_to_agent ?? "") + " " + JSON.stringify(b.call_brief ?? "")).match(/confirmation ([A-Z0-9]{4,})/i)?.[1] ?? null;
    if (/never (got )?applied|wasn't applied|was not applied|don't see (it|the credit)|no record/i.test(all) && priorConf) {
      base.priorCommitments.push({ kind: "account_credit", description: "Previously promised credit was never applied", status: "broken", confirmationNumber: priorConf.toUpperCase() });
    }
    if (!them.trim()) {
      return { ...base, outcome: "no_answer", summary: "Nobody picked up.", nextStep: "Try again later." };
    }
    const deferred = /confirm with|check with|get back to you|call (you )?back/i.test(all);
    if (deferred && /\/\s?month|per month|a month|discount|instead/i.test(them)) {
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
    const isQuote = /quote|price|estimate|replace/i.test(String((b.call_brief as { purpose?: string })?.purpose ?? "") + them);
    if (isQuote && (prices.length || noAvail)) {
      const when = them.match(/\b(tomorrow|today|monday|tuesday|wednesday|thursday|friday)\b[^.]*?\b(\d{1,2}(:\d{2})?\s*(am|pm)?)/i)?.[0] ?? null;
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

  private decide(b: Blocks) {
    const calls = (b.calls_so_far as { target: string; attempt: number; analysis: { outcome: string; summary: string; confirmationNumbers: string[]; decisionNeeded: { question: string; options: unknown[] } | null; quote: { priceUsd: number | null; availability: string | null } | null } | null }[]) ?? [];
    const remaining = (b.planned_calls_not_yet_made as unknown[]) ?? [];
    const task = b.task as { title: string; category: string | null };
    const last = calls[calls.length - 1];
    const a = last?.analysis;
    const base = { question: null, callback: null, result: null, learnedFacts: [] };
    const decision = b.users_latest_decision as string | undefined;
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
    const relevant = events.filter((e) => /commitment|confirmation|offer|promise|completed|fact/.test(e.type));
    if (!relevant.length) return { summary: "", relevantEventIds: [] };
    return {
      summary: relevant.map((e) => `On ${new Date(e.occurredAt).toDateString().slice(4)}: ${e.summary}`).join(" "),
      relevantEventIds: relevant.map((e) => e.id),
    };
  }
}
