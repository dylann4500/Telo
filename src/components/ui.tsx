"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import {
  Ban,
  CalendarClock,
  CircleCheck,
  Hourglass,
  LoaderCircle,
  PhoneCall,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { Modes, TaskStatus } from "@/lib/types";

export type Tone = "live" | "wait" | "work" | "done" | "bad" | "muted";

export const TONE: Record<Tone, string> = {
  live: "bg-live-soft text-live",
  wait: "bg-wait-soft text-wait",
  work: "bg-work-soft text-work",
  done: "bg-done-soft text-done",
  bad: "bg-bad-soft text-bad",
  muted: "bg-surface-2 text-muted",
};

export const STATUS: Record<TaskStatus, { label: string; tone: Tone; icon: LucideIcon }> = {
  new: { label: "Reading your request", tone: "work", icon: LoaderCircle },
  needs_info: { label: "Needs your answer", tone: "wait", icon: Hourglass },
  planning: { label: "Planning the call", tone: "work", icon: LoaderCircle },
  ready: { label: "About to call", tone: "work", icon: LoaderCircle },
  calling: { label: "On the phone", tone: "live", icon: PhoneCall },
  reviewing: { label: "Going over the call", tone: "work", icon: LoaderCircle },
  needs_approval: { label: "Needs your OK", tone: "wait", icon: Hourglass },
  scheduled: { label: "Calling later", tone: "work", icon: CalendarClock },
  completed: { label: "Done", tone: "done", icon: CircleCheck },
  failed: { label: "Stopped", tone: "bad", icon: TriangleAlert },
  cancelled: { label: "Cancelled", tone: "muted", icon: Ban },
};

export function StatusPill({ status, className }: { status: TaskStatus; className?: string }) {
  const s = STATUS[status];
  const Icon = s.icon;
  const spinning = Icon === LoaderCircle;
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap", TONE[s.tone], className)}>
      {status === "calling" ? (
        <span className="live-dot inline-block size-2 rounded-full bg-live" />
      ) : (
        <Icon className={clsx("size-3.5", spinning && "animate-spin")} strokeWidth={2.25} />
      )}
      {s.label}
    </span>
  );
}

export function Chip({ children, tone = "muted", className }: { children: React.ReactNode; tone?: Tone; className?: string }) {
  return <span className={clsx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium", TONE[tone], className)}>{children}</span>;
}

/** Re-renders every second, for live timers. */
export function useNow(active = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime()) / 1000;
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.round(diff / 3600)}h ago`;
  const days = Math.round(diff / 86_400);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function shortTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-2", className)}>
      <span className="relative grid size-8 place-items-center rounded-xl bg-brand text-brand-ink shadow-sm">
        <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
          <path d="M7 10.5v3" />
          <path d="M11 7.5v9" />
          <path d="M15 9.5v5" />
          <path d="M19 11v2" />
          <path d="M3 11.5v1" />
        </svg>
      </span>
      <span className="text-[22px] font-semibold tracking-tight">telo</span>
    </span>
  );
}

const MODE_LABEL: Record<keyof Omit<Modes, "devTools">, { name: string; live: string }> = {
  llm: { name: "Claude", live: "anthropic" },
  voice: { name: "Dial", live: "dial" },
  memory: { name: "Keewano", live: "keewano" },
};

export function ModeChips({ modes }: { modes: Modes }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(Object.keys(MODE_LABEL) as (keyof typeof MODE_LABEL)[]).map((k) => {
        const live = modes[k] === MODE_LABEL[k].live;
        return (
          <span
            key={k}
            title={live ? `${MODE_LABEL[k].name} is connected` : `${MODE_LABEL[k].name} is simulated locally`}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
              live ? "border-transparent bg-live-soft text-live" : "border-line bg-surface text-muted",
            )}
          >
            <span className={clsx("size-1.5 rounded-full", live ? "bg-live" : "bg-faint")} />
            {MODE_LABEL[k].name}
            <span className="opacity-70">{live ? "live" : "simulated"}</span>
          </span>
        );
      })}
    </div>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx("rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.03)]", className)}>{children}</div>;
}

export function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {aside}
    </div>
  );
}

export function formatPhone(e164: string | null): string | null {
  if (!e164) return null;
  const d = e164.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return e164;
}
