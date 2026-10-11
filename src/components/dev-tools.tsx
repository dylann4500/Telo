"use client";

import { FlaskConical, Inbox, Mail, MessageSquareText, PhoneIncoming, RotateCcw, ScrollText } from "lucide-react";
import { useState } from "react";
import { post } from "./api";

// The demo's other phones, on the simulated line: the tenant, the owner and the vendors text Telo from here.
const PARTY_TEXTS = [
  { label: "Maria (tenant): AC is out, 2 photos", body: { from: "ten_alder_b", text: "Hi, the AC is out again. It's blowing warm air and it's 85 degrees in here.", photos: 2 } },
  { label: "Priya (owner): yes, and get a replacement quote", body: { from: "own_shah", text: "Yes, approve it. And get a replacement quote too." } },
  { label: "Maria: YES to entry", body: { from: "ten_alder_b", text: "Yes, that works." } },
  { label: "Maria: Y, it's fixed", body: { from: "ten_alder_b", text: "Y, it's fixed. Thank you!" } },
];

/** Demo controls: load the portfolio's history, text Telo as a tenant or owner, start over. Hidden when TELO_DEV_TOOLS=false. */
export function DevTools({ onChange, simulatedLine, mail }: { onChange: () => void; simulatedLine: boolean; mail: "gmail" | "mock" | "off" }) {
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
          <ScrollText className="size-3.5" /> Load the portfolio&apos;s history
        </button>
        {simulatedLine &&
          PARTY_TEXTS.map((t) => (
            <button key={t.label} disabled={!!busy} onClick={() => run(t.label, "/api/dev/simulate-text", t.body)} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 hover:border-brand disabled:opacity-50">
              <MessageSquareText className="size-3.5" /> {t.label}
            </button>
          ))}
        {simulatedLine && (
          <button
            disabled={!!busy}
            onClick={() =>
              run("call", "/api/dev/simulate-call", {
                lines: ["Hey, how's the AC at Alder Street going?"],
              })
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 hover:border-brand disabled:opacity-50"
          >
            <PhoneIncoming className="size-3.5" /> Simulate calling Telo
          </button>
        )}
        {mail !== "off" && (
          <button disabled={!!busy} onClick={() => run("mail", "/api/dev/check-email")} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 hover:border-brand disabled:opacity-50">
            <Inbox className="size-3.5" /> Check email now
          </button>
        )}
        {mail === "mock" && (
          <>
            <button disabled={!!busy} onClick={() => run("receipt", "/api/dev/simulate-email", { preset: "receipt" })} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 hover:border-brand disabled:opacity-50">
              <Mail className="size-3.5" /> Email: a refund receipt
            </button>
            <button disabled={!!busy} onClick={() => run("problem", "/api/dev/simulate-email", { preset: "problem" })} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 hover:border-brand disabled:opacity-50">
              <Mail className="size-3.5" /> Email: a bill that went up
            </button>
          </>
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
