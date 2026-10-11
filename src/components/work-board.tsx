"use client";

import clsx from "clsx";
import Link from "next/link";
import {
  AirVent,
  BrainCircuit,
  Bug,
  Camera,
  CircleCheck,
  Droplets,
  House,
  KeyRound,
  LayoutGrid,
  LoaderCircle,
  PaintRoller,
  Refrigerator,
  Siren,
  Sparkles,
  Trees,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { CallDTO, StateDTO, TaskSummaryDTO, WorkOrderStage } from "@/lib/types";
import { useTask } from "./api";
import { LiveAsk, LiveTranscript, VoiceBars } from "./live-call";
import { clock, timeAgo, useNow } from "./ui";

// The manager's view of the whole portfolio: what's open, what's on the phone
// right now, who Telo is waiting on, and what's booked. Built to stay calm
// with dozens of work orders running at once: compact cards, one board.

export const TRADE_ICON: Record<string, LucideIcon> = {
  hvac: AirVent,
  plumbing: Droplets,
  electrical: Zap,
  appliance: Refrigerator,
  locks: KeyRound,
  roof: House,
  pest: Bug,
  landscape: Trees,
  cleaning: Sparkles,
  paint: PaintRoller,
  flooring: LayoutGrid,
  general: Wrench,
};

export const STAGE: Record<WorkOrderStage, { label: string; tone: string; dot: string }> = {
  triage: { label: "Reading the report", tone: "bg-work-soft text-work", dot: "bg-work" },
  calling: { label: "Calling vendors", tone: "bg-live-soft text-live", dot: "bg-live" },
  waiting: { label: "Waiting on someone", tone: "bg-wait-soft text-wait", dot: "bg-wait" },
  booked: { label: "Vendor booked", tone: "bg-work-soft text-work", dot: "bg-work" },
  checking: { label: "Checking it's fixed", tone: "bg-work-soft text-work", dot: "bg-work" },
  done: { label: "Closed", tone: "bg-done-soft text-done", dot: "bg-done" },
};

const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

export function StagePill({ stage, className }: { stage: WorkOrderStage; className?: string }) {
  const s = STAGE[stage];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium", s.tone, className)}>
      {stage === "calling" ? <span className="live-dot size-2 rounded-full bg-live" /> : stage === "triage" ? <LoaderCircle className="size-3.5 animate-spin" /> : <span className={clsx("size-1.5 rounded-full", s.dot)} />}
      {s.label}
    </span>
  );
}

// ---------------------------------------------------------------- numbers

export function KpiRow({ tasks, metrics }: { tasks: TaskSummaryDTO[]; metrics: StateDTO["metrics"] | undefined }) {
  const orders = tasks.filter((t) => t.workOrder);
  const open = orders.filter((t) => t.workOrder!.stage !== "done");
  const onPhone = open.filter((t) => t.live).length;
  const waiting = open.filter((t) => t.workOrder!.waitingOn).length;
  const booked = open.filter((t) => ["booked", "checking"].includes(t.workOrder!.stage)).length;
  const before = metrics?.before;
  const after = metrics?.after;
  return (
    <div className="@container">
    <div className="grid grid-cols-2 gap-2.5 @2xl:grid-cols-5">
      <Kpi label="Open work orders" value={open.length} />
      <Kpi label="On the phone now" value={onPhone} tone={onPhone ? "live" : undefined} />
      <Kpi label="Waiting on someone" value={waiting} tone={waiting ? "wait" : undefined} />
      <Kpi label="Visits booked" value={booked} />
      <div className="col-span-2 rounded-2xl border border-line bg-surface px-4 py-3 @2xl:col-span-1" title="Average times the manager had to act per closed work order. Before: the portfolio's seeded history. With Telo: work orders Telo ran.">
        <div className="text-[11.5px] text-muted">Manager touches per job</div>
        <div className="mt-0.5 flex items-baseline gap-1.5 tabular-nums">
          <span className="text-[22px] font-semibold text-faint line-through decoration-1">{before ? before.touches : "–"}</span>
          <span className="text-faint">→</span>
          <span className="text-[22px] font-semibold text-done">{after ? after.touches : "–"}</span>
        </div>
        <div className="text-[10.5px] text-faint">{before ? `before Telo (seeded, ${before.workOrders} jobs)` : "no history yet"}{after ? ` · with Telo (${after.workOrders})` : ""}</div>
      </div>
    </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "live" | "wait" }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className={clsx("mt-0.5 text-[26px] font-semibold tabular-nums leading-tight", tone === "live" ? "text-live" : tone === "wait" ? "text-wait" : "")}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------- live calls

/** Every call Telo is on right now, side by side: parallel vendor calls show up as parallel tiles. */
export function LiveStrip({ tasks }: { tasks: TaskSummaryDTO[] }) {
  const live = tasks.filter((t) => t.live);
  if (!live.length) return null;
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 px-1 text-[12px] font-semibold uppercase tracking-wide text-live">
        <span className="live-dot size-2 rounded-full bg-live" /> On the phone now
      </h2>
      <div className="grid gap-3 lg:grid-cols-2">
        {live.map((t) => (
          <TaskLiveCalls key={t.id} task={t} />
        ))}
      </div>
    </section>
  );
}

