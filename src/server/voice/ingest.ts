import { and, eq, isNull } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db/client";
import { calls, messages, type CallRow } from "../db/schema";
import type { CallStatus } from "../domain/types";
import { newId } from "../ids";
import { recordEvent } from "../memory/events";
import { getCall, getCallByProviderId, getUserByPhone, patchTask } from "../tasks/repo";
import { getVoice } from "./index";
import type { VoiceEvent } from "./provider";

// Applies provider-neutral voice events to Telo's state. Every handler is
// safe to run twice: statuses only move forward, and finishing a call is
// claimed with a compare-and-swap.

const ORDER: Record<CallStatus, number> = {
  planned: 0,
  queued: 1,
  ringing: 2,
  in_progress: 3,
  ended: 4,
  failed: 4,
  canceled: 4,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function ingestVoiceEvent(e: VoiceEvent): Promise<void> {
  switch (e.kind) {
    case "call.status":
      return onCallStatus(e);
    case "call.ended":
      return onCallEnded(e);
    case "call.transcribed":
      return onTranscribed(e.providerCallId);
    case "call.transcript_partial": {
      await db.update(calls).set({ transcript: e.turns }).where(eq(calls.providerCallId, e.providerCallId));
      return;
    }
    case "message.received": {
      const { handleInboundText } = await import("../concierge");
      await handleInboundText({ from: e.from, body: e.body, channel: e.channel, providerMessageId: e.providerMessageId });
      return;
    }
    case "message.status": {
      const failed = e.deliveryState === "failed" || e.deliveryState === "undelivered";
      await db
        .update(messages)
        .set(failed ? { status: "failed", error: e.error ?? "undelivered" } : e.deliveryState === "delivered" ? { status: "delivered" } : {})
        .where(eq(messages.providerMessageId, e.providerMessageId));
      return;
    }
  }
}

/** The call row for a provider call id. Inbound calls are created on first sight. */
async function resolveCall(e: Extract<VoiceEvent, { kind: "call.status" | "call.ended" }>): Promise<CallRow | undefined> {
  const existing = await getCallByProviderId(e.providerCallId);
  if (existing) return existing;
  if (e.direction === "inbound") {
    const user = e.from ? await getUserByPhone(e.from) : undefined;
    await db
      .insert(calls)
      .values({
        id: newId("call"),
        userId: user?.id ?? config.user.id,
        taskId: null,
        direction: "inbound",
        kind: user ? "user_inbound" : "business",
        targetName: user ? user.name : e.from ?? "Unknown caller",
        targetPhone: e.from,
        purpose: user ? `${user.name} called Telo` : "Inbound call",
        status: "in_progress",
        provider: getVoice().name,
        providerCallId: e.providerCallId,
        startedAt: new Date(),
        answeredAt: new Date(),
      })
      .onConflictDoNothing();
    return getCallByProviderId(e.providerCallId);
  }
  // An outbound status can beat our own write of the provider id; give it a moment.
  for (let i = 0; i < 4; i++) {
    await sleep(750);
    const row = await getCallByProviderId(e.providerCallId);
    if (row) return row;
  }
  throw new Error(`No call row for provider call ${e.providerCallId}`);
}

async function onCallStatus(e: Extract<VoiceEvent, { kind: "call.status" }>) {
  const call = await resolveCall(e);
  if (!call || ORDER[e.status] <= ORDER[call.status] || ORDER[e.status] >= 4) return; // ends are handled by call.ended
  await db
    .update(calls)
    .set({
      status: e.status,
      startedAt: call.startedAt ?? e.at,
      answeredAt: e.status === "in_progress" ? e.at : call.answeredAt,
      statusDetail: e.status === "ringing" ? "Ringing" : e.status === "in_progress" ? "Connected" : call.statusDetail,
    })
    .where(eq(calls.id, call.id));
  if (call.taskId && call.kind === "business") {
    const detail = e.status === "ringing" ? `Ringing ${call.targetName}` : e.status === "in_progress" ? `On the phone with ${call.targetName}` : null;
    if (detail) await patchTask(call.taskId, { statusDetail: detail }, ["calling"]);
    if (e.status === "in_progress") {
      await recordEvent({
        id: `evt_conn_${call.id}`,
        userId: call.userId,
        taskId: call.taskId,
        callId: call.id,
        orgKey: call.orgKey,
        type: "call.connected",
        summary: `Connected to ${call.targetName}`,
      });
    }
  }
}

async function onCallEnded(e: Extract<VoiceEvent, { kind: "call.ended" }>) {
  const call = await resolveCall(e);
  if (!call) return;
  const status: CallStatus = e.endReason === "completed" ? "ended" : e.endReason === "canceled" ? "canceled" : "failed";
  await db
    .update(calls)
    .set({
      status,
      endReason: e.endReason,
      durationSec: e.durationSec ?? call.durationSec,
      endedAt: call.endedAt ?? e.at,
      statusDetail: status === "ended" ? "Call ended" : e.endReason === "no-answer" ? "No answer" : e.endReason === "busy" ? "Busy" : "Call failed",
    })
    .where(eq(calls.id, call.id));
  // No transcript is coming for unanswered or failed calls; finish now.
  if (!e.transcriptAvailable) await finishCall(call.id);
}

async function onTranscribed(providerCallId: string) {
  const call = await getCallByProviderId(providerCallId);
  if (!call) throw new Error(`No call row for provider call ${providerCallId}`);
  const snap = await getVoice().getCall(providerCallId);
  await db
    .update(calls)
    .set({
      transcript: snap.transcript ?? call.transcript,
      durationSec: snap.durationSec ?? call.durationSec,
      status: ORDER[call.status] < 4 ? (snap.status === "in_progress" ? "ended" : snap.status) : call.status,
      endedAt: call.endedAt ?? new Date(),
    })
    .where(eq(calls.id, call.id));
  await finishCall(call.id);
}

/** Hands a finished call to whoever owns it, exactly once (claimed via `finishedAt`). */
export async function finishCall(callId: string): Promise<void> {
  const claimed = await db
    .update(calls)
    .set({ finishedAt: new Date() })
    .where(and(eq(calls.id, callId), isNull(calls.finishedAt)))
    .returning();
  const call = claimed[0];
  if (!call) return;
  if (call.kind === "business" && call.taskId) {
    const { onBusinessCallFinished } = await import("../orchestrator");
    await onBusinessCallFinished(call.taskId);
  } else if (call.kind === "user_inbound" || call.kind === "user_update") {
    const { handleUserCallFinished } = await import("../concierge");
    await handleUserCallFinished(call.id);
  }
}

export { getCall };
