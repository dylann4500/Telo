"use client";

import clsx from "clsx";
import { ArrowUp, Mail, MessageSquare, Phone } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import type { MessageDTO, StateDTO, TaskSummaryDTO } from "@/lib/types";
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

const CHANNEL_LABEL: Record<string, string> = { sms: "Text Message", imessage: "iMessage", whatsapp: "WhatsApp", web: "From the dashboard", voice: "Phone call", email: "From your email" };

export function Thread({
  messages,
  tasks,
  onSent,
  teloPhone,
  liveLine,
  user,
}: {
  messages: MessageDTO[];
  tasks: TaskSummaryDTO[];
  onSent: () => void;
  teloPhone: string | null;
  liveLine: boolean;
  user?: StateDTO["user"];
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const last = messages.at(-1)?.id;
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [last]);

  // A text that Telo also delivered by phone (calls on) shows once, as the call.
  const textFor = new Map<string, MessageDTO>(); // the phoned-in copy's id -> the text it repeats
  messages.forEach((m, i) => {
    if (m.direction !== "out" || m.channel === "voice" || m.channel === "web") return;
    const copy = messages.slice(i + 1, i + 4).find((n) => n.direction === "out" && n.channel === "voice" && n.body === m.body);
    if (copy) textFor.set(copy.id, m);
  });
  const hidden = new Set([...textFor.values()].map((m) => m.id));
  const visible = messages.filter((m) => !hidden.has(m.id));
  // Quick replies go under the newest message that asked for a decision.
  const waiting = new Map(tasks.filter((t) => t.waiting?.kind === "approval").map((t) => [t.id, t]));
  const lastAsk = new Map<string, number>();
  visible.forEach((m, i) => {
    if (m.direction === "out" && m.taskId && waiting.has(m.taskId) && (m.kind === "approval" || m.kind === "question")) lastAsk.set(m.taskId, i);
  });
  const lastMine = visible.findLastIndex((m) => m.direction === "in" && m.kind !== "call");
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
        {user && liveLine && <UpdatesToggle user={user} onChange={onSent} />}
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

        {visible.map((m, i) => {
          const prev = visible[i - 1];
          const next = visible[i + 1];
          const showDivider = !prev || new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > GAP_MS || prev.channel !== m.channel;
          const mine = m.direction === "in";
          const endOfRun = !next || next.direction !== m.direction || new Date(next.createdAt).getTime() - new Date(m.createdAt).getTime() > 60_000;
          const task = m.taskId ? waiting.get(m.taskId) : undefined;
          const options = task && lastAsk.get(task.id) === i ? task.waiting?.options : undefined;

          if (m.kind === "email") {
            // What Telo noticed in the inbox: a quiet note, not a text.
            return (
              <Fragment key={m.id}>
                <div className="rise mx-auto my-2 flex max-w-[85%] items-start gap-2 rounded-2xl border border-black/5 px-3 py-2 text-[12.5px] text-im-meta dark:border-white/10">
                  <Mail className="mt-0.5 size-3.5 shrink-0" />
                  <span>{m.body}</span>
                </div>
              </Fragment>
            );
          }

          if (m.kind === "call") {
            return (
              <Fragment key={m.id}>
                <Divider text={divider(m.createdAt)} />
                <div className="rise mx-auto my-2 flex max-w-[85%] items-start gap-2 rounded-2xl border border-black/5 px-3 py-2 text-[12.5px] text-im-meta dark:border-white/10">
                  <Phone className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    <span className="font-medium text-im-gray-ink">{/^\(Telo called you\)/.test(m.body) ? "Telo called you." : /^\(missed/.test(m.body) ? "Missed call." : "You called Telo."}</span>{" "}
                    {m.body.replace(/^\((on the phone|you called Telo|Telo called you|missed: )\)?\s*/, "").replace(/^Telo's call went to voicemail\)?/, "Telo's call went to voicemail.")}
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
              {!mine && m.channel === "voice" && m.kind !== "call" && (
                <p className="-mt-1 mb-2 pl-2 text-[11px] text-im-meta">
                  {textFor.has(m.id) && textFor.get(m.id)!.status !== "failed" ? "Texted and called you" : "Told you by phone"}
                </p>
              )}
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

/** How Telo reaches the user: texts only, or texts plus a phone call for anything that needs them. */
function UpdatesToggle({ user, onChange }: { user: StateDTO["user"]; onChange: () => void }) {
  const [pending, setPending] = useState<boolean | null>(null);
  const calls = pending ?? user.callUpdates;
  useEffect(() => setPending(null), [user.callUpdates]);
  async function choose(next: boolean) {
    if (next === calls) return;
    setPending(next);
    await post("/api/settings", { callUpdates: next });
    onChange();
  }
  const option = (on: boolean, label: string, Icon: typeof Phone, title: string) => (
    <button
      type="button"
      title={title}
      aria-pressed={calls === on}
      onClick={() => void choose(on)}
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-[3px] transition",
        calls === on ? "bg-surface text-im-gray-ink shadow-sm dark:bg-im-gray" : "text-im-meta hover:text-im-gray-ink",
      )}
    >
      <Icon className="size-3" /> {label}
    </button>
  );
  return (
    <div className="mt-2 flex flex-col items-center gap-1">
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="text-im-meta">Updates</span>
        <div role="group" aria-label="How Telo reaches you" className="flex rounded-full bg-black/[0.06] p-[2px] font-medium dark:bg-white/10">
          {option(false, "Text", MessageSquare, "Telo texts you. It never calls unless you ask.")}
          {option(true, "Text + call", Phone, "Telo texts you, and also calls when it needs an answer or a call has news. At night it only calls if you've been talking to it.")}
        </div>
      </div>
      {user.textsFailing && (
        <p className={clsx("max-w-[18rem] text-center text-[10.5px] leading-snug", calls ? "text-im-meta" : "text-wait")}>
          {calls ? "Texts aren't reaching your phone yet (carrier registration), so Telo calls you." : "Texts aren't reaching your phone yet (carrier registration). Turn on calls to hear from Telo."}
        </p>
      )}
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