function TaskLiveCalls({ task }: { task: TaskSummaryDTO }) {
  const { data } = useTask(task.id);
  const calls = (data?.calls ?? []).filter((c) => c.kind === "business" && ["queued", "ringing", "in_progress"].includes(c.status));
  if (!calls.length) return <LiveTile task={task} call={undefined} target={task.live?.target ?? "the business"} />;
  return (
    <>
      {calls.map((c) => (
        <LiveTile key={c.id} task={task} call={c} target={c.targetName} />
      ))}
    </>
  );
}

function LiveTile({ task, call, target }: { task: TaskSummaryDTO; call: CallDTO | undefined; target: string }) {
  const now = useNow(true);
  const since = call?.answeredAt ?? (task.live?.target === target ? task.live?.answeredAt : null);
  const elapsed = since ? (now - new Date(since).getTime()) / 1000 : null;
  const asking = task.waiting?.live && task.waiting.live.target === target ? task.waiting : null;
  const w = task.workOrder;
  const ringing = call ? call.status !== "in_progress" : task.live?.status !== "in_progress";
  return (
    <div className={clsx("rise overflow-hidden rounded-2xl border bg-surface shadow-sm", asking ? "border-wait/50" : "border-live/30")}>
      <div className={clsx("flex items-center gap-3 border-b border-line px-4 py-2.5", asking ? "bg-wait-soft/60" : "bg-live-soft/60")}>
        <VoiceBars active={!ringing} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14.5px] font-semibold">{target}</div>
          <Link href={`/tasks/${task.id}`} className="block truncate text-[12px] text-muted hover:text-ink">
            {w ? `${w.unit} · ${w.issue ?? task.title}` : task.title}
          </Link>
        </div>
        <span className="font-mono text-[13px] tabular-nums text-live">{ringing ? "ringing" : elapsed !== null ? clock(elapsed) : ""}</span>
      </div>
      <div className="px-4 py-3">
        {asking && (
          <div className="mb-3">
            <LiveAsk taskId={task.id} question={asking} />
          </div>
        )}
        <LiveTranscript call={call} max={3} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the board

const COLUMNS: { key: string; label: string; stages: WorkOrderStage[]; empty: string }[] = [
  { key: "new", label: "New & calling", stages: ["triage", "calling"], empty: "No new reports" },
  { key: "waiting", label: "Waiting on someone", stages: ["waiting"], empty: "Nobody's holding" },
  { key: "booked", label: "Booked", stages: ["booked"], empty: "No visits booked" },
  { key: "follow", label: "Follow-up", stages: ["checking"], empty: "Nothing to check" },
];

export function Board({ tasks }: { tasks: TaskSummaryDTO[] }) {
  const orders = tasks.filter((t) => t.workOrder);
  const done = orders.filter((t) => t.workOrder!.stage === "done").slice(0, 8);
  return (
    <section className="@container">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Work orders</h2>
        <span className="text-[12px] text-faint">{orders.length - done.length} open</span>
      </div>
      <div className="grid gap-2.5 @lg:grid-cols-2 @4xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const cards = orders.filter((t) => col.stages.includes(t.workOrder!.stage));
          return (
            <div key={col.key} className="flex min-h-[132px] flex-col rounded-2xl border border-line bg-surface-2 p-2">
              <div className="mb-2 flex items-center gap-2 px-1.5 pt-0.5">
                <span className={clsx("size-2 rounded-full", STAGE[col.stages[col.stages.length - 1]].dot)} />
                <span className="text-[12.5px] font-semibold">{col.label}</span>
                <span className="ml-auto rounded-full bg-surface px-1.5 text-[11px] tabular-nums text-muted">{cards.length}</span>
              </div>
              <div className="flex flex-1 flex-col gap-2">
                {cards.length ? cards.map((t) => <WorkOrderCard key={t.id} task={t} />) : <p className="m-auto py-4 text-[12px] text-faint">{col.empty}</p>}
              </div>
            </div>
          );
        })}
      </div>
      {done.length > 0 && (
        <div className="mt-3 rounded-2xl border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-4 py-2 text-[12px] text-muted">
            <span className="font-semibold uppercase tracking-wide">Recently closed</span>
            <span className="text-faint">{done.length}</span>
          </div>
          <ul className="divide-y divide-line">
            {done.map((t) => {
              const w = t.workOrder!;
              const Icon = TRADE_ICON[w.trade ?? "general"] ?? Wrench;
              return (
                <li key={t.id}>
                  <Link href={`/tasks/${t.id}`} className="flex items-center gap-3 px-4 py-2 text-[13px] hover:bg-surface-2">
                    <CircleCheck className={clsx("size-4 shrink-0", t.status === "completed" ? "text-done" : "text-faint")} />
                    <Icon className="size-3.5 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{w.unit}</span>
                      <span className="text-muted"> · {t.result?.summary ?? w.issue ?? t.title}</span>
                    </span>
                    <span className="shrink-0 text-[11.5px] text-faint">{timeAgo(t.updatedAt)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

export function WorkOrderCard({ task }: { task: TaskSummaryDTO }) {
  const w = task.workOrder!;
  const now = useNow(Boolean(task.live));
  const Icon = w.emergency ? Siren : (TRADE_ICON[w.trade ?? "general"] ?? Wrench);
  return (
    <Link
      href={`/tasks/${task.id}`}
      className={clsx(
        "rise block rounded-xl border bg-surface p-2.5 transition hover:-translate-y-px hover:shadow-md",
        w.emergency ? "border-bad/50" : w.waitingOn ? "border-wait/40" : task.live ? "border-live/40" : "border-line",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className={clsx("mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg", w.emergency ? "bg-bad-soft text-bad" : "bg-surface-2 text-ink/70")}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-snug">{w.unit}</div>
          <div className="truncate text-[12.5px] text-muted">{w.issue ?? task.title}</div>
        </div>
        <span className="shrink-0 pt-0.5 text-[10.5px] text-faint">{timeAgo(task.updatedAt, now)}</span>
      </div>
      <StageLine task={task} />
      {(w.photos > 0 || w.ranked.length > 0 || w.replaceQuote) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {w.photos > 0 && (
            <Tag>
              <Camera className="size-3" /> {w.photos}
            </Tag>
          )}
          {w.ranked.length > 0 && (
            <Tag tone="work">
              <BrainCircuit className="size-3" /> Keewano-ranked
            </Tag>
          )}
          {w.replaceQuote && <Tag tone="wait">Replacement quote</Tag>}
        </div>
      )}
    </Link>
  );
}

function StageLine({ task }: { task: TaskSummaryDTO }) {
  const w = task.workOrder!;
  const line = "mt-2 rounded-lg px-2 py-1.5 text-[12px] leading-snug";
  switch (w.stage) {
    case "triage":
      return <p className={clsx(line, "bg-work-soft/60 text-work")}>Reading {w.tenant ? `${w.tenant}'s` : "the"} report</p>;
    case "calling":
      return (
        <p className={clsx(line, "bg-live-soft/70 text-live")}>
          <span className="live-dot mr-1.5 inline-block size-1.5 -translate-y-px rounded-full bg-live" />
          {task.live ? "On the phone with " : "Calling "}
          {w.vendors.join(" and ")}
        </p>
      );
    case "waiting":
      return (
        <div className={clsx(line, "bg-wait-soft text-wait")}>
          <div className="font-medium">{w.waitingOn?.role === "owner" ? `${w.waitingOn.name} (owner) is deciding${task.live ? " while the vendor holds" : ""}` : "Needs your answer"}</div>
          {task.waiting?.prompt && <div className="mt-0.5 line-clamp-2 opacity-90">{task.waiting.prompt}</div>}
        </div>
      );
    case "booked":
      return (
        <div className={clsx(line, "bg-surface-2 text-ink/80")}>
          <div>
            <span className="font-medium">{w.booked?.vendor}</span>
            {w.booked?.window ? ` · ${w.booked.window}` : ""}
            {w.booked ? ` · ${usd(w.booked.cents)}` : ""}
          </div>
          <div className="text-[11px] text-muted">
            {w.booked?.ownerApproved ? "Owner approved · " : ""}
            {w.waitingOn?.role === "tenant" ? `Waiting on ${w.waitingOn.name}'s OK to enter` : "Entry notice sent"}
          </div>
        </div>
      );
    case "checking":
      return <p className={clsx(line, "bg-surface-2 text-ink/80")}>Asked {w.tenant ?? "the tenant"} if it&apos;s fixed</p>;
    case "done":
      return <p className={clsx(line, "bg-done-soft/60 text-done")}>{task.result?.summary ?? "Closed"}</p>;
  }
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: "work" | "wait" }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium", tone === "work" ? "bg-work-soft text-work" : tone === "wait" ? "bg-wait-soft text-wait" : "bg-surface-2 text-muted")}>
      {children}
    </span>
  );
}
