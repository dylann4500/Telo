// Shapes the API returns to the dashboard. Sensitive values are already
// masked server-side; nothing here is a secret.

export type TaskStatus =
  | "new"
  | "needs_info"
  | "planning"
  | "ready"
  | "calling"
  | "reviewing"
  | "needs_approval"
  | "scheduled"
  | "completed"
  | "failed"
  | "cancelled";

export interface Modes {
  llm: "anthropic" | "mock";
  voice: "dial" | "mock";
  memory: "keewano" | "local";
  mail: "gmail" | "mock" | "off";
  calendar: "google" | "mock" | "off";
  devTools: boolean;
}

export interface LiveCallDTO {
  id: string;
  target: string;
  status: string;
  statusDetail: string | null;
  startedAt: string | null;
  answeredAt: string | null;
}

export interface QuestionDTO {
  id: string;
  kind: "info" | "approval";
  prompt: string;
  options: { id: string; label: string }[];
  fields: { key: string; label: string }[];
  status: string;
  answeredAt: string | null;
  /** Asked during a call: the business is waiting on the line for the answer. */
  live: { target: string; askedAt: string } | null;
}

export interface TaskSummaryDTO {
  id: string;
  title: string;
  status: TaskStatus;
  statusDetail: string | null;
  category: string | null;
  targets: string[];
  source: string;
  createdAt: string;
  updatedAt: string;
  live: LiveCallDTO | null;
  waiting: QuestionDTO | null;
  result: { outcome: string; summary: string; confirmation: string | null } | null;
  memoryUsed: boolean;
  callsMade: number;
  /** When a scheduled task will call next. */
  wakeAt: string | null;
}

export interface MessageDTO {
  id: string;
  direction: "in" | "out";
  channel: string;
  kind: string;
  body: string;
  status: string;
  error: string | null;
  taskId: string | null;
  createdAt: string;
}

export interface StateDTO {
  modes: Modes;
  /** callUpdates: also phone the user (the "Text + call" toggle). textsFailing: the latest text didn't arrive. */
  user: { name: string; phone: string | null; channel: string; callUpdates: boolean; textsFailing: boolean };
  teloPhone: string | null;
  tasks: TaskSummaryDTO[];
  messages: MessageDTO[];
  liveUserCall: LiveCallDTO | null;
  /** Shown until the user's phone is linked: text "LINK <code>" to Telo's number. */
  pairingCode: string | null;
  /** The latest question nobody prepared for, answered with live SQL on Keewano. */
  lastKeewanoQuery: { question: string; answer: string | null; sql: string; rows: number; ms: number; at: string } | null;
}

export interface TurnDTO {
  speaker: "agent" | "other" | "system";
  text: string;
}

export interface CallDTO {
  id: string;
  kind: string;
  direction: string;
  seq: number;
  attempt: number;
  targetName: string;
  purpose: string;
  status: string;
  statusDetail: string | null;
  startedAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  endReason: string | null;
  transcript: TurnDTO[];
  analysis: {
    outcome: string;
    summary: string;
    facts: { label: string; value: string }[];
    offers: { kind: string; description: string; priceUsd: number | null }[];
    commitments: { kind: string; description: string; amountUsd: number | null }[];
    priorCommitments: { kind: string; description: string; status: string; confirmationNumber: string | null }[];
    confirmationNumbers: string[];
    repName: string | null;
    nextStep: string;
  } | null;
  instructions: string | null;
}

export interface EventDTO {
  id: string;
  type: string;
  summary: string;
  occurredAt: string;
  mirrored: boolean; // has a typed slice that goes to Keewano
  synced: boolean;
  syncError: string | null;
}

export interface MemoryDTO {
  summary: string;
  events: { id: string; type: string; summary: string; occurredAt: string }[];
  retrievedAt: string;
  source: string;
  trace: { via: string; request: string; ms: number; rows: number }[];
}

/** One step in "How Telo handled it": what happened, which systems did the work, and what the user heard. */
export interface FlowStepDTO {
  id: string;
  kind: "request" | "understand" | "ask" | "answer" | "memory" | "plan" | "call" | "schedule" | "email" | "calendar" | "done" | "stopped";
  title: string;
  detail: string | null;
  /** The full text when `detail` was shortened. */
  more: string | null;
  at: string;
  tone: "work" | "live" | "wait" | "done" | "bad" | "muted";
  systems: ("you" | "claude" | "keewano" | "dial" | "gmail" | "calendar")[];
  badges: string[];
  /** What happened inside a call while it was on: questions to you, calendar checks, offers, confirmations. */
  children: { title: string; detail: string | null; at: string; tone: FlowStepDTO["tone"] }[];
  /** What Telo told you at this step, and how. */
  told: { how: "text" | "call" | "app" | "voice"; body: string; delivered: boolean }[];
  /** This step's typed facts went to event memory (Keewano, or the local stand-in), or are on their way. */
  memory: { where: "keewano" | "local"; synced: boolean } | null;
  /** Claude made this decision after reading a call or an email. */
  decided: boolean;
}

export interface TaskDetailDTO extends TaskSummaryDTO {
  request: string;
  goal: string | null;
  facts: { key: string; label: string; value: string; sensitive: boolean; source: string }[];
  constraints: string[];
  authority: { allowed: string[]; askFirst: string[]; never: string[]; spendLimitUsd: number | null } | null;
  plan: { strategy: string; parallel: boolean; legs: { targetName: string; purpose: string; objective: string }[] } | null;
  memory: MemoryDTO | null;
  calls: CallDTO[];
  questions: QuestionDTO[];
  events: EventDTO[];
  flow: FlowStepDTO[];
  lastError: string | null;
}
