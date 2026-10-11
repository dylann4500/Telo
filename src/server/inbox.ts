import { eq } from "drizzle-orm";
import * as agent from "./agent";
import type { ReadEmailResult } from "./agent/schemas";
import { config } from "./config";
import { db } from "./db/client";
import { appState, emails, organizations, questions, tasks, type UserRow } from "./db/schema";
import { newId, orgKeyFor } from "./ids";
import { getMail } from "./mail";
import { domainOf, type MailMessage } from "./mail/provider";
import { recordEvent } from "./memory/events";
import { notify } from "./notify";
import { normalizePhone, onEmailForTask } from "./orchestrator";
import { maskSecrets } from "./redact";
import { getUser, listActiveTasks, listOrganizations } from "./tasks/repo";
import { localIso, nowContext, withinCallingHours } from "./time";

// Telo reads the user's inbox (read-only) for mail from businesses: receipts,
// refunds, confirmations, bills, problems. What it learns is remembered like
// anything learned on a call. An email can finish a task Telo was waiting on,
// or lead Telo to offer a call. Only typed facts reach Keewano, and bodies
// are never stored.

const g = globalThis as unknown as { __teloMailPolling?: boolean; __teloMailRetries?: Map<string, number> };
const retries = (g.__teloMailRetries ??= new Map());

/** Reads new inbox mail. Each message is handled once (a failure is retried twice). */
export async function pollInbox(): Promise<number> {
  const mail = getMail();
  if (!mail || g.__teloMailPolling) return 0;
  g.__teloMailPolling = true;
  let handled = 0;
  try {
    const user = await getUser(config.user.id);
    if (!user) return 0;
    const ids = await mail.recent(config.mail.lookbackDays, 20);
    // First poll of a real inbox: what's already there counts as seen, so
    // connecting doesn't send old mail to Claude or write it to memory.
    if (mail.name === "gmail" && !config.mail.readBacklog && !(await db.query.appState.findFirst({ where: eq(appState.key, "mail.baseline") }))) {
      for (const id of ids) await db.insert(emails).values({ id, userId: user.id, provider: mail.name, status: "skipped" }).onConflictDoNothing();
      await db.insert(appState).values({ key: "mail.baseline", value: new Date().toISOString() }).onConflictDoNothing();
      console.info(`[inbox] connected: ${ids.length} messages already in the inbox marked as seen; reading new mail from now on`);
      return 0;
    }
    for (const id of ids.reverse()) {
      const claimed = await db.insert(emails).values({ id, userId: user.id, provider: mail.name, status: "new" }).onConflictDoNothing().returning();
      if (!claimed.length) continue; // seen before
      try {
        await handleEmail(user, await mail.get(id));
        handled++;
      } catch (err) {
        const tries = (retries.get(id) ?? 0) + 1;
        retries.set(id, tries);
        console.error(`[inbox] couldn't read ${id} (${tries}x)`, err);
        if (tries < 3) await db.delete(emails).where(eq(emails.id, id)); // try again on the next poll
        else await db.update(emails).set({ status: "failed", error: (err as Error).message.slice(0, 300) }).where(eq(emails.id, id));
      }
    }
  } finally {
    g.__teloMailPolling = false;
  }
  return handled;
}

function prettyPhone(e164: string): string {
  const d = e164.replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
}

