import { config } from "../config";
import { db } from "../db/client";
import { eq } from "drizzle-orm";
import { appState, events } from "../db/schema";
import type { EntityRefs, Severity, Trade, TypedFacts } from "../domain/types";
import type { TeloEventType } from "../memory/events";
import { ASSETS } from "./data";
import { assetLabel, getAsset, getOwner, getProperty, getUnit, getVendor, unitRefs } from "./index";

// The portfolio's history before Telo: work orders the manager ran by hand
// over the past months. It's what Keewano knows on day one, and what changes
// Telo's first decisions: Unit B's AC has failed twice since June, CoolBreeze
// has no-showed twice, and water heaters cost about $1,800 to replace.
// manager_touches here is the "before" number (label it as seeded on slides).
//
// Ids are fixed, so loading it twice changes nothing. Times are relative to
// when it's loaded.

interface Visit {
  outcome: "on_time" | "late" | "no_show";
  lateMinutes?: number;
  access?: "done" | "no_access";
}

interface SeedWorkOrder {
  key: string;
  daysAgo: number;
  hour: number;
  unit: string;
  trade: Trade;
  severity: Severity;
  channel: "sms" | "mms" | "call";
  photos: number;
  asset?: string;
  jobCode: string;
  problem: string;
  emergency?: { kind: string; route: "vendor" | "oncall"; secsToHuman: number };
  callback?: { vendor: string; daysSinceDone: number };
  quotes: { vendor: string; cents: number; trip: number; warrantyDays: number; slotHours: number }[];
  declined?: { vendor: string; reason: "busy" | "out_of_area" | "no_answer" | "price" }[];
  approval?: { kind: "repair" | "replace" | "emergency"; cents: number; channel: "sms" | "voice"; responseSeconds: number; granted: boolean };
  booked: { vendor: string; rank: number; cents: number };
  visits: Visit[];
  done: { outcome: "fixed_first_visit" | "fixed_multi_visit" | "not_fixed"; daysToFix: number; overQuotePct: number; touches: number };
  repairCents?: number;
  repeat90?: boolean;
  decision?: { decision: "repair" | "replace" | "defer"; replaceCents: number };
}

