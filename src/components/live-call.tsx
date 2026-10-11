"use client";

import clsx from "clsx";
import Link from "next/link";
import { useEffect, useRef } from "react";
import type { CallDTO, TaskSummaryDTO } from "@/lib/types";
import { useTask } from "./api";
import { clock, useNow } from "./ui";

/** The call Telo is on right now: who, how long, and (on the simulated line) the words as they happen. */
export function LiveCallCard({ task }: { task: TaskSummaryDTO }) {
  const { data } = useTask(task.id);
  const call = data?.calls.find((c) => c.id === task.live?.id) ?? data?.calls.findLast((c) => ["queued", "ringing", "in_progress"].includes(c.status));
  if (!task.live) return null;
  return (
    <div className="rise overflow-hidden rounded-2xl border border-live/30 bg-surface shadow-sm">
      <div className="flex items-center gap-3 border-b border-line bg-live-soft/60 px-4 py-3">
        <VoiceBars active={task.live.status === "in_progress"} />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium uppercase tracking-wide text-live">
            {task.live.status === "in_progress" ? "Telo is on the phone" : "Telo is dialing"}
          </div>
          <div className="truncate text-[15px] font-semibold">{task.live.target}</div>
        </div>
        <Timer since={task.live.answeredAt} />
      </div>
      <div className="px-4 py-3">
        <div className="mb-2 flex items-center justify-between text-[12.5px] text-muted">
          <span>{call?.purpose ?? task.title}</span>
          <Link href={`/tasks/${task.id}`} className="font-medium text-brand hover:underline">
            Open
          </Link>
        </div>
        <LiveTranscript call={call} />
      </div>
    </div>
  );
}

function Timer({ since }: { since: string | null }) {
  const now = useNow(Boolean(since));
  if (!since) return <span className="text-[13px] text-muted">Ringing…</span>;
  return <span className="font-mono text-[15px] tabular-nums text-live">{clock((now - new Date(since).getTime()) / 1000)}</span>;
}

export function VoiceBars({ active }: { active: boolean }) {
  return (
    <span className="flex h-7 items-center gap-[3px]" aria-hidden>
      {[0.1, 0.35, 0.2, 0.5, 0.3].map((d, i) => (
        <span
          key={i}
          className={clsx("h-full w-[3px] rounded-full bg-live", active ? "voice-bar" : "scale-y-[0.3] opacity-60")}
          style={{ animationDelay: `${d}s` }}
        />
      ))}
    </span>
  );
}

export function LiveTranscript({ call, max = 4 }: { call: CallDTO | undefined; max?: number }) {
  const end = useRef<HTMLDivElement>(null);
  const turns = call?.transcript ?? [];
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length]);
  if (!turns.length) {
    return (
      <p className="text-[13px] text-faint">
        {call?.status === "in_progress" ? "Connected. The transcript arrives as soon as the call ends." : "Waiting for someone to pick up…"}
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {turns.slice(-max).map((t, i) => (
        <p key={`${turns.length}-${i}`} className="rise text-[13.5px] leading-snug">
          <span className={clsx("mr-1.5 text-[11px] font-semibold uppercase", t.speaker === "agent" ? "text-brand" : "text-muted")}>
            {t.speaker === "agent" ? "Telo" : call?.targetName ?? "Them"}
          </span>
          {t.text}
        </p>
      ))}
      <div ref={end} />
    </div>
  );
}
