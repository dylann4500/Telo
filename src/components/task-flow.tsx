"use client";

import clsx from "clsx";
import { Fragment, useState } from "react";
import {
  Ban,
  BrainCircuit,
  CalendarCheck,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Database,
  ListChecks,
  Mail,
  MessageCircleQuestion,
  MessageSquare,
  Phone,
  PhoneCall,
  Reply,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { EventDTO, FlowStepDTO } from "@/lib/types";
import { Card, SectionTitle, shortTime } from "./ui";

// "How Telo handled it": the task as a flow of steps, one line each, with
// the systems that did the work and what you were told. Full texts open on
// a click; the raw event log is at the bottom for the curious.

const ICON: Record<FlowStepDTO["kind"], LucideIcon> = {
  request: MessageSquare,
  understand: BrainCircuit,
  ask: MessageCircleQuestion,
  answer: Reply,
  memory: Database,
  plan: ListChecks,
  call: Phone,
  schedule: CalendarClock,
  email: Mail,
  calendar: CalendarCheck,
  done: CircleCheck,
  stopped: TriangleAlert,
};

const PHASE: Record<FlowStepDTO["kind"], string> = {
  request: "Asked",
  understand: "Understood",
  ask: "Asked you",
  answer: "You answered",
  memory: "History",
  plan: "Plan",
  call: "Call",
  schedule: "Later",
  email: "Email",
  calendar: "Calendar",
  done: "Done",
  stopped: "Stopped",
};

// Tone → the icon disc and the pipeline pill.
const DISC: Record<FlowStepDTO["tone"], string> = {
  work: "bg-work-soft text-work",
  live: "bg-live-soft text-live",
  wait: "bg-wait-soft text-wait",
  done: "bg-done-soft text-done",
  bad: "bg-bad-soft text-bad",
  muted: "bg-surface-2 text-muted",
};

const SYSTEM: Record<FlowStepDTO["systems"][number], { label: string; dot: string }> = {
  you: { label: "You", dot: "bg-faint" },
  claude: { label: "Claude", dot: "bg-brand" },
  keewano: { label: "Keewano", dot: "bg-work" },
  dial: { label: "Dial", dot: "bg-live" },
  gmail: { label: "Gmail", dot: "bg-bad" },
  calendar: { label: "Calendar", dot: "bg-wait" },
};

const TOLD: Record<FlowStepDTO["told"][number]["how"], string> = {
  text: "Texted you",
  call: "Called you",
  app: "In the app",
  voice: "Told you on the call",
};

/** Consecutive steps of a kind become one pill: "2 calls". */
function phases(steps: FlowStepDTO[]) {
  const out: { kind: FlowStepDTO["kind"]; tone: FlowStepDTO["tone"]; count: number; live: boolean }[] = [];
  for (const s of steps) {
    const last = out.at(-1);
    if (last && last.kind === s.kind) {
      last.count++;
      last.tone = s.tone;
      last.live ||= s.tone === "live";
    } else out.push({ kind: s.kind, tone: s.tone, count: 1, live: s.tone === "live" });
  }
  return out;
}

export function TaskFlow({ steps, events }: { steps: FlowStepDTO[]; events: EventDTO[] }) {
  const [raw, setRaw] = useState(false);
  if (!steps.length) return null;
  const used = [...new Set(steps.flatMap((s) => s.systems))];
  return (
    <Card className="p-4">
      <SectionTitle
        aside={
          <span className="hidden flex-wrap items-center gap-2 text-[11px] text-faint sm:flex">
            {used.map((k) => (
              <span key={k} className="inline-flex items-center gap-1">
                <span className={clsx("size-1.5 rounded-full", SYSTEM[k].dot)} /> {SYSTEM[k].label}
              </span>
            ))}
          </span>
        }
      >
        How Telo handled it
      </SectionTitle>

      {/* The whole task at a glance. */}
      <div className="scroll-thin -mx-1 mb-4 flex flex-wrap items-center gap-y-2 px-1" aria-label="Steps at a glance">
        {phases(steps).map((p, i) => {
          const Icon = p.kind === "call" && p.live ? PhoneCall : ICON[p.kind];
          return (
            <Fragment key={`${p.kind}${i}`}>
              {i > 0 && <ChevronRight className="mx-0.5 size-3.5 shrink-0 text-faint" aria-hidden />}
              <span className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11.5px] font-medium", DISC[p.tone], p.live && "ring-1 ring-live/50")}>
                <Icon className="size-3.5" />
                {p.count > 1 ? `${p.count} ${p.kind === "call" ? "calls" : PHASE[p.kind].toLowerCase()}` : PHASE[p.kind]}
              </span>
            </Fragment>
          );
        })}
      </div>

      <ol className="relative">
        {steps.map((s, i) => (
          <FlowRow key={s.id} step={s} last={i === steps.length - 1} />
        ))}
      </ol>

      {events.length > 0 && (
        <div className="mt-2 border-t border-line pt-3">
          <button onClick={() => setRaw(!raw)} className="inline-flex items-center gap-1 text-[12px] font-medium text-muted hover:text-ink">
            <ChevronDown className={clsx("size-3.5 transition", raw && "rotate-180")} /> Raw events ({events.length})
          </button>
          {raw && (
            <ol className="mt-2 space-y-1.5">
              {events.map((e) => (
                <li key={e.id} className="flex gap-2 text-[12px] leading-snug">
                  <span className="w-14 shrink-0 font-mono text-[11px] text-faint">{shortTime(e.occurredAt)}</span>
                  <span className="w-40 shrink-0 font-mono text-[11px] text-muted">{e.type}</span>
                  <span className="min-w-0 flex-1 text-ink/80">
                    {e.mirrored && <span title={e.synced ? "Sent to Keewano" : e.syncError ?? "Waiting to sync"} className={clsx("mr-1", e.synced ? "text-work" : "text-faint")}>●</span>}
                    {e.summary}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Card>
  );
}

function FlowRow({ step: s, last }: { step: FlowStepDTO; last: boolean }) {
  const [open, setOpen] = useState(false);
  const Icon = s.kind === "call" && s.tone === "live" ? PhoneCall : s.kind === "stopped" && s.title === "Cancelled" ? Ban : ICON[s.kind];
  const expandable = Boolean(s.more || s.told.length || s.children.some((c) => c.detail && c.detail.length > 70));
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!last && <span className="absolute bottom-0 left-[15px] top-9 w-px bg-line" aria-hidden />}
      <span className={clsx("relative z-10 mt-0.5 grid size-8 shrink-0 place-items-center rounded-full", DISC[s.tone], s.tone === "live" && "ring-2 ring-live/40")}>
        <Icon className="size-4" strokeWidth={2.1} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <button
            disabled={!expandable}
            onClick={() => setOpen(!open)}
            className={clsx("min-w-0 text-left text-[14px] font-semibold leading-snug", expandable && "hover:text-brand")}
            aria-expanded={expandable ? open : undefined}
          >
            {s.title}
            {expandable && <ChevronDown className={clsx("ml-1 inline size-3.5 -translate-y-px text-faint transition", open && "rotate-180")} />}
          </button>
          <time className="shrink-0 text-[11px] tabular-nums text-faint">{shortTime(s.at)}</time>
        </div>
        {s.detail && <p className={clsx("mt-0.5 text-[13px] leading-snug text-muted", !open && "line-clamp-2")}>{open && s.more ? s.more : s.detail}</p>}

        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {s.decided && <Tag className="bg-brand-soft text-brand">Claude decided</Tag>}
          {s.badges.map((b) => (
            <Tag key={b} className={/^[A-Z]{1,4}[- ]?\d{3,}/.test(b) ? "bg-done-soft font-mono text-done" : "bg-surface-2 text-muted"}>
              {b}
            </Tag>
          ))}
          {s.systems.map((k) => (
            <Tag key={k} className="border border-line bg-surface text-muted">
              <span className={clsx("size-1.5 rounded-full", SYSTEM[k].dot)} /> {SYSTEM[k].label}
            </Tag>
          ))}
          {s.memory && (
            <Tag className={s.memory.synced ? "bg-work-soft text-work" : "bg-surface-2 text-faint"}>
              {s.memory.synced ? "●" : "○"} {s.memory.where === "keewano" ? (s.memory.synced ? "Saved to Keewano" : "Saving to Keewano") : "Saved to memory"}
            </Tag>
          )}
          {toldChips(s.told).map((t) => (
            <Tag key={t.label} className={t.failed ? "bg-bad-soft text-bad" : "bg-surface-2 text-ink/70"}>
              {t.label}
            </Tag>
          ))}
        </div>

        {s.children.length > 0 && (
          <ul className="mt-2 space-y-1 border-l-2 border-dashed border-line pl-3">
            {s.children.map((c, i) => (
              <li key={i} className="text-[12.5px] leading-snug">
                <span className={clsx("font-medium", c.tone === "wait" ? "text-wait" : c.tone === "done" ? "text-done" : c.tone === "bad" ? "text-bad" : "text-ink/80")}>{c.title}</span>
                {c.detail && <span className={clsx("text-muted", !open && "line-clamp-1")}> · {c.detail}</span>}
              </li>
            ))}
          </ul>
        )}

        {open && s.told.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {s.told.map((t, i) => (
              <p key={i} className="rounded-xl bg-im-gray px-3 py-1.5 text-[13px] leading-snug text-im-gray-ink">
                <span className="mr-1 text-[10.5px] font-semibold uppercase text-im-meta">{TOLD[t.how]}</span>
                {t.body}
              </p>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

/** "Texted you ×2", "Texted you (not delivered)": one chip per way Telo reached you. */
function toldChips(told: FlowStepDTO["told"]) {
  const out = new Map<string, { label: string; failed: boolean; n: number }>();
  for (const t of told) {
    const key = `${t.how}${t.delivered ? "" : "!"}`;
    const prev = out.get(key);
    if (prev) prev.n++;
    else out.set(key, { label: "", failed: !t.delivered, n: 1 });
    const chip = out.get(key)!;
    chip.label = `${TOLD[t.how]}${chip.n > 1 ? ` ×${chip.n}` : ""}${t.delivered ? "" : " (not delivered)"}`;
  }
  return [...out.values()];
}

function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={clsx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium", className)}>{children}</span>;
}
