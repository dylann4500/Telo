"use client";

import clsx from "clsx";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  BrainCircuit,
  ChevronDown,
  CircleDollarSign,
  Database,
  FileText,
  Phone,
  PhoneIncoming,
  ShieldCheck,
} from "lucide-react";
import type { CallDTO, EventDTO, TaskDetailDTO } from "@/lib/types";
import { post, useTask } from "./api";
import { LiveAsk, LiveTranscript, VoiceBars } from "./live-call";
import { Card, Chip, SectionTitle, StatusPill, clock, shortDate, shortTime, timeAgo, useNow } from "./ui";

export function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: task, error, mutate } = useTask(id);
  if (error) return <Shell>Couldn&apos;t load this task.</Shell>;
  if (!task) return <Shell>Loading…</Shell>;
  const done = ["completed", "failed", "cancelled"].includes(task.status);
  const business = task.calls.filter((c) => c.kind === "business");
  const live = business.find((c) => ["queued", "ringing", "in_progress"].includes(c.status));

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-10 sm:px-6">
      <div className="flex items-center justify-between py-4">
        <Link href="/" className="inline-flex items-center gap-1.5 text-[14px] text-muted hover:text-ink">
          <ArrowLeft className="size-4" /> All tasks
        </Link>
        {!done && (
          <button
            onClick={async () => {
              if (!confirm("Stop this task? Telo will hang up any call in progress.")) return;
              await post(`/api/tasks/${task.id}/cancel`);
              void mutate();
            }}
            className="rounded-lg border border-line px-3 py-1.5 text-[13px] text-muted hover:border-bad hover:text-bad"
          >
            Stop task
          </button>
        )}
      </div>

      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{task.title}</h1>
          <StatusPill status={task.status} />
        </div>
        <p className="mt-1.5 text-[14px] text-muted">
          {task.targets.length ? task.targets.join(", ") : "Who to call: still working it out"} · {task.source === "email" ? "suggested from your email" : `asked by ${task.source === "web" ? "chat" : task.source === "voice" ? "phone" : "text"}`} · {timeAgo(task.createdAt)}
        </p>
        <blockquote className="mt-3 max-w-3xl border-l-2 border-brand/50 pl-3 text-[15px] text-ink/85">“{task.request}”</blockquote>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <main className="space-y-5">
          {task.waiting && (task.waiting.live ? <LiveAsk taskId={task.id} question={task.waiting} onDone={() => void mutate()} /> : <Waiting task={task} onDone={() => void mutate()} />)}
          {live && <LivePanel call={live} />}
          {task.status === "scheduled" && <Scheduled task={task} onDone={() => void mutate()} />}
          {task.result && (
            <Card className={clsx("p-4", task.status === "completed" ? "border-done/30" : "border-bad/30")}>
              <SectionTitle>{task.status === "completed" ? "Result" : "Where it stopped"}</SectionTitle>
              <p className="text-[15px] leading-relaxed">{task.result.summary}</p>
              {task.result.confirmation && (
                <p className="mt-2">
                  <Chip tone="done">
                    <BadgeCheck className="size-3" /> Confirmation {task.result.confirmation}
                  </Chip>
                </p>
              )}
            </Card>
          )}
          {task.goal && (
            <Card className="p-4">
              <SectionTitle>What Telo is doing</SectionTitle>
              <p className="text-[15px]">{task.goal}</p>
              {task.plan && <p className="mt-2 text-[14px] text-muted">{task.plan.strategy}</p>}
              {!!task.lastError && task.status !== "completed" && <p className="mt-2 text-[12.5px] text-bad">Last error (retrying): {task.lastError}</p>}
            </Card>
          )}
          <div>
            <SectionTitle aside={<span className="text-[12px] text-faint">{business.length ? `${business.length} total` : null}</span>}>Calls</SectionTitle>
            {business.length ? (
              <div className="space-y-3">
                {business.map((c) => (
                  <CallCard key={c.id} call={c} />
                ))}
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-[14px] text-muted">No calls yet.</p>
            )}
          </div>
          {task.calls.filter((c) => c.kind !== "business").length > 0 && (
            <div>
              <SectionTitle>Calls with you</SectionTitle>
              <div className="space-y-3">
                {task.calls
                  .filter((c) => c.kind !== "business")
                  .map((c) => (
                    <CallCard key={c.id} call={c} />
                  ))}
              </div>
            </div>
          )}
        </main>

        <aside className="space-y-5">
          <MemoryPanel task={task} />
          <Facts task={task} />
          <Rules task={task} />
          <Timeline events={task.events} />
        </aside>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl px-6 py-10 text-muted">{children}</div>;
}

