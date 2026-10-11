// Scripted businesses for the simulated phone line. With a Claude key the
// mock asks Claude to role-play the `persona`; without one it plays the
// canned `script`. Each script reacts to what the call brief says (prior
// history, the user's decision), so follow-up calls behave differently. A
// persona can also depend on how many times the business has been called:
// a string is role-played, fixed turns are played as written, and null
// means nobody picks up.

export interface SimTurn {
  speaker: "agent" | "other";
  text: string;
  /**
   * Agent only: call one of Telo's mid-call tools here, after saying `text`
   * (the "one moment" line). wait_for_customer keeps being called, with a
   * "still checking" line in between, until it stops saying to wait.
   */
  tool?: { name: string; args?: Record<string, unknown> };
  /** Said instead of `text` when the last tool brought no answer (timeout, declined, busy). `{answer}` in `text` is the answer. */
  orElse?: string;
}

export interface ScriptContext {
  user: string;
  business: string;
  instructions: string;
  callNumber: number; // 1 for the first call this business gets
}

export interface Scenario {
  match: RegExp;
  persona: string | ((callNumber: number) => string | SimTurn[] | null);
  script(ctx: ScriptContext): SimTurn[] | "no_answer";
}

const agent = (text: string): SimTurn => ({ speaker: "agent", text });
const other = (text: string): SimTurn => ({ speaker: "other", text });

function field(instructions: string, label: RegExp): string | null {
  const m = instructions.match(new RegExp(`${label.source}:\\s*([^\\n]+)`, "i"));
  return m?.[1]?.trim() ?? null;
}

function intro(ctx: ScriptContext, about: string): SimTurn {
  return agent(`Hi, this is Telo, an AI assistant calling on behalf of ${ctx.user}. I'm calling about ${about}.`);
}

