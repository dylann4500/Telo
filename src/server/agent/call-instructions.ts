import type { Authority, CallBrief, Fact } from "../domain/types";

// Turns a planned call (a leg) into the brief the voice agent receives. The
// guardrails are fixed text, not model output, so every call carries them.

export interface RenderedCall {
  instructions: string;
  firstMessage: string;
}

function bullets(items: string[]): string {
  return items.length ? items.map((i) => `- ${i}`).join("\n") : "- (none)";
}

export function renderCallInstructions(input: {
  userName: string;
  leg: CallBrief;
  facts: Fact[];
  authority: Authority | null;
  history: string | null;
  constraints: string[];
}): RenderedCall {
  const { userName, leg, authority } = input;
  const allowedKeys = new Set(leg.mayDisclose);
  const shareable = input.facts.filter((f) =>
    allowedKeys.size ? allowedKeys.has(f.key) : !f.sensitive,
  );

  const sections = [
    `You are Telo, an AI assistant making a phone call to ${leg.targetName} on behalf of ${userName}. Say you are an AI assistant calling for ${userName} when you introduce yourself, and answer honestly if asked.`,
    `## Goal of this call\n${leg.objective}`,
    input.history ? `## What happened before (use it; state it exactly as written)\n${input.history}` : "",
    `## Talking points\n${bullets(leg.talkingPoints)}`,
    `## Details you may share, only when they ask or it is needed\n${bullets([
      `Customer name: ${userName}`,
      ...shareable.map((f) => `${f.label}: ${f.value}`),
    ])}`,
    input.constraints.length ? `## ${userName}'s constraints\n${bullets(input.constraints)}` : "",
    `## You may do this on your own\n${bullets([
      "Navigate phone menus, wait on hold, ask to be transferred",
      "Ask questions and take notes",
      ...(authority?.allowed ?? []),
      ...leg.decisionRules,
    ])}`,
    `## Check with ${userName} first (do not agree to these on this call)\n${bullets([
      ...(authority?.askFirst ?? ["Any new fee, contract, plan change or purchase"]),
      authority?.spendLimitUsd != null ? `Anything costing more than $${authority.spendLimitUsd}` : "",
    ].filter(Boolean))}\nIf one of these comes up: thank them, say you need to confirm with ${userName} and will call back, ask for a reference number or the best way to reach them, then end the call politely.`,
    `## Never\n${bullets([
      "Share passwords, PINs, security answers, full card numbers or Social Security numbers. If they require one, say the customer will provide it directly.",
      "Say anything is true unless it is in this brief. If you don't know, say you'll check.",
      "Agree to anything unrelated to the goal.",
      ...(authority?.never ?? []),
    ])}`,
    `## Before you hang up, make sure you have\n${bullets([...leg.collect, "The representative's name", "A confirmation or reference number, if one exists"])}`,
    `## If you get stuck\n${leg.fallback}`,
    "Keep it natural, polite and brief. If you reach voicemail, leave no message and hang up.",
  ];

  return {
    instructions: sections.filter(Boolean).join("\n\n"),
    firstMessage: leg.openingLine,
  };
}