function Scheduled({ task, onDone }: { task: TaskDetailDTO; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Card className="border-work/30 p-4">
      <SectionTitle>Calling later</SectionTitle>
      <p className="text-[15px] leading-relaxed">{task.statusDetail}</p>
      <p className="mt-1 text-[13px] text-muted">Telo calls on its own at that time. You can text it to call now instead.</p>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await post(`/api/tasks/${task.id}/wake`);
          setBusy(false);
          onDone();
        }}
        className="mt-3 rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium hover:border-ink disabled:opacity-50"
      >
        Call now
      </button>
    </Card>
  );
}

function Waiting({ task, onDone }: { task: TaskDetailDTO; onDone: () => void }) {
  const [text, setText] = useState("");
  const q = task.waiting!;
  return (
    <Card className="border-wait/40 bg-wait-soft/40 p-4">
      <SectionTitle>Telo needs you</SectionTitle>
      <p className="text-[15px] leading-relaxed">{q.prompt}</p>
      {q.kind === "approval" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {q.options.map((o) => (
            <button
              key={o.id}
              onClick={async () => {
                await post(`/api/tasks/${task.id}/answer`, { optionId: o.id });
                onDone();
              }}
              className="rounded-full border border-brand/40 bg-surface px-3.5 py-1.5 text-[14px] font-medium text-brand hover:bg-brand hover:text-brand-ink"
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : (
        <form
          className="mt-3 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim()) return;
            await post(`/api/tasks/${task.id}/answer`, { text });
            setText("");
            onDone();
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={q.fields.map((f) => f.label).join(", ")}
            className="flex-1 rounded-xl border border-line bg-surface px-3 py-2 text-[14px] outline-none focus:border-brand"
          />
          <button className="rounded-xl bg-brand px-4 text-[14px] font-medium text-brand-ink">Send</button>
        </form>
      )}
      <p className="mt-2 text-[12px] text-muted">You can also just reply to Telo&apos;s text.</p>
    </Card>
  );
}

function LivePanel({ call }: { call: CallDTO }) {
  const now = useNow(true);
  const elapsed = call.answeredAt ? (now - new Date(call.answeredAt).getTime()) / 1000 : null;
  return (
    <Card className="overflow-hidden border-live/40">
      <div className="flex items-center gap-3 bg-live-soft/60 px-4 py-3">
        <VoiceBars active={call.status === "in_progress"} />
        <div className="flex-1">
          <div className="text-[12px] font-medium uppercase tracking-wide text-live">{call.status === "in_progress" ? "On the phone" : "Dialing"}</div>
          <div className="text-[15px] font-semibold">
            {call.targetName}
            {call.statusDetail && !["Connected", "Ringing"].includes(call.statusDetail) && <span className="font-normal text-muted"> · {call.statusDetail}</span>}
          </div>
        </div>
        {elapsed !== null && <span className="font-mono text-lg tabular-nums text-live">{clock(elapsed)}</span>}
      </div>
      <div className="p-4">
        <LiveTranscript call={call} max={8} />
      </div>
    </Card>
  );
}

const OUTCOME: Record<string, { label: string; tone: "done" | "wait" | "bad" | "work" | "muted" }> = {
  success: { label: "Got it done", tone: "done" },
  partial: { label: "Partly done", tone: "work" },
  needs_user_decision: { label: "Needs your decision", tone: "wait" },
  callback_required: { label: "Calling back", tone: "work" },
  failed: { label: "Didn't work", tone: "bad" },
  no_answer: { label: "No answer", tone: "muted" },
  voicemail: { label: "Voicemail", tone: "muted" },
  wrong_number: { label: "Wrong number", tone: "bad" },
};

function CallCard({ call }: { call: CallDTO }) {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState(false);
  const a = call.analysis;
  const outcome = a ? OUTCOME[a.outcome] : null;
  const inbound = call.kind === "user_inbound";
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
            {inbound ? <PhoneIncoming className="size-4" /> : <Phone className="size-4" />}
          </span>
          <div className="min-w-0">
            <div className="font-semibold">
              {call.targetName}
              {call.attempt > 1 && <span className="font-normal text-muted"> · try {call.attempt}</span>}
            </div>
            <div className="text-[13px] text-muted">{call.purpose}</div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-[12px] text-muted">
          {outcome ? <Chip tone={outcome.tone}>{outcome.label}</Chip> : <Chip tone={call.status === "in_progress" ? "live" : "muted"}>{call.statusDetail ?? call.status}</Chip>}
          <span>
            {call.startedAt ? shortTime(call.startedAt) : "Not placed yet"}
            {call.durationSec ? ` · ${clock(call.durationSec)}` : ""}
          </span>
        </div>
      </div>
      {a && (
        <div className="mt-3 space-y-2">
          <p className="text-[14.5px] leading-relaxed">{a.summary}</p>
          <div className="flex flex-wrap gap-1.5">
            {a.offers.map((o, i) => (
              <Chip key={`o${i}`} tone="wait">
                <CircleDollarSign className="size-3" /> Offer: {o.description}
              </Chip>
            ))}
            {a.commitments.map((c, i) => (
              <Chip key={`c${i}`} tone="work">
                Promised: {c.description}
              </Chip>
            ))}
            {a.priorCommitments.map((p, i) => (
              <Chip key={`p${i}`} tone={p.status === "broken" ? "bad" : "done"}>
                {p.status === "broken" ? "Earlier promise not kept" : "Earlier promise kept"}
                {p.confirmationNumber ? ` (${p.confirmationNumber})` : ""}
              </Chip>
            ))}
            {a.confirmationNumbers.map((n) => (
              <Chip key={n} tone="done">
                <BadgeCheck className="size-3" /> {n}
              </Chip>
            ))}
            {a.repName && <Chip>Rep: {a.repName}</Chip>}
          </div>
        </div>
      )}
      {(call.transcript.length > 0 || call.instructions) && (
        <div className="mt-3 flex flex-wrap gap-3 border-t border-line pt-3 text-[13px]">
          {call.transcript.length > 0 && (
            <button onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 font-medium text-muted hover:text-ink">
              <ChevronDown className={clsx("size-4 transition", open && "rotate-180")} /> Transcript ({call.transcript.length} lines)
            </button>
          )}
          {call.instructions && (
            <button onClick={() => setBrief(!brief)} className="inline-flex items-center gap-1 font-medium text-muted hover:text-ink">
              <FileText className="size-4" /> What Telo was told
            </button>
          )}
        </div>
      )}
      {open && (
        <div className="mt-3 space-y-2">
          {call.transcript.map((t, i) => (
            <div key={i} className={clsx("flex", t.speaker === "agent" ? "justify-start" : "justify-end")}>
              <p className={clsx("max-w-[85%] rounded-2xl px-3 py-1.5 text-[13.5px] leading-snug", t.speaker === "agent" ? "bg-brand-soft" : "bg-surface-2")}>
                <span className={clsx("mr-1.5 text-[10.5px] font-semibold uppercase", t.speaker === "agent" ? "text-brand" : "text-muted")}>
                  {t.speaker === "agent" ? "Telo" : inbound || call.kind === "user_update" ? "You" : call.targetName}
                </span>
                {t.text}
              </p>
            </div>
          ))}
        </div>
      )}
      {brief && call.instructions && (
        <pre className="scroll-thin mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-surface-2 p-3 font-mono text-[12px] leading-relaxed text-ink/80">{call.instructions}</pre>
      )}
    </Card>
  );
}

function MemoryPanel({ task }: { task: TaskDetailDTO }) {
  const m = task.memory;
  const keewano = m?.source === "keewano";
  return (
    <Card className="p-4">
      <SectionTitle
        aside={
          m && (
            <Chip tone={keewano ? "live" : "muted"}>
              <Database className="size-3" /> {keewano ? "Keewano" : "Local memory"}
            </Chip>
          )
        }
      >
        <span className="inline-flex items-center gap-1.5">
          <BrainCircuit className="size-3.5" /> What Telo remembered
        </span>
      </SectionTitle>
      {!m ? (
        <p className="text-[13.5px] text-muted">Telo checks its history with the business right before planning the call.</p>
      ) : m.summary ? (
        <>
          <p className="text-[14px] leading-relaxed">{m.summary}</p>
          {m.events.length > 0 && (
            <ul className="mt-3 space-y-1.5 border-l border-line pl-3">
              {m.events.map((e) => (
                <li key={e.id} className="text-[12.5px] leading-snug">
                  <span className="font-medium text-muted">{shortDate(e.occurredAt)}</span> · {e.summary}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="text-[13.5px] text-muted">No earlier history with {task.targets.join(", ") || "this business"}. This call starts the record.</p>
      )}
      {m?.trace.map((t, i) => (
        <div key={i} className="mt-3 rounded-lg bg-surface-2 px-2.5 py-2">
          <div className="flex justify-between text-[11px] text-faint">
            <span>{t.via === "keewano-sql" ? "Live Keewano query" : t.via === "local" ? "Local" : t.via}</span>
            <span>
              {t.rows} rows · {t.ms} ms
            </span>
          </div>
          <code className="mt-1 block break-all font-mono text-[11px] leading-relaxed text-ink/70">{t.request}</code>
        </div>
      ))}
    </Card>
  );
}

const SOURCE: Record<string, string> = { user: "you told Telo", call: "learned on a call", memory: "from history", profile: "your profile" };

function Facts({ task }: { task: TaskDetailDTO }) {
  if (!task.facts.length && !task.constraints.length) return null;
  return (
    <Card className="p-4">
      <SectionTitle>What Telo knows</SectionTitle>
      <dl className="space-y-2">
        {task.facts.map((f) => (
          <div key={f.key}>
            <dt className="text-[12px] text-muted">
              {f.label} <span className="text-faint">· {SOURCE[f.source] ?? f.source}</span>
            </dt>
            <dd className={clsx("text-[14px]", f.sensitive && "font-mono")}>{f.value}</dd>
          </div>
        ))}
        {task.constraints.map((c) => (
          <div key={c}>
            <dt className="text-[12px] text-muted">Constraint</dt>
            <dd className="text-[14px]">{c}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function Rules({ task }: { task: TaskDetailDTO }) {
  const a = task.authority;
  if (!a) return null;
  return (
    <Card className="p-4">
      <SectionTitle>
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="size-3.5" /> Ground rules for the call
        </span>
      </SectionTitle>
      <RuleList title="Telo can" items={a.allowed} tone="text-done" />
      <RuleList title="Asks you first" items={[...a.askFirst, ...(a.spendLimitUsd != null ? [`Spending over $${a.spendLimitUsd}`] : [])]} tone="text-wait" />
      <RuleList title="Never" items={a.never} tone="text-bad" />
    </Card>
  );
}

function RuleList({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  if (!items.length) return null;
  return (
    <div className="mt-2 first:mt-0">
      <div className={clsx("text-[12px] font-semibold", tone)}>{title}</div>
      <ul className="mt-1 space-y-0.5 text-[13px] text-ink/85">
        {items.map((i) => (
          <li key={i}>· {i}</li>
        ))}
      </ul>
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  "task.created": "Task created",
  "task.info_requested": "Asked you",
  "task.info_received": "You answered",
  "task.plan_generated": "Plan ready",
  "memory.retrieved": "Checked history",
  "call.started": "Call placed",
  "call.connected": "Connected",
  "call.completed": "Call ended",
  "call.failed": "Call failed",
  "call.transcript_processed": "Read the call",
  "business.fact_discovered": "Learned",
  "offer.received": "Offer",
  "offer.accepted": "Offer accepted",
  "offer.declined": "Offer declined",
  "commitment.received": "Promise",
  "commitment.fulfilled": "Promise kept",
  "commitment.broken": "Promise broken",
  "confirmation.received": "Confirmation",
  "approval.requested": "Needs your OK",
  "approval.granted": "You approved",
  "approval.denied": "You declined",
  "followup.required": "Follow-up",
  "task.completed": "Done",
  "task.failed": "Stopped",
  "task.cancelled": "Cancelled",
  "message.sent": "Told you",
  "preference.saved": "Preference saved",
};

function Timeline({ events }: { events: EventDTO[] }) {
  const shown = events.filter((e) => e.type !== "message.sent");
  if (!shown.length) return null;
  return (
    <Card className="p-4">
      <SectionTitle aside={<span className="text-[11px] text-faint">● sent to Keewano</span>}>Timeline</SectionTitle>
      <ol className="relative space-y-3 border-l border-line pl-4">
        {shown.map((e) => (
          <li key={e.id} className="relative">
            <span
              className={clsx(
                "absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-surface",
                e.type.startsWith("commitment.broken") ? "bg-bad" : e.type.startsWith("call.") ? "bg-live" : e.type.includes("approval") ? "bg-wait" : "bg-faint",
              )}
            />
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12px] font-semibold text-muted">{EVENT_LABEL[e.type] ?? e.type}</span>
              <span className="shrink-0 text-[11px] text-faint">
                {e.mirrored && <span title={e.synced ? "Mirrored to memory" : e.syncError ?? "Waiting to sync"} className={clsx("mr-1", e.synced ? "text-live" : "text-faint")}>●</span>}
                {shortTime(e.occurredAt)}
              </span>
            </div>
            <p className="text-[13px] leading-snug text-ink/85">{e.summary}</p>
          </li>
        ))}
      </ol>
    </Card>
  );
}
