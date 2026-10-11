import { describe, expect, it } from "vitest";
import { CATALOG, catalogHash, entityUuid, keewanoEntitiesFor, summarizeTyped, toKeewanoEvents, uuidv5 } from "../src/server/memory/keewano";

const id = (name: string) => CATALOG.find((c) => c.name === name)!.eventTypeId;

describe("Keewano event mapping", () => {
  const commitment = {
    type: "commitment.received",
    occurredAt: "2026-10-02T17:15:03.000Z",
    typed: { commitmentKind: "account_credit", amountCents: 2000, confirmationNumber: "A1832" },
  };

  it("sends context first and the anchor last, all at the event's second", () => {
    const events = toKeewanoEvents(commitment, "relationship");
    expect(events.map((e) => e.eventTypeId)).toEqual([id("entity_kind"), id("confirmation_number"), id("commitment_amount_cents"), id("commitment_received")]);
    expect(new Set(events.map((e) => e.timestamp)).size).toBe(1);
    expect(events.at(-1)).toMatchObject({ dataType: "string", data: "account_credit" });
    expect(events[2]).toMatchObject({ dataType: "price_usd_cent", data: 2000 });
  });

  it("keeps confirmation numbers off the cross-user business stream", () => {
    const events = toKeewanoEvents(commitment, "org");
    expect(events.some((e) => e.eventTypeId === id("confirmation_number"))).toBe(false);
  });

  it("sends nothing for local-only events", () => {
    expect(toKeewanoEvents({ type: "business.fact_discovered", occurredAt: commitment.occurredAt, typed: null }, "task")).toEqual([]);
    expect(toKeewanoEvents({ type: "memory.retrieved", occurredAt: commitment.occurredAt, typed: { outcome: "x" } }, "task")).toEqual([]);
  });

  it("fans an event out to the relationship, business, task and user streams", () => {
    const refs = keewanoEntitiesFor({ userId: "usr_1", taskId: "tsk_1", orgKey: "comcast", type: "commitment.received" });
    expect(refs.map((r) => r.type)).toEqual(["relationship", "org", "task", "user"]);
    const msg = keewanoEntitiesFor({ userId: "usr_1", taskId: "tsk_1", orgKey: "comcast", type: "message.sent" });
    expect(msg.map((r) => r.type)).not.toContain("org");
  });

  it("derives stable UUIDs and a stable, non-zero catalog hash", () => {
    const a = uuidv5("rel:usr_1:comcast", "6ba7b811-9dad-11d1-80b4-00c04fd430c8");
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidv5("rel:usr_1:comcast", "6ba7b811-9dad-11d1-80b4-00c04fd430c8")).toBe(a);
    expect(entityUuid({ type: "relationship", id: "usr_1:comcast" })).toBe(entityUuid({ type: "relationship", id: "usr_1:comcast" }));
    expect(catalogHash()).toBeGreaterThan(0);
    expect(catalogHash()).toBe(catalogHash());
  });

  it("writes catalog ids in the custom range", () => {
    for (const c of CATALOG) expect(c.eventTypeId).toBeGreaterThanOrEqual(2000);
    expect(new Set(CATALOG.map((c) => c.eventTypeId)).size).toBe(CATALOG.length);
  });

  it("reads back as a sentence", () => {
    expect(summarizeTyped("commitment.received", commitment.typed)).toBe("Promise made: account credit $20.00 (confirmation A1832)");
  });
});

describe("Keewano catalog for property management", () => {
  it("is append-only: the original entries keep their ids and the P0 entries follow from 2026", () => {
    const legacy = ["entity_kind", "task_created", "task_completed", "memory_brief_used", "call_started", "hold_seconds", "call_duration_seconds", "call_ended", "offer_amount_cents", "offer_received", "offer_accepted", "offer_declined", "confirmation_number", "commitment_amount_cents", "commitment_due_at", "commitment_received", "commitment_fulfilled", "commitment_broken", "confirmation_received", "approval_amount_cents", "approval_requested", "approval_granted", "approval_denied", "message_sent", "email_received", "email_amount_cents"];
    expect(CATALOG.slice(0, legacy.length).map((c) => c.name)).toEqual(legacy);
    CATALOG.forEach((c, i) => expect(c.eventTypeId).toBe(2000 + i));
    expect(id("wo_opened")).toBe(2026);
    expect(id("call_party")).toBe(2072);
  });

  it("maps a work order with its context first and the trade as the anchor", () => {
    const events = toKeewanoEvents({ type: "wo.opened", occurredAt: "2026-10-11T02:00:00.000Z", typed: { trade: "hvac", severity: "urgent", intakeChannel: "mms", photoCount: 2 } }, "unit");
    expect(events.map((e) => e.eventTypeId)).toEqual([id("entity_kind"), id("severity"), id("intake_channel"), id("photo_count"), id("wo_opened")]);
    expect(events[0].data).toBe("unit");
    expect(events.at(-1)?.data).toBe("hvac");
  });

  it("fans portfolio events out to the streams in the research doc", () => {
    const refs = { unit: "unit_alder_b", property: "prop_alder", owner: "own_shah", tenancy: "ten_alder_b", vendor: "ven_rapidair", asset: "ast_alder_b_ac" };
    const kinds = (type: string, typed = {}) => keewanoEntitiesFor({ userId: "usr_1", taskId: "tsk_1", orgKey: null, type, refs, typed }).map((r) => r.type);
    expect(kinds("wo.opened")).toEqual(["task", "unit", "property", "owner", "tenancy", "pm"]);
    expect(kinds("quote.received")).toEqual(["vendor", "task", "unit"]);
    expect(kinds("approval.granted")).toEqual(["owner", "task", "pm"]);
    expect(kinds("asset.repaired")).toEqual(["asset", "unit", "owner"]);
    expect(kinds("commitment.broken", { commitmentKind: "arrival" })).toEqual(["vendor", "task"]);
    expect(kinds("commitment.broken", { commitmentKind: "payment" })).toEqual(["tenancy", "task"]);
    expect(kinds("call.completed", { callParty: "owner" })).toEqual(["task", "owner", "pm"]);
  });

  it("reads portfolio events back as sentences", () => {
    expect(summarizeTyped("vendor.outcome", { vendorOutcome: "no_show" })).toBe("Vendor no-show");
    expect(summarizeTyped("quote.received", { trade: "hvac", jobCode: "ac_no_cool", quoteCents: 65_000, earliestSlotHours: 3 })).toBe("Quote: ac no cool $650.00, earliest in 3 h");
  });
});
