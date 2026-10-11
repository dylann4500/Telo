import type { Authority, CallAnalysis, CallBrief, Fact, TaskTarget, TranscriptTurn } from "../domain/types";
import { getLLM } from "./llm";
import * as P from "./prompts";
import * as S from "./schemas";

// The structured model calls Telo makes. Each one gets its context as tagged
// JSON blocks and returns schema-validated data.

function context(blocks: Record<string, unknown>): string {
  return Object.entries(blocks)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `<${k}>\n${typeof v === "string" ? v : JSON.stringify(v, null, 2)}\n</${k}>`)
    .join("\n\n");
}

export interface OpenTaskContext {
  id: string;
  title: string;
  status: string;
  statusDetail: string | null;
  openQuestion: {
    kind: "info" | "approval";
    prompt: string;
    fields: { key: string; label: string }[];
    options: { id: string; label: string }[];
  } | null;
}

export function routeInbound(input: {
  text: string;
  via: "message" | "call_transcript";
  now: string;
  openTasks: OpenTaskContext[];
  recentConversation: { from: "user" | "telo"; text: string }[];
  alreadyHandled?: string[];
}) {
  return getLLM().structured({
    name: "route-inbound",
    tier: "fast",
    system: P.ROUTE_SYSTEM,
    prompt: context({
      now: input.now,
      open_tasks: input.openTasks,
      recent_conversation: input.recentConversation,
      already_handled_during_call: input.alreadyHandled?.length ? input.alreadyHandled : undefined,
      [input.via === "message" ? "latest_message" : "call_transcript"]: input.text,
    }),
    schema: S.RouteSchema,
    effort: "low",
  });
}

export function understandTask(input: {
  request: string;
  now: string;
  user: { name: string; phone: string | null };
  preferences: string[];
  directory: { name: string; phone: string | null; aliases: string[] }[];
  knownFacts: { key: string; label: string; value: string }[];
  recentBusinesses: { business: string; lastTask: string; when: string; outcome: string | null }[];
}) {
  return getLLM().structured({
    name: "understand-task",
    system: P.UNDERSTAND_SYSTEM,
    prompt: context({
      now: input.now,
      user_profile: input.user,
      saved_preferences: input.preferences,
      directory: input.directory,
      facts_already_provided: input.knownFacts.length ? input.knownFacts : undefined,
      recent_businesses: input.recentBusinesses.length ? input.recentBusinesses : undefined,
      request: input.request,
    }),
    schema: S.UnderstandSchema,
    effort: "medium",
  });
}

export function planCalls(input: {
  now: string;
  userName: string;
  task: { title: string; goal: string | null; request: string; category: string | null };
  targets: TaskTarget[];
  facts: Pick<Fact, "key" | "label" | "value" | "source">[];
  constraints: string[];
  authority: Authority | null;
  history: string;
  priorCalls: { target: string; purpose: string; summary: string | null; outcome: string | null }[];
  followUp: { reason: string; userDecision: string | null; callback: unknown } | null;
}) {
  return getLLM().structured({
    name: "plan-calls",
    system: P.PLAN_SYSTEM,
    prompt: context({
      now: input.now,
      on_behalf_of: input.userName,
      task: input.task,
      targets: input.targets,
      facts: input.facts,
      constraints: input.constraints,
      authority: input.authority,
      prior_history_with_business: input.history || "(none)",
      earlier_calls_on_this_task: input.priorCalls,
      follow_up: input.followUp ?? undefined,
    }),
    schema: S.PlanSchema,
    effort: "medium",
  });
}

export function analyzeCall(input: {
  task: { title: string; goal: string | null };
  leg: CallBrief | null;
  transcript: TranscriptTurn[];
  endReason: string | null;
  history: string | null;
}): Promise<CallAnalysis> {
  const transcript = input.transcript.length
    ? input.transcript.map((t) => `${t.speaker === "agent" ? "TELO" : t.speaker === "other" ? "THEM" : "SYSTEM"}: ${t.text}`).join("\n")
    : "(no transcript: nobody spoke)";
  return getLLM().structured({
    name: "analyze-call",
    system: P.ANALYZE_SYSTEM,
    prompt: context({
      task: input.task,
      call_brief: input.leg ?? "(none)",
      prior_history_given_to_agent: input.history || "(none)",
      end_reason: input.endReason ?? "unknown",
      transcript,
    }),
    schema: S.CallAnalysisSchema,
    effort: "medium",
  });
}

export function decideNext(input: {
  now: string;
  task: { title: string; goal: string | null; request: string; category: string | null };
  constraints: string[];
  authority: Authority | null;
  calls: { id: string; target: string; purpose: string; attempt: number; status: string; analysis: CallAnalysis | null }[];
  remainingLegs: { target: string; purpose: string }[];
  maxAttemptsPerLeg: number;
  latestDecision: string | null;
}) {
  return getLLM().structured({
    name: "decide-next",
    system: P.DECIDE_SYSTEM,
    prompt: context({
      now: input.now,
      task: input.task,
      constraints: input.constraints,
      authority: input.authority,
      calls_so_far: input.calls,
      planned_calls_not_yet_made: input.remainingLegs,
      max_attempts_per_call: input.maxAttemptsPerLeg,
      users_latest_decision: input.latestDecision ?? undefined,
    }),
    schema: S.DecideSchema,
    effort: "medium",
  });
}

export function answerStatus(input: { question: string; now: string; tasks: unknown[]; history: unknown[] }) {
  return getLLM().structured({
    name: "answer-status",
    tier: "fast",
    system: P.STATUS_SYSTEM,
    prompt: context({ now: input.now, tasks: input.tasks, history: input.history, question: input.question }),
    schema: S.StatusReplySchema,
    effort: "low",
  });
}

export function briefHistory(input: {
  business: string;
  task: { title: string; goal: string | null; request: string };
  events: { id: string; type: string; summary: string; occurredAt: string }[];
}) {
  return getLLM().structured({
    name: "brief-history",
    tier: "fast",
    system: P.HISTORY_SYSTEM,
    prompt: context({ business: input.business, new_task: input.task, history_events: input.events }),
    schema: S.HistoryBriefSchema,
    effort: "low",
  });
}

export function simulateCall(input: { business: string; instructions: string; scenario: string }) {
  return getLLM().structured({
    name: "simulate-call",
    tier: "fast",
    system: P.SIMULATE_SYSTEM,
    prompt: context({ business: input.business, scenario: input.scenario, agent_instructions: input.instructions }),
    schema: S.SimulatedCallSchema,
    effort: "low",
  });
}