export const SCENARIOS: Scenario[] = [
  {
    match: /equinox|gym|fitness/i,
    persona:
      "Membership desk at an upscale gym. The member wants to cancel. On a first call, offer a retention deal of $18/month (down from $65) and push once. If the caller says the member decided to cancel anyway, process it: 30 days notice, membership ends November 8, confirmation 18392, no fee. If the caller accepts the offer, switch the plan to $18/month from the next cycle, confirmation R5521.",
    script(ctx) {
      const email = field(ctx.instructions, /email on the account/) ?? "the email on file";
      const decision = ctx.instructions.toLowerCase();
      if (/keep[_ ]cancel|continue cancel|cancel anyway|proceed with (the )?cancel/.test(decision)) {
        return [
          agent(`Hi, this is Telo, an AI assistant calling back on behalf of ${ctx.user}. We spoke earlier about the membership. ${ctx.user} has decided to go ahead and cancel.`),
          other("Thanks for calling back. Can I get the email on the account?"),
          agent(`Sure, it's ${email}.`),
          other("Got it. I've processed the cancellation. With our 30-day notice the membership ends November 8. Your confirmation number is 18392."),
          agent("Thank you. So it ends November 8, confirmation 18392. Are there any fees?"),
          other("No fees. You're all set."),
          agent("Great, thanks for your help. Have a good day."),
        ];
      }
      if (/accept[_ ](the )?offer|accept \$18|take the (offer|deal)/.test(decision)) {
        return [
          agent(`Hi, this is Telo calling back on behalf of ${ctx.user}. ${ctx.user} would like to accept the $18 a month offer instead of cancelling.`),
          other("Wonderful. I've switched the plan to $18 a month starting next billing cycle. Confirmation R5521."),
          agent("Thank you. $18 a month from the next cycle, confirmation R5521. No contract change?"),
          other("Same month-to-month terms."),
          agent("Perfect. Thanks so much."),
        ];
      }
      return [
        intro(ctx, `cancelling ${ctx.user}'s membership`),
        other("I can help with that. Can I get the email on the account?"),
        agent(`It's ${email}.`),
        other(`Thanks. I see the account. Before I cancel, we can offer a loyalty rate of $18 a month instead of $65, if ${ctx.user} would like to stay.`),
        agent(`Thanks for the offer. I'm not able to accept that on ${ctx.user}'s behalf without checking. I'll confirm with ${ctx.user} and call back. Can I get a reference for this call?`),
        other("Sure, I've noted the account. My name is Priya. Just mention the loyalty offer when you call back."),
        agent("Thanks Priya. I'll call back shortly."),
      ];
    },
  },
  {
    match: /comcast|xfinity/i,
    persona:
      "Billing support at an internet provider. The customer's bill went up because a promotional rate expired. If the caller cites a previously promised $20 credit under confirmation A1832, look it up, admit it was never applied, apply it now, and give confirmation C7714. Otherwise explain the promo ended and offer a $10 loyalty credit, confirmation C6620.",
    script(ctx) {
      const prior = ctx.instructions.match(/confirmation (?:number )?([A-Z]\d{3,})/i)?.[1]?.toUpperCase();
      if (prior) {
        return [
          intro(ctx, "a billing issue"),
          other("Sure, I can help. What's going on with the bill?"),
          agent(`On October 2, a representative confirmed a $20 service credit under confirmation ${prior}, but it was never applied, and this month's bill is higher again.`),
          other(`Let me pull that up. I see the note from October 2 with reference ${prior}. You're right, the credit was never applied. I'm sorry about that.`),
          agent("Thanks for checking. Can you apply it now?"),
          other("Done. I've applied the $20 credit to the current statement. Your new confirmation number is C7714. My name is Marcus."),
          agent("So the $20 credit is on the current statement, confirmation C7714. When will it show?"),
          other("Within 24 hours."),
          agent("Perfect, thank you Marcus. That's everything."),
        ];
      }
      return [
        intro(ctx, "a higher bill than usual"),
        other("Let me take a look. It looks like the promotional rate ended last cycle, so the price went up by $15."),
        agent(`Is there anything you can do to bring it back down? ${ctx.user} has been a customer for a while.`),
        other("I can add a $10 monthly loyalty credit for the next 12 months. Confirmation C6620."),
        agent("Thanks, that's within what I can accept. So a $10 monthly credit for 12 months, confirmation C6620."),
        other("That's right. Anything else?"),
        agent("No, that's all. Thank you."),
      ];
    },
  },
  {
    match: /bay auto glass/i,
    persona: "Auto glass shop. A windshield replacement is $480. Earliest opening tomorrow at 10 AM.",
    script: (ctx) => [
      intro(ctx, "a windshield replacement"),
      other("Sure. What's the car?"),
      agent("A 2019 Honda Civic. We're hoping for tomorrow."),
      other("We can do tomorrow at 10 AM. It's $480 with installation."),
      agent("Thanks, I'm checking a few shops. I'll call back if we'd like to book."),
    ],
  },
  {
    match: /mission glass/i,
    persona: "Auto glass shop that is fully booked until next week.",
    script: (ctx) => [
      intro(ctx, "a windshield replacement for tomorrow"),
      other("Sorry, we're fully booked until next Tuesday. No availability tomorrow."),
      agent("Understood, thanks for letting me know."),
    ],
  },
  {
    match: /golden gate windshield/i,
    persona:
      "Auto glass shop. Windshield replacement is $330, opening tomorrow at 3 PM. If the caller asks to book, book it under the customer's name: confirmation W2231.",
    script(ctx) {
      if (/\bbook\b/i.test(ctx.instructions) && /330|3 ?pm/i.test(ctx.instructions)) {
        return [
          agent(`Hi, this is Telo calling back on behalf of ${ctx.user}. We'd like to book the 3 PM windshield replacement tomorrow at $330.`),
          other(`Great, you're booked for tomorrow at 3 PM under ${ctx.user}. Confirmation W2231.`),
          agent("Thank you. Tomorrow 3 PM, $330, confirmation W2231."),
          other("See you then."),
        ];
      }
      return [
        intro(ctx, "a windshield replacement"),
        other("Sure thing. What's the vehicle?"),
        agent("A 2019 Honda Civic, ideally tomorrow."),
        other("We have tomorrow at 3 PM. Total is $330 installed."),
        agent("That sounds good. Let me confirm with the customer and I'll call back to book."),
      ];
    },
  },
  {
    match: /nopa|restaurant|bistro|kitchen/i,
    persona: "Restaurant host. 7:30 PM for 5 is available tonight; book under the caller's client's name.",
    script: (ctx) => [
      intro(ctx, "a reservation"),
      other("Hi! How can I help?"),
      agent(`I'd like a table for 5 tonight around 7:30, under ${ctx.user}.`),
      other(`We can do 7:30 for five. I've got you down under ${ctx.user}, confirmation number R7730.`),
      agent("Thank you, 7:30 for five, confirmation R7730."),
    ],
  },
  {
    match: /dental|dentist/i,
    persona: "Dental office front desk. Thursday at 3 PM is open; move the appointment there, confirmation D4410.",
    script: (ctx) => [
      intro(ctx, "moving an appointment"),
      other("Of course. When would you like to come in instead?"),
      agent("Thursday afternoon, if possible."),
      other("Thursday at 3 PM is open. I've moved it. Confirmation D4410."),
      agent("Thursday at 3 PM, confirmation D4410. Thank you."),
    ],
  },
];

