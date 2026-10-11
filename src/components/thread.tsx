"use client";

import clsx from "clsx";
import { ArrowUp, Phone } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import type { MessageDTO, TaskSummaryDTO } from "@/lib/types";
import { post } from "./api";

// The conversation with Telo, drawn like the Messages app: this is the same
// thread the user has on their phone when they text Telo's number. Messages
// typed here go through the same pipeline as a real text.

const SUGGESTIONS = [
  "Cancel my gym membership at Equinox",
  "My bill is wrong again. Can you call them and figure it out?",
  "Call three windshield repair shops and find one that can do tomorrow under $400",
  "Book a table for 5 at Nopa around 7:30 tonight",
];

const GAP_MS = 20 * 60_000;

function divider(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} at ${time}`;
}

const CHANNEL_LABEL: Record<string, string> = { sms: "Text Message", imessage: "iMessage", whatsapp: "WhatsApp", web: "From the dashboard", voice: "Phone call" };

export function Thread({
  messages,
  tasks,
  onSent,
  teloPhone,
  liveLine,
}: {
  messages: MessageDTO[];
  tasks: TaskSummaryDTO[];
  onSent: () => void;
  teloPhone: string | null;
  liveLine: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const last = messages.at(-1)?.id;
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [last]);

  // Quick replies go under the newest message that asked for a decision.
  const waiting = new Map(tasks.filter((t) => t.waiting?.kind === "approval").map((t) => [t.id, t]));
  const lastAsk = new Map<string, number>();
  messages.forEach((m, i) => {
    if (m.direction === "out" && m.taskId && waiting.has(m.taskId) && (m.kind === "approval" || m.kind === "question")) lastAsk.set(m.taskId, i);
  });
  const lastMine = messages.findLastIndex((m) => m.direction === "in" && m.kind !== "call");
  const thinking = messages.at(-1)?.direction === "in";
  const smsThread = messages.filter((m) => m.direction === "in").at(-1)?.channel === "sms";

  async function send(text: string) {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft("");
    await post("/api/messages", { text: body });
    setSending(false);
    onSent();
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-im-bg">
      <div className="flex flex-col items-center border-b border-black/5 bg-im-bg/90 px-4 pb-2.5 pt-3 backdrop-blur dark:border-white/10">
        <div className="grid size-11 place-items-center rounded-full bg-gradient-to-b from-[#f08a72] to-brand text-[17px] font-semibold text-white shadow-sm">T</div>
        <div className="mt-1 text-[13px] font-medium">Telo</div>
        <div className="text-[11px] text-im-meta">
          {teloPhone ? teloPhone : liveLine ? "Number not set (TELO_PHONE_NUMBER)" : "Simulated line"}
        </div>
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="mx-auto mt-4 max-w-sm px-2 text-center">
            <p className="text-[15px] font-semibold">Hand off anything that needs a phone call.</p>
            <p className="mt-1 text-[13px] text-im-meta">
              {teloPhone ? `Text ${teloPhone} from your phone, or type below.` : "Type a request the way you'd text it."} Telo asks only what it needs, makes the call, and texts you back.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-2xl bg-im-gray px-3 py-2 text-left text-[13.5px] text-im-gray-ink transition hover:opacity-80">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const showDivider = !prev || new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > GAP_MS || prev.channel !== m.channel;
          const mine = m.direction === "in";
          const endOfRun = !next || next.direction !== m.direction || new Date(next.createdAt).getTime() - new Date(m.createdAt).getTime() > 60_000;
          const task = m.taskId ? waiting.get(m.taskId) : undefined;
          const options = task && lastAsk.get(task.id) === i ? task.waiting?.options : undefined;

          if (m.kind === "call") {
            return (
              <Fragment key={m.id}>
                <Divider text={divider(m.createdAt)} />
                <div className="rise mx-auto my-2 flex max-w-[85%] items-start gap-2 rounded-2xl border border-black/5 px-3 py-2 text-[12.5px] text-im-meta dark:border-white/10">
                  <Phone className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    <span className="font-medium text-im-gray-ink">You called Telo.</span> {m.body.replace(/^\(on the phone\)\s*/, "")}
                  </span>
                </div>
              </Fragment>
            );
          }

          return (
            <Fragment key={m.id}>
              {showDivider && <Divider text={divider(m.createdAt)} sub={CHANNEL_LABEL[m.channel]} />}
              <div className={clsx("rise flex", mine ? "justify-end" : "justify-start", endOfRun ? "mb-2" : "mb-[3px]")}>
                <div
                  className={clsx(
                    "bubble max-w-[78%] whitespace-pre-wrap px-3 py-[7px] text-[15px] leading-[1.3]",
                    "rounded-[18px]",
                    mine
                      ? clsx("text-white", m.channel === "sms" ? "bg-im-green" : "bg-im-blue", endOfRun && "tail-right")
                      : clsx("bg-im-gray text-im-gray-ink", endOfRun && "tail-left"),
                  )}
                >
                  {m.channel === "voice" && <Phone className="mr-1 inline size-3.5 -translate-y-px opacity-80" />}
                  {m.body}
                </div>
              </div>
              {options && (
                <div className="mb-2 flex flex-wrap gap-1.5 pl-1">
                  {options.map((o) => (
                    <button
                      key={o.id}
                      onClick={async () => {
                        await post(`/api/tasks/${task!.id}/answer`, { optionId: o.id });
                        onSent();
                      }}
                      className="rounded-full border border-im-blue/50 px-3 py-1 text-[13px] font-medium text-im-blue transition hover:bg-im-blue hover:text-white"
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
              {!mine && m.status === "failed" && (
                <p className="-mt-1 mb-2 pl-2 text-[11px] font-medium text-[#ff3b30]">Not delivered{m.error ? `: ${m.error}` : ""}</p>
              )}
              {i === lastMine && mine && <p className="-mt-1 mb-2 pr-1 text-right text-[11px] text-im-meta">Delivered</p>}
            </Fragment>
          );
        })}

        {thinking && (
          <div className="mb-2 flex justify-start" aria-label="Telo is typing">
            <div className="bubble tail-left flex items-center gap-1 rounded-[18px] bg-im-gray px-3.5 py-3">
              {[0, 1, 2].map((d) => (
                <span key={d} className="typing-dot size-2 rounded-full bg-im-meta" style={{ animationDelay: `${d * 0.15}s` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottom} />
      </div>

      <form
        className="px-3 pb-3 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(draft);
        }}
      >
        <div className="flex items-end gap-2 rounded-[20px] border border-black/15 px-3 py-1.5 dark:border-white/20">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            rows={1}
            placeholder={smsThread ? "Text Message" : "iMessage"}
            className="max-h-32 min-h-[22px] flex-1 resize-none bg-transparent py-0.5 text-[15px] outline-none placeholder:text-im-meta"
          />
          <button
            type="submit"
            disabled={!draft.trim() || sending}
            className={clsx("grid size-7 shrink-0 place-items-center rounded-full text-white transition disabled:opacity-30", smsThread ? "bg-im-green" : "bg-im-blue")}
            aria-label="Send"
          >
            <ArrowUp className="size-4" strokeWidth={3} />
          </button>
        </div>
      </form>
    </div>
  );
}

function Divider({ text, sub }: { text: string; sub?: string }) {
  return (
    <div className="my-3 text-center text-[11px] leading-tight text-im-meta">
      {sub && sub !== "From the dashboard" && <div className="font-medium">{sub}</div>}
      <div>{text}</div>
    </div>
  );
}
