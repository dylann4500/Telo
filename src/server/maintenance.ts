import { and, desc, eq, isNull } from "drizzle-orm";
import * as agent from "./agent";
import type { TriageResult } from "./agent/schemas";
import { config } from "./config";
import { db } from "./db/client";
import { messages, questions, tasks, type CallRow, type QuestionRow, type TaskRow } from "./db/schema";
import type { ApprovalOption, Authority, EntityRefs, Fact, MemoryBrief, MessageParty, TaskContext } from "./domain/types";
import { TERMINAL_STATUSES } from "./domain/types";
import { newId } from "./ids";
import { recordEvent } from "./memory/events";
import { notify } from "./notify";
import { advance, finalizeTask, kick } from "./orchestrator";
import { assetFor, assetLabel, FIRM, getAsset, getOwner, getTenancy, getUnit, getVendor, homeOf, isFictional, vendorByName, type Party } from "./portfolio";
import { assetHistory, rankVendors, shouldQuoteReplacement, type Scorecard } from "./portfolio/insights";
import { containsSecret, maskSecrets } from "./redact";
import { callIsLive, getTask, getUser, listCalls, patchTask, transitionTask } from "./tasks/repo";
import { nowContext, windowLabel } from "./time";
import { getVoice } from "./voice";

// Property management: maintenance work orders, end to end.
//   1. A tenant texts (photos welcome) or calls Telo's number.
//   2. Triage: trade and severity; emergencies get safety instructions and a page first.
//   3. Memory: Keewano ranks the vendors and checks the unit's repair history.
//   4. Two vendors are called at once (the call engine). Over the owner's limit,
//      the owner is asked by text while the vendor holds (ask_customer).
//   5. Booked: the tenant gets the window and the entry notice, the others a polite no.
//   6. During the window: "on the way?" to the vendor and "fixed?" to the tenant.
//   7. "Fixed": the vendor's promise is marked kept and the work order closes.
// Every step records typed events for Keewano (research.md section 5.3).

export const isMaintenance = (t: Pick<TaskRow, "context"> | null | undefined): t is TaskRow & { context: TaskContext } => t?.context?.kind === "maintenance";

