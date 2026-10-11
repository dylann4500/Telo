"use client";

import clsx from "clsx";
import Link from "next/link";
import { BrainCircuit } from "lucide-react";
import type { TaskSummaryDTO } from "@/lib/types";
import { Chip, StatusPill, clock, timeAgo, useNow } from "./ui";

export function TaskCard({ task }: { task: TaskSummaryDTO }) {
  const now = useNow(Boolean(task.live));
  const live = task.live;
  const elapsed = live?.answeredAt ? (now - new Date(live.answeredAt).getTime()) / 1000 : null;
  const done = ["completed", "failed", "cancelled"].includes(task.status);
  return (
    <Link
      href={`/tasks/${task.id}`}
      className={clsx(
        "rise block rounded-2xl border bg-surface p-4 transition hover:-translate-y-px hover:shadow-md",
        task.waiting ? "border-wait/40" : live ? "border-live/40" : "border-line",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold">{task.title}</h3>
          <p className="mt-0.5 truncate text-[13px] text-muted">
            {task.targets.length ? task.targets.join(", ") : "Working out who to call"} · {timeAgo(task.updatedAt, now)}
          </p>
        </div>
        <StatusPill status={task.status} />
      </div>

      {live ? (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-live-soft px-3 py-2 text-[13px] text-live">
          <span className="live-dot size-2 rounded-full bg-live" />
          <span className="font-medium">{live.status === "in_progress" ? `With ${live.target}` : `Dialing ${live.target}`}</span>
          {live.statusDetail && !["Connected", "Ringing"].includes(live.statusDetail) && <span className="opacity-80">· {live.statusDetail}</span>}
          {elapsed !== null && <span className="ml-auto font-mono tabular-nums">{clock(elapsed)}</span>}
        </div>
      ) : task.waiting ? (
        <p className="mt-3 rounded-xl bg-wait-soft px-3 py-2 text-[13px] leading-snug text-wait">{task.waiting.prompt}</p>
      ) : done && task.result ? (
        <p className="mt-3 text-[13.5px] leading-snug text-ink/80">{task.result.summary}</p>
      ) : task.statusDetail ? (
        <p className="mt-3 text-[13px] text-muted">{task.statusDetail}</p>
      ) : null}

      {(task.memoryUsed || task.result?.confirmation || task.callsMade > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {task.memoryUsed && (
            <Chip tone="work">
              <BrainCircuit className="size-3" /> Used past calls
            </Chip>
          )}
          {task.callsMade > 0 && <Chip>{task.callsMade === 1 ? "1 call" : `${task.callsMade} calls`}</Chip>}
          {task.result?.confirmation && <Chip tone="done">Conf. {task.result.confirmation}</Chip>}
        </div>
      )}
    </Link>
  );
}
