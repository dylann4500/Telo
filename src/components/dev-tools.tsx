"use client";

import { FlaskConical, PhoneIncoming, RotateCcw, ScrollText } from "lucide-react";
import { useState } from "react";
import { post } from "./api";

/** Demo controls: load the backstory, simulate Dylan calling Telo, start over. Hidden when TELO_DEV_TOOLS=false. */
export function DevTools({ onChange, simulatedLine }: { onChange: () => void; simulatedLine: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  async function run(name: string, url: string, body?: unknown) {
    setBusy(name);
    setNote(null);
    const res = await post(url, body);
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    setNote(res.ok ? (json.note ?? (json.created === false ? "Already loaded." : "Done.")) : (json.error ?? `Failed (${res.status})`));
    onChange();
  }
  return (
    <details className="group rounded-2xl border border-dashed border-line bg-surface-2 px-4 py-3 text-[13px]">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-muted">
        <FlaskConical className="size-4" /> Demo controls
        <span className="ml-auto text-[11px] text-faint group-open:hidden">show</span>
      </summary>
      <div className="mt-3 flex flex-wrap gap-2">
        <button disabled={!!busy} onClick={() => run("seed", "/api/dev/seed")} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 hover:border-brand disabled:opacity-50">
          <ScrollText className="size-3.5" /> Load last week&apos;s Comcast call
        </button>
        {simulatedLine && (
          <button
            disabled={!!busy}
            onClick={() =>
              run("call", "/api/dev/simulate-call", {
                lines: ["Hey, can you cancel my gym membership? It's Equinox. The email on it is dylan@example.com."],
              })
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 hover:border-brand disabled:opacity-50"
          >
            <PhoneIncoming className="size-3.5" /> Simulate calling Telo
          </button>
        )}
        <button
          disabled={!!busy}
          onClick={() => {
            if (confirm("Clear all tasks, calls and messages on this machine?")) void run("reset", "/api/dev/reset");
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-bad hover:border-bad disabled:opacity-50"
        >
          <RotateCcw className="size-3.5" /> Start over
        </button>
      </div>
      {(busy || note) && <p className="mt-2 text-[12px] text-muted">{busy ? "Working…" : note}</p>}
    </details>
  );
}
