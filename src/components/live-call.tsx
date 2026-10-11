"use client";

import clsx from "clsx";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CallDTO, QuestionDTO, TaskSummaryDTO } from "@/lib/types";
import { post, useTask } from "./api";
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
        {task.waiting?.live && (
          <div className="mb-3">
            <LiveAsk taskId={task.id} question={task.waiting} />
          </div>
        )}
        <LiveTranscript call={call} />
      </div>
    </div>
  );
}

/** A question Telo asked while the business waits on the line: answer it right here (same as replying to the text). */
export function LiveAsk({ taskId, question, onDone }: { taskId: string; question: QuestionDTO; onDone?: () => void }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const now = useNow(true);
  const live = question.live;
  if (!live) return null;
  const waited = Math.max(0, (now - new Date(live.askedAt).getTime()) / 1000);
  async function send(body: Record<string, unknown>) {
    setSending(true);
    await post(`/api/tasks/${taskId}/answer`, body);
    setSending(false);
    setText("");
    onDone?.();
  }
  return (
    <div className="rise rounded-xl border border-wait/40 bg-wait-soft/60 p-3" role="group" aria-label="Telo needs your answer now">
      <div className="flex items-center justify-between gap-2 text-[12px] font-semibold text-wait">
        <span className="inline-flex items-center gap-1.5">
          <span className="live-dot size-2 rounded-full bg-wait" /> {live.target} is waiting on the line
        </span>
        <span className="font-mono tabular-nums">{clock(waited)}</span>
      </div>
      <p className="mt-1.5 text-[14px] leading-snug text-ink">{question.prompt}</p>
      {question.kind === "approval" ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {question.options.map((o) => (
            <button
              key={o.id}
              disabled={sending}
              onClick={() => void send({ optionId: o.id })}
              className="rounded-full border border-brand/40 bg-surface px-3 py-1 text-[13px] font-medium text-brand transition hover:bg-brand hover:text-brand-ink disabled:opacity-50"
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) void send({ text: text.trim() });
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={question.fields.map((f) => f.label).join(", ") || "Your answer"}
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[14px] outline-none focus:border-brand"
          />
          <button disabled={!text.trim() || sending} className="rounded-lg bg-brand px-3 text-[13px] font-medium text-brand-ink disabled:opacity-50">
            Send
          </button>
        </form>
      )}
      <div className="mt-2 flex items-center justify-between text-[11.5px] text-muted">
        <span>Telo tells them as soon as you answer.</span>
        <button disabled={sending} onClick={() => void send({ decline: true })} className="font-medium hover:text-ink disabled:opacity-50">
          Not now
        </button>
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
