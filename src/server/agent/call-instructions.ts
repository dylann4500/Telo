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

/** Drops empty and repeated lines (the planner often restates the authority rules). */
function unique(items: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const item = raw.trim();
    const key = item.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, max);
}

const HOW_TO_TALK = [
  "This is a live phone call. Say one or two short sentences, then stop and let them talk.",
  "Ask for one thing at a time. Never read out numbered lists or several requests at once.",
  "Follow their lead. If they decline or say later to anything that isn't the goal, accept it and move on.",
  "As soon as the goal is done and you have a confirmation or reference number, repeat it back, thank them and end the call.",
];

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
    `## How to talk\n${bullets(HOW_TO_TALK)}`,
    `## Goal of this call\n${leg.objective}`,
    input.history ? `## What happened before (use it; state it exactly as written)\n${input.history}` : "",
    `## Points to cover, one at a time\n${bullets(unique(leg.talkingPoints, 4))}`,
    `## Details you may share, only when they ask or it is needed\n${bullets([
      `Customer name: ${userName}`,
      ...shareable.map((f) => `${f.label}: ${f.value}`),
    ])}`,
    input.constraints.length ? `## ${userName}'s constraints\n${bullets(input.constraints)}` : "",
    `## You may do this on your own\n${bullets(unique([
      "Navigate phone menus, wait on hold, ask to be transferred",
      ...(authority?.allowed ?? []),
      ...leg.decisionRules,
    ], 6))}`,
    `## Check with ${userName} first (do not agree to these on this call)\n${bullets(unique([
      ...(authority?.askFirst ?? ["Any new fee, contract, plan change or purchase"]),
      authority?.spendLimitUsd != null ? `Anything costing more than $${authority.spendLimitUsd}` : "",
    ], 5))}\nIf one of these comes up: thank them, say you need to confirm with ${userName} and will call back, ask for a reference number, then end the call politely.`,
    `## Never\n${bullets(unique([
      "Share passwords, PINs, security answers, full card numbers or Social Security numbers. If they require one, say the customer will provide it directly.",
      "Say anything is true unless it is in this brief. If you don't know, say you'll check.",
      "Agree to anything unrelated to the goal.",
      ...(authority?.never ?? []),
    ], 5))}`,
    `## Get before you hang up\n${bullets(unique(["A confirmation or reference number, if one exists", ...leg.collect], 4))}`,
    `## If you get stuck\n${leg.fallback}`,
    "If you reach voicemail, leave no message and hang up.",
  ];

  return {
    instructions: sections.filter(Boolean).join("\n\n"),
    firstMessage: leg.openingLine,
  };
}