const firstName = (name: string) => name.split(" ")[0];
const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const YES = /^\s*(y|yes|yeah|yep|yup|ok|okay|sure|confirm(ed)?|correct|fixed|all good|works?( now)?|it'?s (fixed|working|good))\b/i;
const NO = /^\s*(n|no|nope|not (yet|fixed|really)|still (broken|not)|didn'?t|doesn'?t|it'?s not)\b/i;

function refsOf(ctx: TaskContext, extra: EntityRefs = {}): EntityRefs {
  const { owner, property, unit, asset, tenancy } = ctx;
  return Object.fromEntries(Object.entries({ owner, property, unit, asset, tenancy, ...extra }).filter(([, v]) => v)) as EntityRefs;
}

function tenantParty(tenancyId: string | undefined): Party | null {
  const t = getTenancy(tenancyId);
  return t ? { role: "tenant", id: t.id, name: t.tenantName, phone: t.phone } : null;
}

function ownerParty(ownerId: string | undefined): Party | null {
  const o = getOwner(ownerId);
  return o ? { role: "owner", id: o.id, name: o.name, phone: o.phone } : null;
}

function vendorParty(vendorId: string | undefined): Party | null {
  const v = getVendor(vendorId);
  return v ? { role: "vendor", id: v.id, name: v.name, phone: v.phone } : null;
}

export function vendorForCall(call: Pick<CallRow, "targetName">) {
  return vendorByName(call.targetName);
}

// ------------------------------------------------------------ messages

/** Texts a tenant, owner or vendor. Stored in the manager's thread (the dashboard mirrors it), delivered by SMS on a real line. */
export async function notifyParty(input: { party: Party; taskId?: string | null; body: string; kind: string; dedupeKey?: string }): Promise<void> {
  const body = input.body.trim();
  if (!body) return;
  const mock = getVoice().name === "mock";
  const id = newId("msg");
  const party: MessageParty = { role: input.party.role, id: input.party.id, name: input.party.name };
  const inserted = await db
    .insert(messages)
    .values({
      id,
      userId: config.user.id,
      taskId: input.taskId ?? null,
      direction: "out",
      channel: mock ? "web" : "sms",
      kind: input.kind,
      body,
      dedupeKey: input.dedupeKey ?? null,
      provider: mock ? null : getVoice().name,
      status: "queued",
      party,
    })
    .onConflictDoNothing()
    .returning();
  if (!inserted.length) return;
  try {
    if (!mock) {
      if (!input.party.phone) throw new Error("No phone number on file");
      // The seeded 555-01xx numbers reach nobody: map real phones with TELO_PORTFOLIO_PHONES.
      if (isFictional(input.party.phone)) throw new Error("Fictional demo number; set TELO_PORTFOLIO_PHONES to reach this party");
      const res = await getVoice().sendMessage({ to: input.party.phone, body, channel: "sms" });
      await db.update(messages).set({ providerMessageId: res.providerMessageId }).where(eq(messages.id, id));
    }
    await db.update(messages).set({ status: "sent" }).where(eq(messages.id, id));
    await recordEvent({
      userId: config.user.id,
      taskId: input.taskId ?? null,
      type: "message.sent",
      summary: `Texted ${input.party.name} (${input.party.role}): ${body.length > 120 ? `${body.slice(0, 117)}...` : body}`,
      data: { channel: mock ? "web" : "sms", kind: input.kind, party: input.party.role },
      typed: { channel: mock ? "in_app" : "sms" },
    });
  } catch (err) {
    console.error("[maintenance] couldn't text", input.party.role, (err as Error).message);
    await db.update(messages).set({ status: "failed", error: (err as Error).message.slice(0, 300) }).where(eq(messages.id, id));
  }
}

async function storeInbound(party: Party, body: string, channel: string, providerMessageId: string | null, taskId: string | null): Promise<string | null> {
  const id = newId("msg");
  const rows = await db
    .insert(messages)
    .values({
      id,
      userId: config.user.id,
      taskId,
      direction: "in",
      channel: channel === "voice" ? "voice" : "sms",
      kind: channel === "voice" ? "call" : "chat",
      body: maskSecrets(body),
      providerMessageId,
      status: "received",
      party: { role: party.role, id: party.id, name: party.name },
    })
    .onConflictDoNothing()
    .returning();
  return rows.length ? id : null;
}

/** The newest work order still open for a tenancy. */
async function openWorkOrder(tenancyId: string): Promise<(TaskRow & { context: TaskContext }) | undefined> {
  const rows = await db.select().from(tasks).where(eq(tasks.userId, config.user.id)).orderBy(desc(tasks.createdAt)).limit(40);
  return rows.find((t): t is TaskRow & { context: TaskContext } => isMaintenance(t) && t.context.tenancy === tenancyId && !TERMINAL_STATUSES.includes(t.status));
}

/** A text from someone in the portfolio who isn't the manager. Returns false if Telo doesn't know them. */
export async function handlePartyText(party: Party, input: { body: string; channel: string; providerMessageId: string | null; media?: string[] }): Promise<boolean> {
  const media = input.media ?? [];
  switch (party.role) {
    case "tenant":
      return tenantText(party, input.body, input.channel, input.providerMessageId, media);
    case "owner":
      return ownerText(party, input.body, input.channel, input.providerMessageId);
    case "vendor":
    case "agency":
      return otherText(party, input.body, input.channel, input.providerMessageId);
    default:
      return false;
  }
}

async function tenantText(party: Party, body: string, channel: string, providerMessageId: string | null, media: string[]): Promise<boolean> {
  const open = await openWorkOrder(party.id);
  const stored = await storeInbound(party, body || (media.length ? `(${media.length} photo${media.length === 1 ? "" : "s"})` : ""), channel, providerMessageId, open?.id ?? null);
  if (!stored) return true; // a redelivered webhook
  if (containsSecret(body)) {
    await notifyParty({ party, taskId: open?.id, kind: "reply", body: "Please don't text passwords, PINs or card numbers. I never need them." });
    return true;
  }
  if (open) return tenantFollowUp(party, open, body, media);
  await startWorkOrder(party, body, channel === "voice" ? "voice" : "sms", media, stored);
  return true;
}

/** A tenant called Telo's number: what they said becomes a work order (or a note on the open one). */
export async function handleTenantCall(party: Party, call: CallRow): Promise<void> {
  const said = call.transcript.filter((t) => t.speaker === "other").map((t) => t.text).join(" ").trim();
  if (!said) return;
  const open = await openWorkOrder(party.id);
  const stored = await storeInbound(party, said, "voice", null, open?.id ?? null);
  if (!stored) return;
  if (open) {
    await tenantFollowUp(party, open, said, []);
    return;
  }
  await startWorkOrder(party, said, "voice", [], stored);
}

/** A new report: create the work order and let the orchestrator triage it. */
export async function startWorkOrder(party: Party, report: string, source: "sms" | "voice", media: string[], messageId?: string | null): Promise<string | null> {
  const home = homeOf(party.id);
  if (!home) return null;
  const id = newId("tsk");
  const facts: Fact[] = [
    { key: "unit", label: "Unit", value: `${home.unit.label}, ${home.property.city}, ${home.property.state}`, sensitive: false, source: "profile" },
    { key: "tenant_first_name", label: "Tenant's first name", value: firstName(home.tenancy.tenantName), sensitive: false, source: "profile" },
    { key: "access_windows", label: "Tenant's preferred times", value: home.tenancy.accessWindows.join("; "), sensitive: false, source: "profile" },
    ...(home.unit.accessNotes ? [{ key: "access_notes", label: "Access notes", value: home.unit.accessNotes, sensitive: false, source: "profile" as const }] : []),
    { key: "manager", label: "Property manager", value: `${config.user.name}, ${FIRM.name}`, sensitive: false, source: "profile" },
    ...media.map((url, i) => ({ key: `photo_${i + 1}`, label: `Tenant photo ${i + 1}`, value: url, sensitive: false, source: "user" as const })),
  ];
  const context: TaskContext = { kind: "maintenance", unit: home.unit.id, property: home.property.id, owner: home.owner.id, tenancy: home.tenancy.id, photoCount: media.length, stage: "triage" };
  await db.insert(tasks).values({
    id,
    userId: config.user.id,
    title: `Repair at ${home.unit.label}`,
    request: report.trim() || "(no description)",
    source,
    status: "new",
    statusDetail: "Reading the tenant's report",
    facts,
    context,
  });
  if (messageId) await db.update(messages).set({ taskId: id }).where(eq(messages.id, messageId));
  await advance(id);
  return id;
}

async function tenantFollowUp(party: Party, task: TaskRow & { context: TaskContext }, body: string, media: string[]): Promise<boolean> {
  const ctx = task.context;
  if (media.length) {
    const have = task.facts.filter((f) => f.key.startsWith("photo_")).length;
    const photos = media.map((url, i) => ({ key: `photo_${have + i + 1}`, label: `Tenant photo ${have + i + 1}`, value: url, sensitive: false, source: "user" as const }));
    await patchTask(task.id, { facts: [...task.facts, ...photos], context: { ...ctx, photoCount: (ctx.photoCount ?? 0) + media.length } });
    if (!body.trim()) {
      await notifyParty({ party, taskId: task.id, kind: "reply", body: `Got ${media.length === 1 ? "the photo" : "the photos"}, thanks. I'll pass ${media.length === 1 ? "it" : "them"} to the vendor.`, dedupeKey: `photos:${task.id}:${have + media.length}` });
      return true;
    }
  }
  if (ctx.stage === "checking" && (YES.test(body) || NO.test(body))) {
    await closeWorkOrder(task, YES.test(body) && !NO.test(body));
    return true;
  }
  if (ctx.stage === "booked" && !ctx.accessConfirmed && YES.test(body)) {
    await patchTask(task.id, { context: { ...ctx, accessConfirmed: true }, facts: [...task.facts.filter((f) => f.key !== "access_confirmed"), { key: "access_confirmed", label: "Tenant agreed to entry", value: `Yes (${new Date().toISOString()})`, sensitive: false, source: "user" }] });
    const when = ctx.booked?.startsAt ? windowLabel(new Date(ctx.booked.startsAt), ctx.booked.endsAt ? new Date(ctx.booked.endsAt) : null, config.user.timezone) : "then";
    await notifyParty({ party, taskId: task.id, kind: "reply", body: `Thanks ${firstName(party.name)}. They'll be there ${when}.`, dedupeKey: `access-ok:${task.id}` });
    return true;
  }
  if (body.trim()) {
    const notes = task.facts.filter((f) => f.key.startsWith("tenant_note")).length;
    await patchTask(task.id, { facts: [...task.facts, { key: `tenant_note_${notes + 1}`, label: "Tenant added", value: body.trim().slice(0, 500), sensitive: false, source: "user" }] });
    await notifyParty({ party, taskId: task.id, kind: "reply", body: "Thanks, I've added that to the work order.", dedupeKey: `note:${task.id}:${notes + 1}` });
  }
  return true;
}

// ------------------------------------------------------------ triage

/** new → planning: triage the report, check the unit's history and the vendors' records, and pick who to call. */
export async function triage(task: TaskRow & { context: TaskContext }): Promise<boolean> {
  const ctx = task.context;
  const home = homeOf(ctx.tenancy ?? "");
  if (!home) throw new Error("Work order without a tenancy");
  const user = (await getUser(task.userId))!;
  const r = await agent.triageMaintenance({
    now: nowContext(user.timezone),
    report: task.request,
    tenantFirstName: firstName(home.tenancy.tenantName),
    unit: { label: home.unit.label, beds: home.unit.beds, baths: home.unit.baths },
    assets: home.assets.map((a) => ({ type: a.type, installYear: a.installYear })),
    photos: ctx.photoCount ?? 0,
  });
  const tenant = tenantParty(home.tenancy.id)!;
  const asset = assetFor(home.unit.id, r.trade, `${task.request} ${r.problem}`);
  const refs = refsOf({ ...ctx, asset: asset?.id });
  const short = home.unit.label;

  // Emergencies: safety first, then a person. Telo never calls 911 itself.
  if (r.safetyMessage) await notifyParty({ party: tenant, taskId: task.id, kind: "safety", body: r.safetyMessage, dedupeKey: `safety:${task.id}` });
  if (r.emergency !== "none") {
    const lifeSafety = ["gas", "fire", "co"].includes(r.emergency);
    await notify({
      userId: task.userId,
      taskId: task.id,
      kind: "report",
      urgent: true,
      body: `Emergency at ${short}: ${r.problem}. ${lifeSafety ? `I told ${firstName(home.tenancy.tenantName)} to get out and call 911${r.emergency === "gas" ? " and the gas company" : ""}.` : "I'm calling vendors who can come now."}`,
      dedupeKey: `emergency:${task.id}`,
    });
    await recordEvent({
      id: `evt_emerg_${task.id}`,
      userId: task.userId,
      taskId: task.id,
      type: "emergency.routed",
      summary: `Emergency (${r.emergency}) at ${short}: ${lifeSafety ? "tenant told to call 911; manager paged" : "vendors called now; manager paged"}`,
      typed: { emergencyKind: r.emergency, emergencyRoute: lifeSafety ? "tenant_911" : "vendor", secsToHuman: Math.max(1, Math.round((Date.now() - task.createdAt.getTime()) / 1000)) },
      refs,
    });
    if (lifeSafety) {
      await recordWorkOrderOpened(task, r, refs, short);
      await patchTask(task.id, { context: { ...ctx, trade: r.trade, severity: r.severity, jobCode: r.jobCode, problem: r.problem, asset: asset?.id, stage: "closed" } });
      await finalizeTask(task.id, "completed", { outcome: "partial", summary: `Emergency (${r.emergency}): tenant told to leave and call 911; on-call paged.`, confirmation: null }, `Emergency at ${short} is with 911 and you now. Call ${firstName(home.tenancy.tenantName)} when you can.`);
      return false;
    }
  }
  await recordWorkOrderOpened(task, r, refs, short);

  // Memory: the unit's history and the vendors' records decide who gets called and what to ask for.
  const ranking = await rankVendors(r.trade);
  const history = asset ? await assetHistory(asset.id) : null;
  const replace = Boolean(history && shouldQuoteReplacement(history.value));
  const picks = ranking.value.slice(0, 2);
  if (!picks.length) throw new Error(`No approved ${r.trade} vendor in the portfolio`);
  const passedOver = ranking.value.slice(2).filter((s) => s.noShows > 0);
  const lines: string[] = [];
  let historyLine = "";
  if (asset && history?.value.repairs.length) {
    const firstRepair = new Date(history.value.repairs[0].at);
    const nth = history.value.repairs.length + 1;
    historyLine = `This is the ${ordinal(nth)} ${assetLabel(asset.type)} failure at this unit since ${firstRepair.toLocaleString("en-US", { month: "long", timeZone: user.timezone })} (${usd(history.value.totalCents)} in repairs so far; the ${assetLabel(asset.type)} is ${history.value.ageYears} years old).`;
    lines.push(historyLine);
  }
  const names = picks.map((s) => s.vendor.name).join(" and ");
  const vendorLine = passedOver.length
    ? `${passedOver.map((s) => `${s.vendor.name} no-showed ${s.noShows} time${s.noShows === 1 ? "" : "s"} recently`).join("; ")}, so ${names} are called first.`
    : `Calling ${picks.map((s) => `${s.vendor.name} (${record(s)})`).join(" and ")}.`;
  lines.push(vendorLine);
  if (replace) lines.push("Asking for a replacement price too.");
  const memory: MemoryBrief = {
    summary: lines.join(" "),
    events: [
      ...(history?.value.repairs ?? []).map((rep, i) => ({ id: `rep_${i}`, type: "asset.repaired", summary: `Repaired the ${assetLabel(asset!.type)}: ${usd(rep.cents)}`, occurredAt: rep.at })),
      ...ranking.value.map((s) => ({ id: `score_${s.vendor.id}`, type: "vendor.scorecard", summary: `${s.vendor.name}: ${record(s)}`, occurredAt: new Date().toISOString() })),
    ],
    retrievedAt: new Date().toISOString(),
    source: ranking.source === "keewano" || history?.source === "keewano" ? "keewano" : "local",
    trace: [...ranking.trace, ...(history?.trace ?? [])],
  };
  await recordEvent({
    userId: task.userId,
    taskId: task.id,
    type: "memory.retrieved",
    summary: `Remembered: ${memory.summary}`,
    data: { source: memory.source, trace: memory.trace, ranked: ranking.value.map((s) => ({ vendor: s.vendor.name, visits: s.visits, noShows: s.noShows, late: s.late, firstFix: s.firstFix, jobs: s.jobs })) },
  });

  const owner = home.owner;
  const emergency = r.severity === "emergency";
  const limit = emergency ? Math.min(owner.emergencyLimitCents, FIRM.emergencyCapCents) : owner.approvalLimitCents;
  const authority: Authority = {
    allowed: [`Book a visit that costs ${usd(limit)} or less in total`, "Share the unit address, the problem, the photos and the tenant's preferred times", "Book inside the tenant's preferred times, or tonight for urgent work"],
    askFirst: [
      `Any total over ${usd(limit)}: say "one moment" and use ask_customer with the price as a decision (options like "Approve $650" and "Don't approve"); Telo asks the owner by text while they hold`,
      ...(replace ? ["Replacing the unit instead of repairing it (get the price, don't agree)"] : []),
    ],
    never: ["Agree to more than the limit without the owner's OK", "Share the tenant's phone number, a lockbox or gate code, or any payment details", "Sign anything or promise payment terms"],
    spendLimitUsd: limit / 100,
  };
  const trade = r.trade === "hvac" ? "an HVAC" : /^[aeiou]/.test(r.trade) ? `an ${r.trade}` : `a ${r.trade}`;
  const goal = `Get ${trade} visit for ${short}: ${r.problem.replace(/\.$/, "")}. Find out the earliest visit and the total price (trip fee and repair), and book it if it's ${usd(limit)} or less; above that, get the owner's OK while they hold.${replace ? " Also ask what a full replacement would cost." : ""}`;
  const facts: Fact[] = [...task.facts.filter((f) => f.key !== "problem"), { key: "problem", label: "Problem", value: r.problem, sensitive: false, source: "user" }];
  const moved = await transitionTask(
    task.id,
    "planning",
    {
      title: `${r.title} at ${home.unit.label.replace(/^\d+ /, "")}`,
      goal,
      category: "quotes",
      targets: picks.map((s) => ({ name: s.vendor.name, phone: s.vendor.phone, kind: "business" as const })),
      facts,
      constraints: [`Open by saying you're an AI assistant calling for ${config.user.name} at ${FIRM.name}, and that the call is recorded`],
      authority,
      memory,
      context: { ...ctx, trade: r.trade, severity: r.severity, jobCode: r.jobCode, problem: r.problem, issue: r.title, asset: asset?.id, ranked: ranking.value.map((s) => s.vendor.id), replaceQuote: replace, stage: "dispatching" },
      statusDetail: `Calling ${picks.map((s) => s.vendor.name).join(" and ")}`,
    },
    ["new"],
  );
  if (!moved) return false;
  await notifyParty({ party: tenant, taskId: task.id, kind: "reply", body: r.tenantReply, dedupeKey: `triage:${task.id}` });
  await notify({
    userId: task.userId,
    taskId: task.id,
    kind: "update",
    body: [`New work order at ${short}: ${r.title}.`, historyLine, passedOver.length ? `${passedOver.map((s) => `${s.vendor.name} no-showed ${s.noShows} time${s.noShows === 1 ? "" : "s"} lately`).join("; ")}, so I'm calling ${names} instead${replace ? ", and asking for a replacement price too" : ""}.` : `Calling ${names} now${replace ? ", and asking for a replacement price too" : ""}.`].filter(Boolean).join(" "),
    dedupeKey: `wo:${task.id}`,
  });
  return true;
}

function record(s: Scorecard): string {
  if (!s.visits && !s.jobs) return "no history yet";
  return `${s.visits} visit${s.visits === 1 ? "" : "s"}, ${s.noShows} no-show${s.noShows === 1 ? "" : "s"}, ${s.late} late, ${s.firstFix}/${s.jobs} fixed first visit`;
}

function ordinal(n: number): string {
  return ["zeroth", "first", "second", "third", "fourth", "fifth", "sixth"][n] ?? `${n}th`;
}

async function recordWorkOrderOpened(task: TaskRow & { context: TaskContext }, r: TriageResult, refs: EntityRefs, unitLabel: string) {
  const photos = task.context.photoCount ?? 0;
  await recordEvent({
    id: `evt_wo_${task.id}`,
    userId: task.userId,
    taskId: task.id,
    type: "wo.opened",
    summary: `Work order: ${r.problem} at ${unitLabel}`,
    typed: { trade: r.trade, severity: r.severity, intakeChannel: photos ? "mms" : task.source === "voice" ? "call" : "sms", photoCount: photos },
    refs,
    occurredAt: task.createdAt,
  });
}

// ------------------------------------------------------------ the owner, mid-call

/** The owner's open question (Telo asked while a vendor holds), newest first. */
async function openOwnerQuestion(ownerId: string): Promise<QuestionRow | undefined> {
  const open = await db.select().from(questions).where(eq(questions.status, "open")).orderBy(desc(questions.createdAt)).limit(30);
  return open.find((q) => (q.context as { party?: { id?: string } }).party?.id === ownerId);
}

/** Which option a reply picks: "yes", "yes and get a replacement quote", "no"... */
export function pickOption(options: ApprovalOption[], reply: string): ApprovalOption | null {
  const t = reply.toLowerCase();
  const no = options.find((o) => /^(don'?t|do not|no|decline|not now)/i.test(o.label));
  const replace = options.find((o) => /replace/i.test(o.label));
  const yes = options.find((o) => o !== no && o !== replace) ?? options[0];
  if (/\b(no|nope|don'?t|do not|decline|hold off|not now|too much)\b/.test(t) && !/\bno problem\b/.test(t)) return no ?? null;
  if (replace && /replac/.test(t)) return replace;
  if (/\b(yes|yeah|yep|ok|okay|sure|approve[ds]?|go ahead|do it|fine|book it|sounds good)\b/.test(t)) return yes ?? null;
  const exact = options.find((o) => t.includes(o.label.toLowerCase()));
  return exact ?? null;
}

async function ownerText(party: Party, body: string, channel: string, providerMessageId: string | null): Promise<boolean> {
  const q = await openOwnerQuestion(party.id);
  const stored = await storeInbound(party, body, channel, providerMessageId, q?.taskId ?? null);
  if (!stored) return true;
  if (!q) {
    // Owner questions ("how's my property?") are the manager's for now.
    await notify({ userId: config.user.id, kind: "update", body: `${party.name} (owner) texted: "${maskSecrets(body).slice(0, 300)}"`, dedupeKey: `owner-fwd:${stored}` });
    return true;
  }
  const choice = pickOption(q.options, body);
  if (!choice) {
    await notifyParty({ party, taskId: q.taskId, kind: "reply", body: `Sorry, which one? ${q.options.map((o) => o.label).join(", or ")}?` });
    return true;
  }
  await ownerDecides(q, choice, body, party);
  return true;
}

/** Applies the owner's decision to the question a vendor is holding for. */
export async function ownerDecides(q: QuestionRow, choice: ApprovalOption, note: string | null, party: Party): Promise<boolean> {
  const ctx = q.context as { callId?: string; lapsed?: boolean; askedAt?: string; target?: string; amountCents?: number };
  const approve = !/^(don'?t|do not|no|decline|not now)/i.test(choice.label);
  const onLine = !ctx.lapsed && (await callIsLive(ctx.callId));
  const claimed = await db
    .update(questions)
    .set({ status: "answered", answeredAt: new Date(), answer: { optionId: choice.id, approve, note, live: onLine, late: !onLine, by: "owner" } })
    .where(and(eq(questions.id, q.id), eq(questions.status, "open")))
    .returning();
  if (!claimed.length) return false;
  const task = await getTask(q.taskId);
  if (!task) return false;
  const target = ctx.target ?? "the vendor";
  const wantsReplace = /replace/i.test(choice.label);
  await patchTask(task.id, {
    followUp: { reason: "user_decision", userDecision: `${choice.label} (${firstName(party.name)}, the owner, decided ${onLine ? "during" : "after"} the call)`, callback: null },
    ...(isMaintenance(task) ? { context: { ...task.context, replaceQuote: task.context.replaceQuote || wantsReplace } } : {}),
    ...(onLine ? { statusDetail: `On the phone with ${target}` } : {}),
  });
  const seconds = ctx.askedAt ? Math.max(1, Math.round((Date.now() - Date.parse(ctx.askedAt)) / 1000)) : undefined;
  await recordEvent({
    userId: task.userId,
    taskId: task.id,
    callId: ctx.callId ?? null,
    type: approve ? "approval.granted" : "approval.denied",
    summary: `${party.name} (owner) ${approve ? "approved" : "declined"}: ${choice.label}${onLine ? `, while ${target} held` : ""}`,
    typed: { approvalKind: wantsReplace ? "replace" : "repair", amountCents: ctx.amountCents, approvalChannel: "sms", approvalResponseSeconds: seconds, approvalWhileHolding: onLine },
    refs: isMaintenance(task) ? refsOf(task.context) : null,
  });
  await notifyParty({ party, taskId: task.id, kind: "reply", body: onLine ? `Thanks ${firstName(party.name)}. Telling ${target} now.` : `Thanks ${firstName(party.name)}. They'd hung up, so I'll call ${target} back with that.` });
  return true;
}

async function otherText(party: Party, body: string, channel: string, providerMessageId: string | null): Promise<boolean> {
  const stored = await storeInbound(party, body, channel, providerMessageId, null);
  if (!stored) return true;
  await notify({ userId: config.user.id, kind: "update", body: `${party.name} texted: "${maskSecrets(body).slice(0, 300)}"`, dedupeKey: `fwd:${stored}` });
  return true;
}

// ------------------------------------------------------------ after the vendor calls

/** reviewing → scheduled (booked) | needs_approval: record the quotes, book the vendor, notify everyone. */
export async function afterCalls(task: TaskRow & { context: TaskContext }): Promise<boolean> {
  const ctx = task.context;
  const user = (await getUser(task.userId))!;
  const business = (await listCalls(task.id)).filter((c) => c.kind === "business" && c.analysis);
  const answered = await db.select().from(questions).where(and(eq(questions.taskId, task.id), eq(questions.status, "answered")));
  const ownerApproved = (callId: string) =>
    answered.some((q) => (q.context as { callId?: string; party?: unknown }).callId === callId && (q.context as { party?: unknown }).party && (q.answer as { approve?: boolean } | null)?.approve !== false);
  const limitCents = Math.round((task.authority?.spendLimitUsd ?? 500) * 100);

  for (const c of business) {
    const vendor = vendorForCall(c);
    if (!vendor) continue;
    const a = c.analysis!;
    const price = priceOf(c);
    if (price != null) {
      const startsAt = a.booking?.startsAt ? Date.parse(a.booking.startsAt) : NaN;
      await recordEvent({
        id: `evt_quote_${c.id}`,
        userId: task.userId,
        taskId: task.id,
        callId: c.id,
        type: "quote.received",
        summary: `Quote from ${vendor.name}: ${usd(price)}${a.quote?.availability ? `, ${a.quote.availability}` : ""}`,
        typed: { trade: ctx.trade, jobCode: ctx.jobCode, quoteCents: price, tripFeeCents: vendor.tripFeeCents, earliestSlotHours: Number.isNaN(startsAt) ? undefined : Math.max(0, Math.round((startsAt - Date.now()) / 3600_000)) },
        refs: refsOf(ctx, { vendor: vendor.id }),
      });
    } else if (["no_answer", "voicemail", "failed"].includes(a.outcome)) {
      await recordEvent({ id: `evt_declined_${c.id}`, userId: task.userId, taskId: task.id, callId: c.id, type: "vendor.declined", summary: `${vendor.name} didn't answer`, typed: { declineReason: "no_answer" }, refs: refsOf(ctx, { vendor: vendor.id }) });
    }
  }

  // Booked on the call: a time agreed, and within the limit or approved by the owner while they held.
  const booked = business.find((c) => {
    const price = priceOf(c);
    return c.analysis!.booking && ["success", "partial"].includes(c.analysis!.outcome) && (price == null || price <= limitCents || ownerApproved(c.id));
  });
  if (booked) return book(task, booked, ownerApproved(booked.id), user.timezone);

  // The manager picked a vendor from the comparison: call them back to book.
  const decided = task.followUp?.userDecision ?? "";
  const chosen = business.map((c) => vendorForCall(c)).find((v) => v && decided.toLowerCase().includes(firstWord(v.name)));
  if (chosen) {
    const moved = await transitionTask(
      task.id,
      "planning",
      {
        followUp: { reason: "callback", userDecision: decided, callback: { targetName: chosen.name, purpose: "Book the visit you quoted", objective: `Book the visit ${chosen.name} offered for ${getUnit(ctx.unit)?.label}, at the price they quoted, and get the arrival window and a confirmation number.`, talkingPoints: ["The manager approved your quote", "Confirm the arrival window"] } },
        statusDetail: `Calling ${chosen.name} back to book`,
      },
      ["reviewing"],
    );
    return Boolean(moved);
  }

  // Nobody could book on the call: give the manager the comparison.
  const quotes = business.map((c) => ({ c, v: vendorForCall(c), price: priceOf(c) })).filter((x) => x.v && x.price != null);
  const options: ApprovalOption[] = [...quotes.map((x) => ({ id: `book_${x.v!.id}`, label: `Book ${x.v!.name} (${usd(x.price!)})` })), { id: "handle", label: "I'll handle it" }];
  const summary = quotes.length
    ? quotes.map((x) => `${x.v!.name}: ${usd(x.price!)}${x.c.analysis?.quote?.availability ? `, ${x.c.analysis.quote.availability}` : ""}`).join("; ")
    : "neither vendor could take it";
  const id = newId("q");
  await db.update(questions).set({ status: "cancelled" }).where(and(eq(questions.taskId, task.id), eq(questions.status, "open")));
  await db.insert(questions).values({ id, userId: task.userId, taskId: task.id, kind: "approval", prompt: `Which vendor for ${getUnit(ctx.unit)?.label}?`, options, context: {} });
  const moved = await transitionTask(task.id, "needs_approval", { statusDetail: "Waiting on your pick", followUp: null }, ["reviewing"]);
  if (!moved) return false;
  await notify({ userId: task.userId, taskId: task.id, kind: "approval", body: `Quotes for ${getUnit(ctx.unit)?.label}: ${summary}. ${options.map((o) => o.label).join(", or ")}?`, dedupeKey: `q:${id}` });
  return false;
}

const firstWord = (name: string) => name.toLowerCase().split(/\s+/)[0];

/** The total a vendor quoted on a call, in cents. */
function priceOf(c: CallRow): number | null {
  const a = c.analysis;
  const usdPrice = a?.quote?.priceUsd ?? a?.offers.find((o) => o.priceUsd != null)?.priceUsd ?? null;
  return usdPrice == null ? null : Math.round(usdPrice * 100);
}

async function book(task: TaskRow & { context: TaskContext }, call: CallRow, ownerApproved: boolean, tz: string): Promise<boolean> {
  const ctx = task.context;
  const vendor = vendorForCall(call)!;
  const a = call.analysis!;
  const cents = priceOf(call) ?? 0;
  const startsAt = a.booking?.startsAt && !Number.isNaN(Date.parse(a.booking.startsAt)) ? new Date(a.booking.startsAt) : null;
  const endsAt = a.booking?.endsAt && !Number.isNaN(Date.parse(a.booking.endsAt)) ? new Date(a.booking.endsAt) : null;
  const confirmation = a.confirmationNumbers.at(-1) ?? null;
  const unit = getUnit(ctx.unit)!;
  const rank = (ctx.ranked ?? []).indexOf(vendor.id) + 1 || 1;
  const window = startsAt ? windowLabel(startsAt, endsAt, tz) : "soon (they'll confirm the time)";
  const refs = refsOf(ctx, { vendor: vendor.id });

  await recordEvent({ id: `evt_booked_${task.id}`, userId: task.userId, taskId: task.id, callId: call.id, type: "vendor.booked", summary: `Booked ${vendor.name}: ${usd(cents)}, ${window}${confirmation ? ` (confirmation ${confirmation})` : ""}`, typed: { trade: ctx.trade, dispatchRank: rank, bookedCents: cents }, refs });
  await recordEvent({ id: `evt_arrival_${task.id}`, userId: task.userId, taskId: task.id, callId: call.id, type: "commitment.received", summary: `${vendor.name} promised to arrive ${window}`, typed: { commitmentKind: "arrival", dueAt: startsAt?.toISOString() }, refs });

  // The others get a polite no.
  for (const other of (await listCalls(task.id)).filter((c) => c.kind === "business" && c.id !== call.id && c.analysis && !["no_answer", "voicemail", "failed"].includes(c.analysis.outcome))) {
    const v = vendorForCall(other);
    const party = vendorParty(v?.id);
    if (party && v?.id !== vendor.id) await notifyParty({ party, taskId: task.id, kind: "decline", body: `Hi, it's Telo for ${FIRM.name}. Thanks for the quote on ${unit.label}. We've booked another company this time.`, dedupeKey: `decline:${task.id}:${v!.id}` });
  }

  // The tenant: the window and the entry notice. The text and its timestamp are the legal record.
  const tenant = tenantParty(ctx.tenancy)!;
  const hours = startsAt ? Math.max(0, Math.round((startsAt.getTime() - Date.now()) / 3600_000)) : 24;
  const consent = hours < 24; // California: 24 hours' written notice unless the tenant agrees to sooner
  // "AC not cooling" keeps its capitals; "Leak under the sink" reads "leak under the sink".
  const issue = ctx.issue ? ` (${/^[A-Z]{2}/.test(ctx.issue) ? ctx.issue : ctx.issue.charAt(0).toLowerCase() + ctx.issue.slice(1)})` : "";
  const notice = `${vendor.name} is coming ${window} to fix the problem you reported${issue}. This is your notice of entry for the repair at ${unit.label}.${consent ? " That's less than 24 hours away, so reply YES if it's OK for them to come in then." : ""}`;
  await notifyParty({ party: tenant, taskId: task.id, kind: "notice", body: notice, dedupeKey: `notice:${task.id}` });
  await recordEvent({ id: `evt_notice_${task.id}`, userId: task.userId, taskId: task.id, type: "entry_notice.sent", summary: `Entry notice sent to ${firstName(tenant.name)} (${hours} h ahead)`, data: { text: notice, sentAt: new Date().toISOString() }, typed: { noticePurpose: "repair", noticeHours: hours, noticeMethod: "sms" }, refs: refsOf(ctx) });

  const owner = ownerParty(ctx.owner);
  if (owner && ownerApproved) {
    await notifyParty({ party: owner, taskId: task.id, kind: "update", body: `Booked ${vendor.name} for ${unit.label} ${window}, ${usd(cents)}${confirmation ? ` (confirmation ${confirmation})` : ""}.${ctx.replaceQuote ? " The tech will price a replacement too." : ""}`, dedupeKey: `owner-booked:${task.id}` });
  }

  // Parked until the visit: "on the way?" 30 minutes into the window.
  const checkAt = startsAt ? new Date(startsAt.getTime() + 30 * 60_000) : new Date(Date.now() + 2 * 3600_000);
  const moved = await transitionTask(
    task.id,
    "scheduled",
    {
      wakeAt: checkAt,
      followUp: null,
      context: { ...ctx, stage: "booked", booked: { vendor: vendor.id, cents, startsAt: startsAt?.toISOString() ?? null, endsAt: endsAt?.toISOString() ?? null, confirmation, ownerApproved } },
      statusDetail: `${vendor.name} booked ${window}`,
    },
    ["reviewing"],
  );
  if (!moved) return false;
  await notify({
    userId: task.userId,
    taskId: task.id,
    kind: "report",
    body: `Booked ${vendor.name} for ${unit.label} ${window} at ${usd(cents)}${ownerApproved ? `, approved by ${owner ? firstName(owner.name) : "the owner"} while they held` : ""}. ${firstName(tenant.name)} has the time and the entry notice.`,
    dedupeKey: `booked:${task.id}`,
  });
  return false;
}

// ------------------------------------------------------------ follow-up

/** The visit's time has come: "on the way?" to the vendor, "fixed?" to the tenant. */
export async function wake(task: TaskRow & { context: TaskContext }): Promise<boolean> {
  const ctx = task.context;
  const vendor = vendorParty(ctx.booked?.vendor);
  const tenant = tenantParty(ctx.tenancy);
  const unit = getUnit(ctx.unit);
  if (ctx.stage === "booked") {
    if (vendor) await notifyParty({ party: vendor, taskId: task.id, kind: "check", body: `Hi, Telo for ${FIRM.name}: is your tech on the way to ${unit?.label}?`, dedupeKey: `otw:${task.id}` });
    if (tenant) await notifyParty({ party: tenant, taskId: task.id, kind: "check", body: `Hi ${firstName(tenant.name)}, did ${vendor?.name ?? "the vendor"} come and fix it? Reply Y or N.`, dedupeKey: `fixed?:${task.id}` });
    await patchTask(task.id, { context: { ...ctx, stage: "checking" }, wakeAt: new Date(Date.now() + 6 * 3600_000), statusDetail: `Checking with ${tenant ? firstName(tenant.name) : "the tenant"} that it's fixed` }, ["scheduled"]);
    return false;
  }
  if (ctx.stage === "checking") {
    if (tenant) await notifyParty({ party: tenant, taskId: task.id, kind: "check", body: `Just checking: is it fixed? Reply Y or N.`, dedupeKey: `fixed?2:${task.id}` });
    await patchTask(task.id, { wakeAt: new Date(Date.now() + 24 * 3600_000) }, ["scheduled"]);
    return false;
  }
  return false;
}

/** The tenant's answer to "fixed?": close the work order, or send the vendor back. */
export async function closeWorkOrder(task: TaskRow & { context: TaskContext }, fixed: boolean): Promise<void> {
  const ctx = task.context;
  const vendor = getVendor(ctx.booked?.vendor);
  const tenant = tenantParty(ctx.tenancy)!;
  const unit = getUnit(ctx.unit)!;
  if (!fixed) {
    await notifyParty({ party: tenant, taskId: task.id, kind: "reply", body: `Sorry about that. I'm calling ${vendor?.name ?? "the vendor"} back now.`, dedupeKey: `notfixed:${task.id}` });
    const moved = await transitionTask(
      task.id,
      "planning",
      {
        wakeAt: null,
        context: { ...ctx, stage: "dispatching" },
        followUp: { reason: "callback", userDecision: null, callback: { targetName: vendor?.name ?? task.targets[0]?.name ?? "the vendor", purpose: "The repair didn't hold", objective: `The tenant at ${unit.label} says it still isn't fixed. Get the tech back out as soon as possible, under the original job, and get the arrival window.`, talkingPoints: ["The problem is back after the visit", "Ask them to come back under the same job"] } },
        statusDetail: `Not fixed: calling ${vendor?.name ?? "the vendor"} back`,
      },
      ["scheduled"],
    );
    if (moved) kick(task.id);
    return;
  }
  const refs = refsOf(ctx, vendor ? { vendor: vendor.id } : {});
  const cents = ctx.booked?.cents ?? 0;
  await recordEvent({ id: `evt_vo_${task.id}`, userId: task.userId, taskId: task.id, type: "vendor.outcome", summary: `${vendor?.name}: on time`, typed: { vendorOutcome: "on_time", lateMinutes: 0 }, refs });
  await recordEvent({ id: `evt_kept_${task.id}`, userId: task.userId, taskId: task.id, type: "commitment.fulfilled", summary: `${vendor?.name} kept their arrival promise`, typed: { commitmentKind: "arrival", commitmentLateMinutes: 0 }, refs });
  await recordEvent({ id: `evt_access_${task.id}`, userId: task.userId, taskId: task.id, type: "access.outcome", summary: `Access at ${unit.label}: done`, typed: { accessOutcome: "done", reschedules: 0 }, refs: refsOf(ctx) });
  const asset = getAsset(ctx.asset);
  if (asset) {
    const prior = await assetHistory(asset.id);
    const last = prior.value.repairs.at(-1);
    await recordEvent({ id: `evt_repair_${task.id}`, userId: task.userId, taskId: task.id, type: "asset.repaired", summary: `Repaired the ${assetLabel(asset.type)} at ${unit.label}: ${usd(cents)}`, typed: { assetType: asset.type, repairCents: cents, repeatWithin90d: Boolean(last && Date.now() - Date.parse(last.at) < 90 * 86_400_000) }, refs: { asset: asset.id, unit: unit.id, owner: ctx.owner } });
  }
  // How often the manager had to act on this work order: the "after" number next to the seeded "before".
  const touches = (await db.select({ id: messages.id }).from(messages).where(and(eq(messages.taskId, task.id), eq(messages.direction, "in"), isNull(messages.party)))).length;
  await recordEvent({
    id: `evt_done_${task.id}`,
    userId: task.userId,
    taskId: task.id,
    type: "wo.completed",
    summary: `Closed: fixed on the first visit by ${vendor?.name}; ${firstName(tenant.name)} confirmed`,
    typed: { woOutcome: "fixed_first_visit", visits: 1, daysToFix: Math.floor((Date.now() - task.createdAt.getTime()) / 86_400_000), invoiceOverQuotePct: 0, tenantConfirmed: true, managerTouches: touches },
    refs,
  });
  await notifyParty({ party: tenant, taskId: task.id, kind: "reply", body: `Great, glad it's fixed. Text me anytime something comes up.`, dedupeKey: `closed:${task.id}` });
  const owner = ownerParty(ctx.owner);
  if (owner && ctx.booked?.ownerApproved) await notifyParty({ party: owner, taskId: task.id, kind: "update", body: `${unit.label}: ${vendor?.name} fixed it, and the tenant confirmed. Total ${usd(cents)}.`, dedupeKey: `owner-closed:${task.id}` });
  const moved = await transitionTask(task.id, "reviewing", { context: { ...ctx, stage: "closed" }, wakeAt: null, statusDetail: "Closing the work order" }, ["scheduled"]);
  if (!moved) return;
  await finalizeTask(
    task.id,
    "completed",
    { outcome: "success", summary: `${vendor?.name} fixed it; ${firstName(tenant.name)} confirmed. ${usd(cents)}.`, confirmation: ctx.booked?.confirmation ?? null },
    `Closed: ${task.title}. ${vendor?.name} kept their arrival promise and ${firstName(tenant.name)} confirmed it's fixed.${touches === 0 ? " You didn't have to step in." : ""}`,
  );
}

/** Work orders the background loop or a "check now" tap can wake. */
export const WAKEABLE_STAGES: readonly NonNullable<TaskContext["stage"]>[] = ["booked", "checking"];