// The mid-call question, offline: the rep needs the account number, Telo
// asks the user while they hold (ask_customer), waits (wait_for_customer),
// and passes the answer on in the same call. Answer in the dashboard.
const baysideCall = (): SimTurn[] => [
  agent("Hi, this is Telo, an AI assistant calling on behalf of Dylan. I'm calling about a new $15 equipment fee on the bill."),
  other("Bayside Internet billing. I can help with that fee, but I'll need the account number first."),
  { speaker: "agent", text: "Let me check with Dylan, one moment.", tool: { name: "ask_customer", args: { detail: "Account number", question: "What's the account number on your Bayside bill?" } } },
  { speaker: "agent", text: "", tool: { name: "wait_for_customer" } },
  { speaker: "agent", text: "Thanks for holding. The account number is {answer}.", orElse: "I'm sorry, I can't reach Dylan right now. I'll get that and call you back." },
  { speaker: "other", text: "Thanks, I found it. That $15 equipment fee was added by mistake. I've removed it, so the bill is back to $70. Your confirmation number is B4410.", orElse: "No problem. Call us back with it anytime. Your reference is BI-552." },
  { speaker: "agent", text: "Thank you. Fee removed, back to $70, confirmation B4410.", orElse: "Thank you. I'll call back with the account number, reference BI-552." },
];
SCENARIOS.push({ match: /bayside|westbay/i, persona: () => baysideCall(), script: () => baysideCall() });

// Property management, offline: two HVAC vendors called at once for Unit B's AC.
// Rapid Air can come tonight for $650, over the owner's $500 limit, so Telo asks
// the owner while Luis holds (answer as the owner from the dashboard's demo
// controls, or reply by text). Summit can only do Thursday.
const rapidAirCall = (): SimTurn[] => [
  other("Rapid Air Heating and Cooling, this is Luis."),
  agent("Hi Luis, this is Telo, an AI assistant calling for Dylan at Bayside Property Management; this call is recorded. A tenant's central AC is blowing warm air at 1418 Alder St in Oakland. Can someone come out tonight?"),
  other("We can do tonight between 8 and 9. From what you describe it's likely the capacitor and contactor. That repair is $650, all in."),
  {
    speaker: "agent",
    text: "One moment, that's over the owner's limit, so I'm checking with them.",
    tool: { name: "ask_customer", args: { detail: "Approve $650 tonight?", question: "Rapid Air can fix Unit B's AC tonight between 8 and 9 for $650. It's the third failure since June. Approve it, and do you want a replacement quote too?", options: ["Approve $650", "Approve $650 and get a replacement quote", "Don't approve"] } },
  },
  { speaker: "agent", text: "", tool: { name: "wait_for_customer" } },
  { speaker: "agent", text: "Thanks for holding. The owner says: {answer}. Please book tonight, and could your tech price a full replacement while he's there?", orElse: "Sorry, I can't reach the owner right now. Could you hold tonight's slot while I confirm and call you back?" },
  { speaker: "other", text: "You're booked for tonight between 8 and 9. Marco will bring a replacement quote too; a new 3-ton system runs about $6,800. Confirmation RA2231.", orElse: "I can hold it for an hour. Call me back when you know." },
  { speaker: "agent", text: "Tonight between 8 and 9, confirmation RA2231. Thank you, Luis.", orElse: "Thank you, I'll call you back shortly." },
];
const summitCall = (): SimTurn[] => [
  other("Summit Mechanical, Dana speaking."),
  agent("Hi Dana, this is Telo, an AI assistant calling for Dylan at Bayside Property Management; this call is recorded. A tenant's AC is out at 1418 Alder St in Oakland. When's your earliest visit, and what does it cost?"),
  other("Earliest I have is Thursday, 9 to 11 in the morning. The diagnostic is $180, plus our $79 trip fee."),
  agent("Thanks, Dana. Let me confirm with the team and get back to you."),
  other("Sounds good. I'll keep Thursday open for now."),
  agent("Thank you, bye."),
];
SCENARIOS.push({ match: /rapid air/i, persona: () => rapidAirCall(), script: () => rapidAirCall() });
SCENARIOS.push({ match: /summit mechanical/i, persona: () => summitCall(), script: () => summitCall() });

export const GENERIC: Scenario = {
  match: /.*/,
  persona: "A helpful, ordinary customer service representative who answers questions plainly and resolves simple requests.",
  script: (ctx) => [
    intro(ctx, "a request"),
    other("Sure, how can I help?"),
    agent("I'd like some help with the request my client asked about."),
    other("I've taken care of that for you. Your reference number is G1001."),
    agent("Thank you, reference G1001."),
  ],
};

export function scenarioFor(business: string): Scenario {
  return SCENARIOS.find((s) => s.match.test(business)) ?? GENERIC;
}
