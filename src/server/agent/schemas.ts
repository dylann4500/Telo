import { z } from "zod";
import { COMMITMENT_KINDS, OFFER_KINDS } from "../domain/types";

// Output contracts for every model call. Kept free of length/regex limits so
// they convert cleanly to the JSON Schema subset structured outputs accept.

export const FactSchema = z.object({
  key: z.string().describe("snake_case identifier, e.g. account_email"),
  label: z.string().describe("Human label, e.g. 'Email on the account'"),
  value: z.string(),
  sensitive: z.boolean().describe("true for account numbers, member ids, emails, phone numbers, DOB, addresses"),
});

export const InfoFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  question: z.string().describe("How to ask the user for it, casual and short"),
  sensitive: z.boolean(),
  required: z.boolean().describe("true only if the call cannot reasonably succeed without it"),
});

export const AuthoritySchema = z.object({
  allowed: z.array(z.string()).describe("Things Telo may do on the call without asking"),
  askFirst: z.array(z.string()).describe("Things that need the user's OK before agreeing"),
  never: z.array(z.string()).describe("Hard limits for this task"),
  spendLimitUsd: z.number().nullable().describe("Max the user pre-approved spending, if any"),
});

export const OptionSchema = z.object({
  id: z.string().describe("short snake_case id"),
  label: z.string().describe("short label the user can reply with"),
});

export const RouteSchema = z.object({
  containsSecret: z
    .boolean()
    .describe("true if the message includes a password, PIN, security code or full card/SSN number"),
  actions: z
    .array(
      z.object({
        type: z.enum(["new_task", "provide_info", "decide", "status", "cancel_task", "retry_task", "remember_preference", "chat"]),
        taskId: z.string().nullable().describe("Existing task this action refers to, if any"),
        request: z.string().nullable().describe("new_task: the request, cleaned up but in the user's terms"),
        answers: z
          .array(z.object({ key: z.string(), value: z.string() }))
          .describe("provide_info: values for the open question's field keys"),
        decision: z
          .object({
            optionId: z.string().nullable(),
            approve: z.boolean().describe("false if the user declines everything offered"),
            note: z.string().nullable().describe("Any condition or extra instruction the user added"),
          })
          .nullable(),
        query: z.string().nullable().describe("status: what the user wants to know"),
        needsHistory: z
          .boolean()
          .describe("status: true if answering needs past interactions (last time, ever, how often), not just current tasks"),
        preference: z.string().nullable().describe("remember_preference: a durable, benign preference"),
      }),
    )
    .describe("Usually one action; more only if the user clearly asked for several things"),
  reply: z.string().nullable().describe("Only for pure chat: what Telo says back. null otherwise"),
});
export type RouteResult = z.infer<typeof RouteSchema>;

export const UnderstandSchema = z.object({
  title: z.string().describe("Short task title, e.g. 'Cancel Equinox membership'"),
  goal: z.string().describe("One sentence: what done looks like"),
  category: z.enum(["reservation", "membership", "support", "quotes", "inquiry", "other"]),
  needsPhoneCall: z.boolean(),
  targets: z
    .array(
      z.object({
        name: z.string(),
        phone: z.string().nullable().describe("E.164 if the user or directory gave one, else null"),
        kind: z.enum(["business", "person"]),
      }),
    )
    .describe("Who to call. Several for quotes/availability tasks"),
  facts: z.array(FactSchema).describe("Facts from the request or profile the calls will use"),
  missing: z.array(InfoFieldSchema).describe("Only information the calls genuinely need and Telo lacks"),
  constraints: z.array(z.string()).describe("Time windows, budgets, party size, preferences for this task"),
  authority: AuthoritySchema,
  usesUserTime: z
    .boolean()
    .describe("true if the result is something the user must attend or be free for: an appointment, reservation, visit, delivery window, or a call or meeting with them"),
  callAt: z
    .string()
    .nullable()
    .describe("Only if the user asked for the call to happen later ('tomorrow morning', 'Monday at 9'): when, ISO 8601 with offset. null to call now"),
  acknowledgement: z
    .string()
    .describe("First text back to the user: confirm the task in a few words and ask the missing questions, if any"),
});
export type UnderstandResult = z.infer<typeof UnderstandSchema>;

export const PlanSchema = z.object({
  strategy: z.string().describe("One or two sentences on the approach"),
  parallel: z.boolean().describe("true when several businesses can be called at the same time"),
  legs: z.array(
    z.object({
      targetName: z.string(),
      purpose: z.string().describe("One line for the UI, e.g. 'Ask about the $20 credit promised Oct 2'"),
      objective: z.string(),
      openingLine: z.string().describe("What Telo says first when a person answers"),
      talkingPoints: z.array(z.string()),
      mayDisclose: z.array(z.string()).describe("Fact keys the agent may share if asked"),
      decisionRules: z.array(z.string()),
      collect: z.array(z.string()).describe("What to note down before hanging up"),
      fallback: z.string(),
    }),
  ),
  userUpdate: z.string().describe("Short text to the user that calling is starting, e.g. 'Calling Equinox now.'"),
});
export type PlanResult = z.infer<typeof PlanSchema>;

