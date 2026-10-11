"use client";

import { Database, MessageSquare, Phone } from "lucide-react";
import type { StateDTO, TaskSummaryDTO } from "@/lib/types";
import { useAppState } from "./api";
import { DevTools } from "./dev-tools";
import { VoiceBars } from "./live-call";
import { TaskCard } from "./task-card";
import { Thread } from "./thread";
import { Logo, ModeChips, SectionTitle, formatPhone, timeAgo } from "./ui";
import { Board, KpiRow, LiveStrip } from "./work-board";

const NEEDS_YOU = ["needs_info", "needs_approval"];
const WORKING = ["new", "planning", "ready", "calling", "reviewing", "scheduled"];

export function Home() {
  const { data, mutate, error } = useAppState();
  const tasks = data?.tasks ?? [];
  // Work orders get the board; anything else Telo is doing (rare now) keeps the old columns.
  const other = tasks.filter((t) => !t.workOrder);
  const group = (statuses: string[]) => other.filter((t) => statuses.includes(t.status));
  const needsYou = group(NEEDS_YOU);
  const working = group(WORKING).filter((t) => !t.live);
  const done = other.filter((t) => !NEEDS_YOU.includes(t.status) && !WORKING.includes(t.status));
  const teloPhone = formatPhone(data?.teloPhone ?? null);

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-1 flex-col px-4 pb-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="flex items-center gap-4">
          <Logo />
          <span className="hidden text-[14px] text-muted md:inline">
            {data?.firm ? <span className="font-medium text-ink">{data.firm}</span> : null}
            {data?.firm ? " · " : ""}Telo works the phones for your rentals.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {teloPhone && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-[13px] font-medium text-brand">
              <Phone className="size-3.5" /> Text or call {teloPhone}
            </span>
          )}
          {data && <ModeChips modes={data.modes} />}
        </div>
      </header>

      {error && <p className="mb-3 rounded-xl bg-bad-soft px-3 py-2 text-sm text-bad">Can&apos;t reach the server. Is it running?</p>}

      <div className="grid flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,400px)]">
        <main className="flex min-w-0 flex-col gap-5">
          <KpiRow tasks={tasks} metrics={data?.metrics} />
          <LiveStrip tasks={tasks} />
          <Board tasks={tasks} />
          <Column title="Needs you" tasks={needsYou} empty={null} />
          <Column title="Other tasks" tasks={working} empty={null} />
          <Column title="Done" tasks={done} empty={null} />
          {data?.lastKeewanoQuery && <KeewanoQuery q={data.lastKeewanoQuery} />}
          {data?.modes.devTools && <DevTools onChange={() => void mutate()} simulatedLine={data.modes.voice === "mock"} mail={data.modes.mail} />}
        </main>

        <section className="flex min-h-[560px] flex-col lg:sticky lg:top-4 lg:order-last lg:h-[calc(100vh-6rem)]">
          <div className="mb-2 flex items-center gap-2 px-1 text-[12px] text-muted">
            <MessageSquare className="size-3.5" />
            {data?.liveUserCall ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-live">
                <VoiceBars active /> You&apos;re on the phone with Telo
              </span>
            ) : (
              <span>Your thread with Telo, as it looks on your phone</span>
            )}
          </div>
          {data?.pairingCode && teloPhone && (
            <div className="mb-2 rounded-2xl border border-im-blue/30 bg-im-blue/10 px-4 py-3 text-[13.5px]">
              <div className="font-semibold">Link your phone</div>
              From your phone, text <span className="rounded bg-surface px-1.5 py-0.5 font-mono font-semibold">LINK {data.pairingCode}</span> to{" "}
              <span className="font-medium">{teloPhone}</span>. After that, texts and calls from your number reach Telo as you.
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[30px] border border-line bg-im-bg shadow-[0_8px_30px_rgba(0,0,0,0.06)]">
            <Thread
              messages={data?.messages ?? []}
              tasks={tasks}
              teloPhone={teloPhone}
              liveLine={data?.modes.voice === "dial"}
              user={data?.user}
              onSent={() => void mutate()}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

/** The last question nobody prepared for: Claude wrote the SQL, it ran live on Keewano, and the answer came from the rows. */
function KeewanoQuery({ q }: { q: NonNullable<StateDTO["lastKeewanoQuery"]> }) {
  return (
    <div>
      <SectionTitle aside={<span className="text-[12px] text-faint">{timeAgo(q.at)}</span>}>
        <span className="inline-flex items-center gap-1.5">
          <Database className="size-3.5" /> Asked Keewano
        </span>
      </SectionTitle>
      <div className="rounded-2xl border border-line bg-surface p-4">
        <p className="text-[14px] font-medium">&ldquo;{q.question}&rdquo;</p>
        {q.answer && <p className="mt-1 text-[13.5px] leading-snug text-muted">{q.answer}</p>}
        <div className="mt-3 rounded-lg bg-surface-2 px-2.5 py-2">
          <div className="flex justify-between text-[11px] text-faint">
            <span>Live Keewano SQL, written by Claude</span>
            <span>
              {q.rows} rows · {q.ms} ms
            </span>
          </div>
          <code className="scroll-thin mt-1 block max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-ink/70">{q.sql}</code>
        </div>
      </div>
    </div>
  );
}

function Column({ title, tasks, empty }: { title: string; tasks: TaskSummaryDTO[]; empty: string | null }) {
  if (!tasks.length && !empty) return null;
  return (
    <div>
      <SectionTitle aside={tasks.length ? <span className="text-[12px] text-faint">{tasks.length}</span> : null}>{title}</SectionTitle>
      {tasks.length ? (
        <div className="grid gap-3 xl:grid-cols-2">
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} />
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-[14px] text-muted">{empty}</p>
      )}
    </div>
  );
}
