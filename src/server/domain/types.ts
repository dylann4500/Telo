// Shared domain types for Telo's task model. Anything an LLM produces is
// validated with the zod schemas in src/server/agent/schemas.ts before it
// lands in one of these shapes.

export const TASK_STATUSES = [
  "new", // just created from a request; Telo hasn't read it yet
  "needs_info", // waiting on the user for a fact the calls need
  "planning", // pulling history and writing the call plan
  "ready", // a call is planned and about to be placed
  "calling", // a call is in progress
  "reviewing", // reading the finished call and deciding what's next
  "needs_approval", // the business offered something the user must decide
  "scheduled", // waiting until wakeAt to call (a callback the business asked for, or a delayed retry)
  "completed",
  "failed",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TERMINAL_STATUSES: readonly TaskStatus[] = ["completed", "failed", "cancelled"];
export const WAITING_ON_USER: readonly TaskStatus[] = ["needs_info", "needs_approval"];

export type Channel = "sms" | "imessage" | "whatsapp" | "web" | "voice" | "email"; // email: a task Telo suggested from the inbox

export type TaskCategory = "reservation" | "membership" | "support" | "quotes" | "inquiry" | "other";

export interface TaskTarget {
  name: string;
  phone: string | null;
  kind: "business" | "person";
}

// A fact Telo may use on calls. `source` keeps user-provided facts separate
// from things Telo learned on calls or from memory, so the phone agent never
// presents an inference as something the user said.
export interface Fact {
  key: string;
  label: string;
  value: string;
  sensitive: boolean;
  source: "user" | "call" | "memory" | "profile";
}

export interface Authority {
  allowed: string[]; // fine without asking
  askFirst: string[]; // pause and ask the user
  never: string[]; // hard limits
  spendLimitUsd: number | null;
}

export interface CallBrief {
  targetName: string;
  targetPhone: string | null;
  purpose: string; // one line, shown in the UI
  objective: string; // what success on this call means
  openingLine: string;
  talkingPoints: string[];
  mayDisclose: string[]; // fact keys the agent may share
  decisionRules: string[]; // what it can decide alone, what needs the user
  collect: string[]; // what to write down (names, prices, confirmation numbers)
  fallback: string; // what to do if blocked
}

export interface Plan {
  strategy: string;
  legs: CallBrief[];
  parallel: boolean;
}

export interface MemoryBrief {
  summary: string; // what the call agent is told about past dealings
  events: { id: string; type: string; summary: string; occurredAt: string }[];
  retrievedAt: string;
  source: "keewano" | "local";
  trace: { via: string; request: string; ms: number; rows: number }[];
}

export interface FollowUp {
  reason: "user_decision" | "callback" | "retry";
  userDecision: string | null; // e.g. "Keep cancelling (user said: no retention offers)"
  callback: { targetName: string; purpose: string; objective: string; talkingPoints: string[] } | null;
}

export interface TaskResult {
  outcome: "success" | "partial" | "failed" | "cancelled";
  summary: string;
  confirmation: string | null;
}

export type CallStatus = "planned" | "queued" | "ringing" | "in_progress" | "ended" | "failed" | "canceled";

export interface TranscriptTurn {
  speaker: "agent" | "other" | "system";
  text: string;
  at: string | null; // ISO timestamp when known
}

export interface CallAnalysis {
  outcome:
    | "success"
    | "partial"
    | "needs_user_decision"
    | "callback_required"
    | "failed"
    | "no_answer"
    | "voicemail"
    | "wrong_number";
  summary: string;
  facts: { label: string; value: string }[];
  offers: {
    kind: (typeof OFFER_KINDS)[number];
    description: string;
    priceUsd: number | null;
    requiresDecision: boolean;
  }[];
  commitments: {
    by: "business" | "agent";
    kind: (typeof COMMITMENT_KINDS)[number];
    description: string;
    amountUsd: number | null;
    due: string | null;
  }[];
  priorCommitments: {
    kind: (typeof COMMITMENT_KINDS)[number];
    description: string;
    status: "fulfilled" | "broken" | "reaffirmed";
    confirmationNumber: string | null;
  }[];
  confirmationNumbers: string[];
  repName: string | null;
  quote: { priceUsd: number | null; availability: string | null; notes: string | null } | null;
  decisionNeeded: { question: string; options: { id: string; label: string }[] } | null;
  // When the business asked to be called back ("in 3 days", "after 2pm Thursday").
  callbackAt: string | null;
  // Things the business asked for that Telo couldn't provide.
  infoRequested: { label: string; reason: string }[];
  // An appointment or reservation this call booked, for the user's calendar.
  booking?: { title: string; startsAt: string; endsAt: string | null; location: string | null } | null;
  nextStep: string;
}

// Low-cardinality, typed facts about an event: categories, cents, seconds,
// flags. This is the only part of an event that goes to Keewano; names,
// transcripts and free text stay in Telo's own database.
export interface TypedFacts {
  taskKind?: string;
  outcome?: string;
  purpose?: string;
  offerKind?: string;
  commitmentKind?: string;
  confirms?: string;
  approvalKind?: string;
  channel?: string;
  amountCents?: number;
  holdSeconds?: number;
  durationSeconds?: number;
  dueAt?: string; // ISO
  confirmationNumber?: string;
  briefUsed?: boolean;
  emailKind?: string;
  // Property management (docs/property-management/research.md section 5.3).
  trade?: Trade;
  severity?: Severity;
  intakeChannel?: "sms" | "mms" | "call" | "email";
  photoCount?: number;
  fixCode?: string;
  secsToResolve?: number;
  emergencyKind?: string;
  emergencyRoute?: "tenant_911" | "utility" | "oncall" | "vendor" | "deescalated";
  secsToHuman?: number;
  jobCode?: string;
  quoteCents?: number;
  tripFeeCents?: number;
  warrantyDays?: number;
  earliestSlotHours?: number;
  declineReason?: "busy" | "out_of_area" | "wrong_trade" | "no_answer" | "price";
  dispatchRank?: number;
  bookedCents?: number;
  approvalResponseSeconds?: number;
  approvalChannel?: "sms" | "voice" | "dashboard";
  approvalWhileHolding?: boolean;
  noticePurpose?: "repair" | "inspection" | "preventive" | "showing";
  noticeHours?: number;
  noticeMethod?: "sms" | "email" | "posted" | "mail";
  accessOutcome?: "done" | "no_access" | "rescheduled" | "tenant_cancelled";
  reschedules?: number;
  commitmentLateMinutes?: number;
  vendorOutcome?: "on_time" | "late" | "no_show" | "cancelled";
  lateMinutes?: number;
  woOutcome?: "fixed_first_visit" | "fixed_multi_visit" | "not_fixed" | "cancelled";
  visits?: number;
  daysToFix?: number;
  invoiceOverQuotePct?: number;
  tenantConfirmed?: boolean;
  managerTouches?: number;
  daysSinceDone?: number;
  assetType?: AssetType;
  installYear?: number;
  repairCents?: number;
  repeatWithin90d?: boolean;
  decision?: "repair" | "replace" | "defer";
  replaceCents?: number;
  assetAgeYears?: number;
  callParty?: PartyRole;
}

export const TRADES = ["plumbing", "hvac", "electrical", "appliance", "roof", "pest", "locks", "landscape", "cleaning", "paint", "flooring", "general"] as const;
export type Trade = (typeof TRADES)[number];
export const SEVERITIES = ["emergency", "urgent", "routine", "cosmetic"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const ASSET_TYPES = ["water_heater", "furnace", "ac", "heat_pump", "fridge", "range", "dishwasher", "washer", "dryer", "roof", "garage_door"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
export type PartyRole = "manager" | "owner" | "tenant" | "vendor" | "agency" | "prospect";

/** The portfolio entities an event belongs to; they pick its Keewano streams. Ids only, never names. */
export interface EntityRefs {
  owner?: string;
  property?: string;
  unit?: string;
  asset?: string;
  vendor?: string;
  tenancy?: string;
  agency?: string;
  prospect?: string;
}

/** What a property-management task is about, beyond the call engine's own fields. */
export interface TaskContext extends EntityRefs {
  kind: "maintenance";
  trade?: Trade;
  severity?: Severity;
  jobCode?: string;
  photoCount?: number;
  /** Vendors in scorecard order, best first, as ranked when the task was planned. */
  ranked?: string[];
  /** Where the work order is: triage, calling vendors, booked (waiting for the visit), checking it's fixed, closed. */
  stage?: "triage" | "dispatching" | "booked" | "checking" | "closed";
  problem?: string;
  /** The work order's short title, e.g. "AC not cooling". */
  issue?: string;
  /** Asset history says ask for a replacement price too (or the owner asked for one). */
  replaceQuote?: boolean;
  booked?: { vendor: string; callId?: string; cents: number; startsAt: string | null; endsAt: string | null; confirmation: string | null; ownerApproved: boolean };
  accessConfirmed?: boolean;
  /** Calls whose booking fell through (no-show, didn't hold): never booked from again. */
  voided?: string[];
}

/** Who a message went to or came from, when it isn't the property manager. */
export interface MessageParty {
  role: PartyRole;
  id: string;
  name: string;
}

export const OFFER_KINDS = ["retention_discount", "quote", "fee_waiver", "payment_plan", "upgrade", "other"] as const;
export const COMMITMENT_KINDS = [
  "account_credit",
  "refund",
  "callback",
  "cancellation",
  "fee_waiver",
  "appointment",
  "reservation",
  "other",
] as const;

export interface InfoField {
  key: string;
  label: string;
  question: string;
  sensitive: boolean;
  required: boolean;
}

export interface ApprovalOption {
  id: string;
  label: string;
}

export type QuestionKind = "info" | "approval";