export const CallAnalysisSchema = z.object({
  outcome: z.enum([
    "success",
    "partial",
    "needs_user_decision",
    "callback_required",
    "failed",
    "no_answer",
    "voicemail",
    "wrong_number",
  ]),
  summary: z.string().describe("Two sentences max, plain language"),
  facts: z.array(z.object({ label: z.string(), value: z.string() })).describe("Policies, fees, hours, availability"),
  offers: z.array(
    z.object({
      kind: z.enum(OFFER_KINDS),
      description: z.string(),
      priceUsd: z.number().nullable(),
      requiresDecision: z.boolean(),
    }),
  ),
  commitments: z
    .array(
      z.object({
        by: z.enum(["business", "agent"]),
        kind: z.enum(COMMITMENT_KINDS),
        description: z.string(),
        amountUsd: z.number().nullable(),
        due: z.string().nullable().describe("ISO date if a date was stated"),
      }),
    )
    .describe("New promises made on this call"),
  priorCommitments: z
    .array(
      z.object({
        kind: z.enum(COMMITMENT_KINDS),
        description: z.string(),
        status: z.enum(["fulfilled", "broken", "reaffirmed"]),
        confirmationNumber: z.string().nullable(),
      }),
    )
    .describe("Promises from earlier calls (listed in the brief) whose status this call revealed"),
  confirmationNumbers: z.array(z.string()),
  repName: z.string().nullable(),
  quote: z
    .object({ priceUsd: z.number().nullable(), availability: z.string().nullable(), notes: z.string().nullable() })
    .nullable()
    .describe("For quote/availability calls only"),
  decisionNeeded: z
    .object({ question: z.string(), options: z.array(OptionSchema) })
    .nullable()
    .describe("Set when the business offered something only the user can decide"),
  callbackAt: z
    .string()
    .nullable()
    .describe("If the business asked to be called back later, when: an ISO 8601 date-time with offset, resolved from 'now'. null otherwise"),
  infoRequested: z
    .array(z.object({ label: z.string(), reason: z.string() }))
    .describe("Details the business asked for that Telo didn't have (account number, date of birth...)"),
  booking: z
    .object({
      title: z.string().describe("Short calendar title, e.g. 'Dentist cleaning, Bright Smile Dental'"),
      startsAt: z.string().describe("ISO 8601 with offset, resolved from now"),
      endsAt: z.string().nullable(),
      location: z.string().nullable(),
    })
    .nullable()
    .describe("Set when the call booked, moved or confirmed an appointment, reservation, visit or delivery window for the user at a specific time"),
  nextStep: z.string(),
});

export const DecideSchema = z.object({
  action: z.enum(["complete", "ask_user", "ask_info", "next_call", "callback", "schedule", "retry", "fail"]),
  userMessage: z
    .string()
    .describe("Text message to the user: at most two short sentences, under 280 characters. Empty string if nothing new"),
  question: z.object({ prompt: z.string(), options: z.array(OptionSchema) }).nullable(),
  callback: z
    .object({
      targetName: z.string(),
      purpose: z.string(),
      objective: z.string(),
      talkingPoints: z.array(z.string()),
    })
    .nullable()
    .describe("For callback and schedule: the call to make"),
  scheduleAt: z
    .string()
    .nullable()
    .describe("For schedule: when to call, ISO 8601 with offset: the business's callbackAt, or a time it is likely open"),
  infoFields: z
    .array(z.object({ key: z.string(), label: z.string(), question: z.string(), sensitive: z.boolean() }))
    .describe("For ask_info: what to ask the user. Use key phone_<business> for a correct phone number"),
  result: z
    .object({
      outcome: z.enum(["success", "partial", "failed"]),
      summary: z.string(),
      confirmation: z.string().nullable(),
    })
    .nullable(),
  learnedFacts: z.array(z.object({ key: z.string(), label: z.string(), value: z.string() })),
});
export type DecideResult = z.infer<typeof DecideSchema>;

export const ReadEmailSchema = z.object({
  relevant: z
    .boolean()
    .describe("true only for mail from a business about the user's own dealings: an order, receipt, refund, booking, appointment, bill, claim, delivery or account problem"),
  business: z.string().nullable().describe("Who it's from, as a short business name (a directory name when one matches)"),
  kind: z.enum(["receipt", "refund", "confirmation", "appointment", "bill", "claim", "delivery", "cancellation", "problem", "other"]),
  summary: z.string().describe("One sentence for the user: what the email says, with the amount and date if any. No account numbers"),
  amountUsd: z.number().nullable(),
  confirmationNumber: z.string().nullable().describe("An order, confirmation, reference or case number it states"),
  taskId: z.string().nullable().describe("The open task this email is about (ids from open_tasks only)"),
  settlesTask: z.boolean().describe("true only if the email by itself completes that task (the receipt or confirmation it was waiting for)"),
  needsCall: z
    .boolean()
    .describe("true if a phone call would likely fix or move something forward: a problem, a denial, a charge that looks wrong, a request to call, a missed or cancelled appointment"),
  callReason: z.string().nullable().describe("If needsCall: the request in the user's words, e.g. 'Call Comcast to dispute the $15 late fee'"),
  phone: z.string().nullable().describe("A phone number the email gives for reaching them, exactly as written"),
});
export type ReadEmailResult = z.infer<typeof ReadEmailSchema>;

export const StatusReplySchema = z.object({
  reply: z.string().describe("The text Telo sends back. Short, specific, no filler"),
});

export const HistoryBriefSchema = z.object({
  summary: z
    .string()
    .describe("What the call agent should know about past dealings, with dates, amounts and reference numbers. Empty if nothing relevant"),
  relevantEventIds: z.array(z.string()),
});

export const SimulatedCallSchema = z.object({
  outcome: z.enum(["answered", "no_answer", "voicemail"]),
  turns: z.array(z.object({ speaker: z.enum(["agent", "other"]), text: z.string() })),
});