export async function handleEmail(user: UserRow, msg: MailMessage): Promise<void> {
  const tz = user.timezone;
  const active = await listActiveTasks(user.id);
  const read = await agent.readEmail({
    now: nowContext(tz),
    email: {
      from: msg.from,
      fromName: msg.fromName,
      subject: maskSecrets(msg.subject),
      receivedAt: localIso(msg.receivedAt, tz),
      text: maskSecrets(msg.text).slice(0, 6000),
    },
    directory: (await listOrganizations()).map((o) => o.name),
    openTasks: active.map((t) => ({ id: t.id, title: t.title, status: t.status, statusDetail: t.statusDetail, businesses: t.targets.map((x) => x.name) })),
  });
  const fromDomain = domainOf(msg.from);
  if (!read.relevant) {
    // Personal mail, newsletters, codes: nothing kept but the fact it was looked at.
    await db.update(emails).set({ status: "ignored", fromDomain, receivedAt: msg.receivedAt }).where(eq(emails.id, msg.id));
    return;
  }
  const business = (read.business ?? msg.fromName ?? fromDomain).trim().slice(0, 80);
  const orgKey = orgKeyFor(business) || null;
  const task = read.taskId ? active.find((t) => t.id === read.taskId) : undefined; // only ids we gave it
  const amountCents = read.amountUsd != null ? Math.round(read.amountUsd * 100) : null;
  const summary = maskSecrets(read.summary).trim();
  await db
    .update(emails)
    .set({
      status: "processed",
      fromDomain,
      receivedAt: msg.receivedAt,
      subject: maskSecrets(msg.subject).slice(0, 200),
      business,
      orgKey,
      kind: read.kind,
      summary,
      amountCents,
      confirmationNumber: read.confirmationNumber,
      taskId: task?.id ?? null,
      needsCall: read.needsCall,
    })
    .where(eq(emails.id, msg.id));
  if (orgKey) await db.insert(organizations).values({ key: orgKey, name: business }).onConflictDoNothing();
  await recordEvent({
    id: `evt_email_${msg.id}`,
    userId: user.id,
    taskId: task?.id ?? null,
    orgKey,
    type: "email.received",
    summary: `${business} emailed: ${summary}`,
    data: { kind: read.kind, from: fromDomain },
    typed: { emailKind: read.kind, amountCents: amountCents ?? undefined, confirmationNumber: read.confirmationNumber ?? undefined },
    occurredAt: msg.receivedAt,
  });

  // What a scheduled task was waiting for: finish it without the call.
  // A work order's follow-up belongs to the tenant's "fixed?", never to an email.
  if (task && read.settlesTask && task.status === "scheduled" && task.context?.kind !== "maintenance" && (await onEmailForTask(task.id))) return;
  // Something to call about, and no task on it yet: offer the call.
  if (read.needsCall && !task) return suggestCall(user, msg, read, business, orgKey, summary);
  // Otherwise a quiet note in the dashboard thread; no text to the phone.
  const conf = read.confirmationNumber && !summary.includes(read.confirmationNumber) ? ` (${read.confirmationNumber})` : "";
  await notify({
    userId: user.id,
    taskId: task?.id ?? null,
    kind: "email",
    channel: "web",
    body: `${business} emailed: ${summary.replace(/\.$/, "")}${conf}. Saved to your history.`,
    dedupeKey: `email:${msg.id}`,
  });
}

/** A task waiting on the user's OK, created from an email. Saying yes starts it like any request. */
async function suggestCall(user: UserRow, msg: MailMessage, read: ReadEmailResult, business: string, orgKey: string | null, summary: string) {
  const taskId = newId("tsk");
  const day = msg.receivedAt.toLocaleDateString("en-US", { timeZone: user.timezone, month: "short", day: "numeric" });
  const ask = (read.callReason ?? `Call ${business} about their email`).trim();
  // The email's number is dialed only if the user says yes to a question that
  // shows it. In demo mode every business rings the stand-in phone, so a real
  // number from an email is never offered.
  const phone = read.phone && !config.demo.targetPhone ? normalizePhone(read.phone) : null;
  await db.insert(tasks).values({
    id: taskId,
    userId: user.id,
    title: ask.length > 60 ? `${ask.slice(0, 57)}...` : ask,
    request: maskSecrets(`${ask.replace(/\.$/, "")}. Their email on ${day} said: ${summary}`),
    source: "email",
    status: "needs_approval",
    statusDetail: "Waiting on your OK",
    orgKey,
    targets: [{ name: business, phone: null, kind: "business" }],
  });
  await db.update(emails).set({ taskId }).where(eq(emails.id, msg.id));
  const prompt = `${business} emailed: ${summary.replace(/\.$/, "")}. Want me to call them${phone ? ` at ${prettyPhone(phone)}` : ""}?`;
  const questionId = newId("q");
  const awake = withinCallingHours(new Date(), user.timezone);
  await db.insert(questions).values({
    id: questionId,
    userId: user.id,
    taskId,
    kind: "approval",
    prompt,
    fields: [],
    options: [
      { id: "call", label: "Call them" },
      { id: "skip", label: "No thanks" },
    ],
    // deferred: found at night; the background loop texts it once in the morning.
    context: { emailId: msg.id, phone, suggestion: true, deferred: !awake },
  });
  await recordEvent({ userId: user.id, taskId, orgKey, type: "approval.requested", summary: `Asked you: call ${business} about their email?`, typed: { approvalKind: "email_followup" } });
  // During the day: a text (and a call, with calls on). At night it waits on
  // the dashboard until the morning text; overnight finds never ring the phone.
  await notify({
    userId: user.id,
    taskId,
    kind: "approval",
    body: prompt,
    dedupeKey: `q:${questionId}`,
    channel: awake ? undefined : "web",
  });
}