export const SEED_WORK_ORDERS: SeedWorkOrder[] = [
  {
    key: "linden_furnace_feb", daysAgo: 240, hour: 7, unit: "unit_linden_house", trade: "hvac", severity: "urgent", channel: "call", photos: 0,
    asset: "ast_linden_furnace", jobCode: "furnace_no_heat", problem: "No heat",
    quotes: [{ vendor: "ven_coolbreeze", cents: 27_500, trip: 8_900, warrantyDays: 30, slotHours: 26 }, { vendor: "ven_rapidair", cents: 34_000, trip: 12_900, warrantyDays: 90, slotHours: 3 }],
    booked: { vendor: "ven_rapidair", rank: 2, cents: 34_000 }, visits: [{ outcome: "on_time", access: "done" }],
    done: { outcome: "fixed_first_visit", daysToFix: 1, overQuotePct: 0, touches: 5 }, repairCents: 34_000,
  },
  {
    key: "pine1_roof_mar", daysAgo: 200, hour: 10, unit: "unit_pine_1", trade: "roof", severity: "urgent", channel: "mms", photos: 4,
    asset: "ast_pine_roof", jobCode: "roof_leak_patch", problem: "Ceiling stain after rain",
    quotes: [{ vendor: "ven_handyhank", cents: 45_000, trip: 6_500, warrantyDays: 30, slotHours: 24 }],
    booked: { vendor: "ven_handyhank", rank: 1, cents: 45_000 }, visits: [{ outcome: "on_time", access: "done" }],
    done: { outcome: "fixed_first_visit", daysToFix: 2, overQuotePct: 0, touches: 6 }, repairCents: 45_000,
    decision: { decision: "defer", replaceCents: 1_480_000 },
  },
  {
    key: "linden_wh_may", daysAgo: 150, hour: 8, unit: "unit_linden_house", trade: "plumbing", severity: "urgent", channel: "call", photos: 0,
    asset: "ast_linden_wh", jobCode: "wh_replace", problem: "Water heater leaking from the tank",
    quotes: [{ vendor: "ven_summit", cents: 185_000, trip: 7_900, warrantyDays: 365, slotHours: 24 }, { vendor: "ven_flowright", cents: 215_000, trip: 14_900, warrantyDays: 730, slotHours: 6 }],
    approval: { kind: "replace", cents: 185_000, channel: "voice", responseSeconds: 1_500, granted: true },
    booked: { vendor: "ven_summit", rank: 1, cents: 185_000 }, visits: [{ outcome: "on_time", access: "done" }],
    done: { outcome: "fixed_first_visit", daysToFix: 2, overQuotePct: 0, touches: 8 }, decision: { decision: "replace", replaceCents: 185_000 },
  },
  {
    key: "linden_leak_jun", daysAgo: 130, hour: 2, unit: "unit_linden_house", trade: "plumbing", severity: "emergency", channel: "call", photos: 0,
    jobCode: "supply_line_burst", problem: "Water pouring from under the kitchen sink at 2 AM",
    emergency: { kind: "water", route: "vendor", secsToHuman: 1_800 },
    quotes: [{ vendor: "ven_flowright", cents: 68_000, trip: 14_900, warrantyDays: 90, slotHours: 1 }],
    declined: [{ vendor: "ven_dripfix", reason: "no_answer" }],
    booked: { vendor: "ven_flowright", rank: 1, cents: 68_000 }, visits: [{ outcome: "on_time", access: "done" }],
    done: { outcome: "fixed_first_visit", daysToFix: 1, overQuotePct: 5, touches: 9 },
  },
  {
    key: "alderb_ac_jun", daysAgo: 115, hour: 19, unit: "unit_alder_b", trade: "hvac", severity: "urgent", channel: "mms", photos: 2,
    asset: "ast_alder_b_ac", jobCode: "ac_no_cool", problem: "AC blowing warm air",
    quotes: [{ vendor: "ven_coolbreeze", cents: 24_000, trip: 8_900, warrantyDays: 30, slotHours: 20 }],
    booked: { vendor: "ven_coolbreeze", rank: 1, cents: 24_000 }, visits: [{ outcome: "on_time", access: "done" }],
    done: { outcome: "fixed_first_visit", daysToFix: 2, overQuotePct: 0, touches: 6 }, repairCents: 24_000, repeat90: false,
  },
  {
    key: "linden_dw_jul", daysAgo: 100, hour: 12, unit: "unit_linden_house", trade: "appliance", severity: "routine", channel: "sms", photos: 1,
    asset: "ast_linden_dishwasher", jobCode: "dishwasher_not_draining", problem: "Dishwasher not draining",
    quotes: [{ vendor: "ven_applianceworks", cents: 16_000, trip: 8_500, warrantyDays: 90, slotHours: 48 }],
    booked: { vendor: "ven_applianceworks", rank: 1, cents: 16_000 }, visits: [{ outcome: "on_time", access: "no_access" }, { outcome: "on_time", access: "done" }],
    done: { outcome: "fixed_multi_visit", daysToFix: 5, overQuotePct: 0, touches: 7 }, repairCents: 16_000,
  },
  {
    key: "pine3_leak_jul", daysAgo: 90, hour: 9, unit: "unit_pine_3", trade: "plumbing", severity: "urgent", channel: "mms", photos: 3,
    jobCode: "sink_leak", problem: "Leak under the bathroom sink",
    quotes: [{ vendor: "ven_dripfix", cents: 18_500, trip: 9_500, warrantyDays: 30, slotHours: 6 }, { vendor: "ven_flowright", cents: 26_000, trip: 14_900, warrantyDays: 90, slotHours: 2 }],
    booked: { vendor: "ven_dripfix", rank: 1, cents: 18_500 }, visits: [{ outcome: "on_time", access: "no_access" }, { outcome: "on_time", access: "done" }],
    done: { outcome: "fixed_multi_visit", daysToFix: 3, overQuotePct: 0, touches: 7 },
  },
  {
    key: "alder_a_ac_jul", daysAgo: 85, hour: 15, unit: "unit_alder_a", trade: "hvac", severity: "routine", channel: "sms", photos: 1,
    asset: "ast_alder_a_ac", jobCode: "ac_no_cool", problem: "AC not keeping up in the afternoon",
    quotes: [{ vendor: "ven_coolbreeze", cents: 19_500, trip: 8_900, warrantyDays: 30, slotHours: 30 }],
    booked: { vendor: "ven_coolbreeze", rank: 1, cents: 19_500 }, visits: [{ outcome: "no_show" }, { outcome: "on_time", access: "done" }],
    done: { outcome: "fixed_multi_visit", daysToFix: 4, overQuotePct: 0, touches: 8 }, repairCents: 19_500,
  },
  {
    key: "pine4_lock_aug", daysAgo: 70, hour: 21, unit: "unit_pine_4", trade: "locks", severity: "urgent", channel: "call", photos: 0,
    jobCode: "lock_rekey", problem: "Front door lock sticking, key won't turn",
    quotes: [{ vendor: "ven_handyhank", cents: 12_000, trip: 6_500, warrantyDays: 30, slotHours: 4 }],
    booked: { vendor: "ven_handyhank", rank: 1, cents: 12_000 }, visits: [{ outcome: "no_show" }, { outcome: "late", lateMinutes: 60, access: "done" }],
    done: { outcome: "fixed_multi_visit", daysToFix: 2, overQuotePct: 25, touches: 7 },
  },
  {
    key: "alder_a_wh_aug", daysAgo: 60, hour: 8, unit: "unit_alder_a", trade: "plumbing", severity: "routine", channel: "sms", photos: 2,
    asset: "ast_alder_a_wh", jobCode: "wh_replace", problem: "Water heater rusted at the base, lukewarm water",
    quotes: [{ vendor: "ven_summit", cents: 172_500, trip: 7_900, warrantyDays: 365, slotHours: 72 }, { vendor: "ven_dripfix", cents: 199_000, trip: 9_500, warrantyDays: 365, slotHours: 48 }],
    approval: { kind: "replace", cents: 172_500, channel: "sms", responseSeconds: 240, granted: true },
    booked: { vendor: "ven_summit", rank: 1, cents: 172_500 }, visits: [{ outcome: "on_time", access: "done" }],
    done: { outcome: "fixed_first_visit", daysToFix: 4, overQuotePct: 0, touches: 6 }, decision: { decision: "replace", replaceCents: 172_500 },
  },
  {
    key: "alderb_ac_aug", daysAgo: 50, hour: 18, unit: "unit_alder_b", trade: "hvac", severity: "urgent", channel: "call", photos: 0,
    asset: "ast_alder_b_ac", jobCode: "ac_no_cool", problem: "AC out again, house is 88 degrees",
    callback: { vendor: "ven_coolbreeze", daysSinceDone: 63 },
    quotes: [{ vendor: "ven_coolbreeze", cents: 31_000, trip: 8_900, warrantyDays: 30, slotHours: 18 }],
    booked: { vendor: "ven_coolbreeze", rank: 1, cents: 31_000 }, visits: [{ outcome: "no_show" }, { outcome: "late", lateMinutes: 45, access: "done" }],
    done: { outcome: "fixed_multi_visit", daysToFix: 5, overQuotePct: 12, touches: 9 }, repairCents: 31_000, repeat90: true,
  },
  {
    key: "linden_adu_outlet_sep", daysAgo: 40, hour: 17, unit: "unit_linden_adu", trade: "electrical", severity: "urgent", channel: "call", photos: 0,
    jobCode: "outlet_dead", problem: "Kitchen outlets dead",
    quotes: [{ vendor: "ven_brightspark", cents: 16_500, trip: 9_900, warrantyDays: 90, slotHours: 20 }],
    booked: { vendor: "ven_brightspark", rank: 1, cents: 16_500 }, visits: [{ outcome: "on_time", access: "done" }],
    done: { outcome: "fixed_first_visit", daysToFix: 1, overQuotePct: 0, touches: 4 },
  },
  {
    key: "pine3_fridge_sep", daysAgo: 30, hour: 11, unit: "unit_pine_3", trade: "appliance", severity: "routine", channel: "sms", photos: 1,
    asset: "ast_pine_3_fridge", jobCode: "fridge_not_cooling", problem: "Fridge warm, freezer fine",
    quotes: [{ vendor: "ven_applianceworks", cents: 21_000, trip: 8_500, warrantyDays: 90, slotHours: 48 }],
    booked: { vendor: "ven_applianceworks", rank: 1, cents: 21_000 }, visits: [{ outcome: "late", lateMinutes: 20, access: "done" }],
    done: { outcome: "fixed_first_visit", daysToFix: 3, overQuotePct: 8, touches: 5 }, repairCents: 21_000,
  },
  {
    key: "alderb_wh_sep", daysAgo: 20, hour: 9, unit: "unit_alder_b", trade: "plumbing", severity: "routine", channel: "sms", photos: 1,
    asset: "ast_alder_b_wh", jobCode: "wh_pilot", problem: "Water heater pilot keeps going out",
    quotes: [{ vendor: "ven_dripfix", cents: 14_500, trip: 9_500, warrantyDays: 30, slotHours: 24 }],
    booked: { vendor: "ven_dripfix", rank: 1, cents: 14_500 }, visits: [{ outcome: "on_time", access: "done" }],
    done: { outcome: "fixed_first_visit", daysToFix: 1, overQuotePct: 0, touches: 5 }, repairCents: 14_500,
  },
];

