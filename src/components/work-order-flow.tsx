"use client";

import clsx from "clsx";
import { Fragment } from "react";
import { BrainCircuit, CalendarCheck, CircleCheck, ClipboardCheck, MessageSquareText, PhoneCall, Siren, UserRound, Wrench, type LucideIcon } from "lucide-react";
import type { CallDTO, TaskDetailDTO } from "@/lib/types";
import { TRADE_ICON } from "./work-board";

// One work order as a flowchart: report, triage, memory, the vendor calls
// (side by side when they ran at once), the owner, the booking, the entry
// notice, the follow-up and the close. Each step is done, happening now, or
// still to come; every one of them is also a typed event in Keewano.

type State = "done" | "active" | "pending" | "skipped";

interface Step {
  key: string;
  icon: LucideIcon;
  title: string;
  detail: string;
  state: State;
  keewano?: boolean;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function vendorBranch(task: TaskDetailDTO): Step[] {
  const w = task.workOrder!;
  const latest = new Map<string, CallDTO>();
  for (const c of task.calls.filter((x) => x.kind === "business")) latest.set(c.targetName, c);
  const calls = [...latest.values()];
  if (!calls.length) {
    const names = (w.vendors.length ? w.vendors : w.ranked.slice(0, 2)).slice(0, 3);
    return (names.length ? names : ["Vendors"]).map((n) => ({ key: `v_${n}`, icon: PhoneCall, title: n, detail: "Up next", state: "pending" as State }));
  }
  return calls.map((c) => {
    const live = ["queued", "ringing", "in_progress"].includes(c.status);
    const booked = w.booked?.vendor === c.targetName;
    const price = c.analysis?.quote?.priceUsd ?? c.analysis?.offers.find((o) => o.priceUsd != null)?.priceUsd ?? null;
    const unreached = ["no_answer", "voicemail", "failed", "wrong_number"].includes(c.analysis?.outcome ?? "");
    return {
      key: c.id,
      icon: PhoneCall,
      title: c.targetName,
      detail: live
        ? c.status === "in_progress"
          ? "On the phone now"
          : "Ringing"
        : booked
          ? `Booked${price != null ? ` · ${usd(price)}` : ""}`
          : unreached
            ? "No answer"
            : price != null
              ? `Quoted ${usd(price)}${c.analysis?.quote?.availability ? ` · ${c.analysis.quote.availability}` : ""}`
              : (c.analysis?.summary ?? "Done"),
      state: live ? "active" : unreached ? "skipped" : "done",
    };
  });
}

function steps(task: TaskDetailDTO): (Step | Step[])[] {
  const w = task.workOrder!;
  const ev = (type: string) => task.events.filter((e) => e.type === type).at(-1);
  const terminal = ["completed", "failed", "cancelled"].includes(task.status);
  const triaged = Boolean(w.trade);
  const remembered = Boolean(ev("memory.retrieved"));
  const emergency = ev("emergency.routed");
  const TradeIcon = TRADE_ICON[w.trade ?? "general"] ?? Wrench;
  const report: Step = { key: "report", icon: MessageSquareText, title: "Tenant report", detail: `${w.tenant ?? "Tenant"} texted${w.photos ? ` · ${w.photos} photo${w.photos === 1 ? "" : "s"}` : ""}`, state: "done", keewano: true };
  const triage: Step = { key: "triage", icon: TradeIcon, title: "Triage", detail: triaged ? `${(w.trade ?? "").toUpperCase() === "HVAC" ? "HVAC" : w.trade} · ${w.severity}` : "Reading the report", state: triaged ? "done" : "active" };
  // Gas, fire or CO: safety first and a person, no vendor.
  if (emergency && !task.calls.length) {
    return [report, triage, { key: "emergency", icon: Siren, title: "Emergency", detail: emergency.summary, state: "done", keewano: true }, { key: "closed", icon: CircleCheck, title: "With 911 and the manager", detail: task.result?.summary ?? "", state: terminal ? "done" : "active" }];
  }
  const approved = ev("approval.granted") ?? ev("approval.denied");
  const asked = ev("approval.requested");
  const owner: Step = approved
    ? { key: "owner", icon: UserRound, title: "Owner approval", detail: approved.summary.replace(/ \(owner\)/, "").replace(/: Approve .*?(,|$)/, "$1"), state: "done", keewano: true }
    : w.waitingOn?.role === "owner"
      ? { key: "owner", icon: UserRound, title: "Owner approval", detail: `Asked ${w.waitingOn.name} by text; the vendor is holding`, state: "active", keewano: true }
      : asked
        ? { key: "owner", icon: UserRound, title: "Owner approval", detail: "Asked; no answer yet", state: "active" }
        : { key: "owner", icon: UserRound, title: "Owner approval", detail: w.booked ? "Within the owner's limit" : "Only if over the limit", state: w.booked ? "skipped" : "pending" };
  const booked: Step = w.booked
    ? { key: "booked", icon: CalendarCheck, title: "Booked", detail: `${w.booked.vendor}${w.booked.window ? ` · ${w.booked.window}` : ""} · ${usd(w.booked.cents / 100)}`, state: "done", keewano: true }
    : { key: "booked", icon: CalendarCheck, title: "Booked", detail: "Best offer within the limit", state: "pending" };
  const notice = ev("entry_notice.sent");
  const noticeStep: Step = notice
    ? { key: "notice", icon: ClipboardCheck, title: "Entry notice", detail: w.waitingOn?.role === "tenant" && w.stage === "booked" ? `Sent; waiting on ${w.waitingOn.name}'s OK` : notice.summary, state: w.waitingOn?.role === "tenant" && w.stage === "booked" ? "active" : "done", keewano: true }
    : { key: "notice", icon: ClipboardCheck, title: "Entry notice", detail: "Window and notice to the tenant", state: "pending" };
  const follow: Step =
    w.stage === "checking"
      ? { key: "follow", icon: PhoneCall, title: "Follow-up", detail: `"On the way?" and "fixed?" sent`, state: "active" }
      : terminal && ev("wo.completed")
        ? { key: "follow", icon: PhoneCall, title: "Follow-up", detail: `${w.tenant ?? "Tenant"} confirmed it's fixed`, state: "done", keewano: true }
        : { key: "follow", icon: PhoneCall, title: "Follow-up", detail: "30 min into the window", state: "pending" };
  const closedEv = ev("wo.completed");
  const closed: Step = closedEv
    ? { key: "closed", icon: CircleCheck, title: "Closed", detail: closedEv.summary.replace(/^Closed: /, ""), state: "done", keewano: true }
    : { key: "closed", icon: CircleCheck, title: "Closed", detail: terminal ? (task.result?.summary ?? "") : "Promise kept or broken", state: terminal ? "done" : "pending" };
  const memory: Step = {
    key: "memory",
    icon: BrainCircuit,
    title: "Keewano",
    detail: remembered ? `${w.ranked.slice(0, 2).join(" & ") || "Vendors"} first${w.replaceQuote ? " · replacement price too" : ""}` : "Unit and vendor history",
    state: remembered ? "done" : triaged ? "active" : "pending",
    keewano: true,
  };
  return [report, triage, memory, vendorBranch(task), owner, booked, noticeStep, follow, closed];
}

const NODE: Record<State, { box: string; icon: string }> = {
  done: { box: "border-done/30 bg-done-soft/30", icon: "bg-done text-white" },
  active: { box: "border-live/50 bg-live-soft/40 ring-2 ring-live/15", icon: "bg-live text-white animate-pulse" },
  pending: { box: "border-dashed border-line bg-surface", icon: "bg-surface-2 text-faint" },
  skipped: { box: "border-line bg-surface opacity-60", icon: "bg-surface-2 text-faint" },
};

function Node({ step, compact }: { step: Step; compact?: boolean }) {
  const Icon = step.icon;
  const s = NODE[step.state];
  return (
    <div className={clsx("relative rounded-xl border p-2.5", compact ? "w-[196px]" : "w-[164px]", s.box)}>
      <div className="flex items-start gap-2 pr-2">
        <span className={clsx("grid size-6 shrink-0 place-items-center rounded-full", s.icon)}>
          <Icon className="size-3.5" />
        </span>
        <span className={clsx("line-clamp-2 pt-0.5 text-[12.5px] font-semibold leading-tight", step.state === "pending" && "text-muted")}>{step.title}</span>
      </div>
      <p className={clsx("mt-1.5 line-clamp-3 text-[11.5px] leading-snug", step.state === "pending" ? "text-faint" : "text-muted")}>{step.detail}</p>
      {step.keewano && step.state === "done" && <span className="absolute right-2 top-2 size-1.5 rounded-full bg-work" title="Recorded in Keewano" />}
    </div>
  );
}

function Connector({ state }: { state: State }) {
  return (
    <div className="flex w-7 shrink-0 items-center self-center" aria-hidden>
      <div className={clsx("h-0.5 flex-1 rounded-full", state === "done" ? "bg-done/50" : state === "active" ? "bg-live/60" : "bg-line")} />
      <div className={clsx("size-0 border-y-[4px] border-l-[6px] border-y-transparent", state === "done" ? "border-l-done/50" : state === "active" ? "border-l-live/60" : "border-l-line")} />
    </div>
  );
}

const stateOf = (s: Step | Step[]): State => {
  if (!Array.isArray(s)) return s.state;
  if (s.some((x) => x.state === "active")) return "active";
  if (s.every((x) => x.state === "pending")) return "pending";
  return "done";
};

export function WorkOrderFlow({ task }: { task: TaskDetailDTO }) {
  if (!task.workOrder) return null;
  const all = steps(task);
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted">How this work order is going</h3>
        <span className="flex items-center gap-1.5 text-[11px] text-faint">
          <span className="size-1.5 rounded-full bg-work" /> recorded in Keewano
        </span>
      </div>
      <div className="scroll-thin -mx-1 overflow-x-auto px-1 pb-1">
        <ol className="flex min-w-max items-stretch">
          {all.map((s, i) => (
            <Fragment key={Array.isArray(s) ? "vendors" : s.key}>
              {i > 0 && <Connector state={stateOf(all[i - 1]) === "done" ? stateOf(s) === "pending" ? "pending" : "done" : stateOf(s)} />}
              {Array.isArray(s) ? (
                <li className="flex flex-col justify-center gap-1.5 rounded-2xl border border-dashed border-line px-1.5 py-1.5">
                  <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-faint">{s.length > 1 ? "Called at once" : "Call"}</span>
                  {s.map((v) => (
                    <Node key={v.key} step={v} compact />
                  ))}
                </li>
              ) : (
                <li className="flex items-center">
                  <Node step={s} />
                </li>
              )}
            </Fragment>
          ))}
        </ol>
      </div>
    </div>
  );
}
