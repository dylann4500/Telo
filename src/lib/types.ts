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
  | "completed"
  | "failed"
  | "cancelled";

export interface Modes {
  llm: "anthropic" | "mock";
  voice: "dial" | "mock";
  memory: "keewano" | "local";
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
  user: { name: string; phone: string | null; channel: string };
  teloPhone: string | null;
  tasks: TaskSummaryDTO[];
  messages: MessageDTO[];
  liveUserCall: LiveCallDTO | null;
  /** Shown until the user's phone is linked: text "LINK <code>" to Telo's number. */
  pairingCode: string | null;
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
  lastError: string | null;
}