type Row = typeof events.$inferInsert;

/** All seeded events, oldest first. Pure: the same `now` gives the same rows. */
export function portfolioHistoryRows(now = new Date()): Row[] {
  const userId = config.user.id;
  const rows: Row[] = [];
  const at = (daysAgo: number, hour: number, minute: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, 0, 0, 0);
    return new Date(d.getTime() + minute * 60_000);
  };
  const push = (id: string, type: TeloEventType, occurredAt: Date, summary: string, typed: TypedFacts, refs: EntityRefs, taskId: string | null) =>
    rows.push({ id: `evt_pf_${id}`, userId, taskId, type, summary, typed, refs, occurredAt, data: { seeded: true } });

  // Every asset on file, a few minutes apart, before any work order.
  ASSETS.forEach((a, i) =>
    push(`asset_${a.id}`, "asset.registered", at(270, 9, i * 3), `On file: ${assetLabel(a.type)} at ${getUnit(a.unitId)?.label}, installed ${a.installYear}`, { assetType: a.type, installYear: a.installYear }, { asset: a.id, unit: a.unitId }, null),
  );

  for (const w of SEED_WORK_ORDERS) {
    const task = `tsk_seed_${w.key}`;
    const unit = getUnit(w.unit)!;
    const base = unitRefs(w.unit, w.asset ? { asset: w.asset } : {});
    const owner = getOwner(getProperty(unit.propertyId)?.ownerId);
    const t = (minute: number, dayOffset = 0) => at(w.daysAgo - dayOffset, w.hour, minute);
    let n = 0;
    const id = () => `${w.key}_${n++}`;

    push(id(), "wo.opened", t(0), `Work order: ${w.problem} at ${unit.label}`, { trade: w.trade, severity: w.severity, intakeChannel: w.channel, photoCount: w.photos }, base, task);
    if (w.callback) {
      push(id(), "callback.opened", t(1), `${getVendor(w.callback.vendor)?.name}'s ${w.trade} repair failed again after ${w.callback.daysSinceDone} days`, { trade: w.trade, daysSinceDone: w.callback.daysSinceDone }, { vendor: w.callback.vendor, unit: w.unit }, task);
    }
    if (w.emergency) {
      push(id(), "emergency.routed", t(2), `Emergency (${w.emergency.kind}) routed to ${w.emergency.route}`, { emergencyKind: w.emergency.kind, emergencyRoute: w.emergency.route, secsToHuman: w.emergency.secsToHuman }, base, task);
    }
    for (const d of w.declined ?? []) {
      push(id(), "vendor.declined", t(20), `${getVendor(d.vendor)?.name} declined (${d.reason.replace(/_/g, " ")})`, { declineReason: d.reason }, { ...base, vendor: d.vendor }, task);
    }
    w.quotes.forEach((q, i) =>
      push(id(), "quote.received", t(40 + i * 7), `Quote from ${getVendor(q.vendor)?.name}: $${(q.cents / 100).toFixed(0)}, earliest in ${q.slotHours} h`, { trade: w.trade, jobCode: w.jobCode, quoteCents: q.cents, tripFeeCents: q.trip, warrantyDays: q.warrantyDays, earliestSlotHours: q.slotHours }, { ...base, vendor: q.vendor }, task),
    );
    if (w.approval) {
      const a = w.approval;
      push(id(), "approval.requested", t(70), `Asked ${owner?.name} to approve $${(a.cents / 100).toFixed(0)} (${a.kind})`, { approvalKind: a.kind, amountCents: a.cents, approvalChannel: a.channel, approvalWhileHolding: false }, base, task);
      push(id(), a.granted ? "approval.granted" : "approval.denied", t(70 + Math.round(a.responseSeconds / 60) + 1), `${owner?.name} ${a.granted ? "approved" : "declined"} ($${(a.cents / 100).toFixed(0)})`, { approvalKind: a.kind, amountCents: a.cents, approvalChannel: a.channel, approvalResponseSeconds: a.responseSeconds, approvalWhileHolding: false }, base, task);
    }
    const vendor = getVendor(w.booked.vendor)!;
    push(id(), "vendor.booked", t(110), `Booked ${vendor.name}: $${(w.booked.cents / 100).toFixed(0)}`, { trade: w.trade, dispatchRank: w.booked.rank, bookedCents: w.booked.cents }, { ...base, vendor: vendor.id }, task);
    if (w.severity !== "emergency") {
      push(id(), "entry_notice.sent", t(115), `Entry notice sent to ${unit.label}`, { noticePurpose: "repair", noticeHours: 24, noticeMethod: "sms" }, base, task);
    }
    w.visits.forEach((v, i) => {
      // An emergency vendor comes the same night, after the booking; others the next days.
      const day = w.severity === "emergency" ? 0 : 1 + i;
      const minute = w.severity === "emergency" ? 130 : 0;
      const due = t(minute, day);
      push(id(), "commitment.received", t(118 + i, i === 0 ? 0 : day - 1), `${vendor.name} promised to arrive`, { commitmentKind: "arrival", dueAt: due.toISOString() }, { ...base, vendor: vendor.id }, task);
      push(id(), "vendor.outcome", t(minute + (v.lateMinutes ?? 0) + 5, day), `${vendor.name}: ${v.outcome === "no_show" ? "no-show" : v.outcome.replace(/_/g, " ")}`, { vendorOutcome: v.outcome, lateMinutes: v.lateMinutes ?? 0 }, { ...base, vendor: vendor.id }, task);
      push(id(), v.outcome === "no_show" ? "commitment.broken" : "commitment.fulfilled", t(minute + (v.lateMinutes ?? 0) + 6, day), `${vendor.name}'s arrival promise ${v.outcome === "no_show" ? "broken" : "kept"}`, { commitmentKind: "arrival", commitmentLateMinutes: v.outcome === "no_show" ? undefined : v.lateMinutes ?? 0 }, { ...base, vendor: vendor.id }, task);
      if (v.access) push(id(), "access.outcome", t(minute + (v.lateMinutes ?? 0) + 7, day), `Access at ${unit.label}: ${v.access.replace(/_/g, " ")}`, { accessOutcome: v.access, reschedules: i }, base, task);
    });
    const closeDay = w.done.daysToFix;
    if (w.repairCents && w.asset) {
      push(id(), "asset.repaired", t(200, closeDay), `Repaired the ${assetLabel(getAsset(w.asset)!.type)} at ${unit.label}: $${(w.repairCents / 100).toFixed(0)}`, { assetType: getAsset(w.asset)!.type, repairCents: w.repairCents, repeatWithin90d: w.repeat90 ?? false }, { asset: w.asset, unit: w.unit, owner: owner?.id }, task);
    }
    if (w.decision && w.asset) {
      const asset = getAsset(w.asset)!;
      push(id(), "asset.decision", t(205, closeDay), `${owner?.name} chose to ${w.decision.decision} the ${assetLabel(asset.type)} at ${unit.label}`, { decision: w.decision.decision, replaceCents: w.decision.replaceCents, assetAgeYears: now.getFullYear() - asset.installYear }, { asset: asset.id, owner: owner?.id }, task);
    }
    push(id(), "wo.completed", t(210, closeDay), `Closed: ${w.problem} at ${unit.label} (${w.done.outcome.replace(/_/g, " ")})`, { woOutcome: w.done.outcome, visits: w.visits.length, daysToFix: w.done.daysToFix, invoiceOverQuotePct: w.done.overQuotePct, tenantConfirmed: true, managerTouches: w.done.touches }, { ...base, vendor: vendor.id }, task);
  }
  return rows.sort((a, b) => (a.occurredAt as Date).getTime() - (b.occurredAt as Date).getTime());
}

/** Loads the portfolio's history into the events table (the outbox mirrors it to Keewano). Idempotent. */
export async function seedPortfolioHistory(): Promise<{ created: number; total: number; sent: boolean }> {
  // Keewano keeps everything and can't delete, and a reload can store the history again: it goes to
  // Keewano once. Loads after that (a board reset) are local only, marked as already synced.
  const sentBefore = Boolean(await db.query.appState.findFirst({ where: eq(appState.key, SENT_KEY) }));
  const syncedAt = sentBefore ? new Date() : null;
  const rows = portfolioHistoryRows().map((r) => (syncedAt ? { ...r, memorySyncedAt: syncedAt } : r));
  let created = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const res = await db.insert(events).values(rows.slice(i, i + 50)).onConflictDoNothing().returning({ id: events.id });
    created += res.length;
  }
  if (!sentBefore && config.memory.provider === "keewano") await db.insert(appState).values({ key: SENT_KEY, value: new Date().toISOString() }).onConflictDoNothing();
  return { created, total: rows.length, sent: !sentBefore };
}

const SENT_KEY = "portfolio.history_sent";
