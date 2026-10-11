import { describe, expect, it } from "vitest";
import { canTransition, sourcesFor } from "../src/server/domain/state-machine";
import { orgKeyFor } from "../src/server/ids";
import { containsSecret, maskSecrets, redactValue } from "../src/server/redact";
import { normalizeDialEvent, signDialPayload, verifyDialSignature } from "../src/server/voice/dial-webhook";
import { sanitizeForSms } from "../src/server/voice/provider";

describe("task state machine", () => {
  it("allows the happy path and blocks shortcuts", () => {
    expect(canTransition("new", "needs_info")).toBe(true);
    expect(canTransition("needs_info", "new")).toBe(true);
    expect(canTransition("ready", "calling")).toBe(true);
    expect(canTransition("calling", "reviewing")).toBe(true);
    expect(canTransition("reviewing", "needs_approval")).toBe(true);
    expect(canTransition("needs_approval", "reviewing")).toBe(true);
    expect(canTransition("new", "calling")).toBe(false); // never dial before planning
    expect(canTransition("completed", "calling")).toBe(false);
    expect(canTransition("cancelled", "new")).toBe(false);
  });
  it("only lets a call be placed from ready", () => {
    expect(sourcesFor("calling")).toEqual(["ready"]);
  });
});

describe("Dial webhook signatures", () => {
  const secret = "whsec_test_secret";
  const body = JSON.stringify({ id: "evt_1", type: "call.ended", data: { callId: "call_1" } });

  it("accepts a valid signature", () => {
    expect(verifyDialSignature(secret, signDialPayload(secret, body), body)).toBe(true);
  });
  it("rejects a wrong secret, a tampered body, a stale timestamp, and garbage", () => {
    const header = signDialPayload(secret, body);
    expect(verifyDialSignature("whsec_other", header, body)).toBe(false);
    expect(verifyDialSignature(secret, header, body.replace("call_1", "call_2"))).toBe(false);
    const old = signDialPayload(secret, body, Math.floor(Date.now() / 1000) - 3600);
    expect(verifyDialSignature(secret, old, body)).toBe(false);
    expect(verifyDialSignature(secret, null, body)).toBe(false);
    expect(verifyDialSignature(secret, "t=abc,v1=zz", body)).toBe(false);
  });
  it("tolerates spaces after the comma", () => {
    const header = signDialPayload(secret, body).replace(",", ", ");
    expect(verifyDialSignature(secret, header, body)).toBe(true);
  });
});

describe("Dial event normalization", () => {
  it("maps call and message events", () => {
    expect(
      normalizeDialEvent({ id: "e1", type: "call.status_changed", data: { callId: "c1", direction: "outbound", status: { state: "In-Progress" } } })[0],
    ).toMatchObject({ kind: "call.status", providerCallId: "c1", status: "in_progress" });
    expect(
      normalizeDialEvent({ id: "e2", type: "call.ended", data: { callId: "c1", status: "no-answer", durationSeconds: null, transcriptAvailable: false } })[0],
    ).toMatchObject({ kind: "call.ended", endReason: "no-answer", transcriptAvailable: false });
    expect(normalizeDialEvent({ id: "e3", type: "call.transcribed", data: { callId: "c1" } })[0]).toEqual({ kind: "call.transcribed", providerCallId: "c1" });
    expect(
      normalizeDialEvent({ id: "e4", type: "message.received", data: { messageId: "m1", from: "+14155550123", to: "+14155550100", body: "hi", channel: "imessage", source: "external" } })[0],
    ).toMatchObject({ kind: "message.received", from: "+14155550123", channel: "imessage" });
  });
  it("ignores dashboard test traffic and unknown types", () => {
    expect(normalizeDialEvent({ id: "e5", type: "message.received", data: { source: "internal" } })).toEqual([]);
    expect(normalizeDialEvent({ id: "e6", type: "webhook.ping", data: {} })).toEqual([]);
  });
});

describe("redaction", () => {
  it("masks account-like values but keeps short codes readable", () => {
    expect(redactValue("dylan@example.com")).toBe("d•••@example.com");
    expect(redactValue("4417 1234 5678 9113")).toBe("•••9113");
    expect(redactValue("A1832")).not.toContain("1832".padStart(10, "x"));
  });
  it("spots passwords, PINs and SSNs, but not account numbers", () => {
    expect(containsSecret("my password is hunter2")).toBe(true);
    expect(containsSecret("PIN 4821")).toBe(true);
    expect(containsSecret("ssn 123-45-6789")).toBe(true);
    expect(containsSecret("account number 8800 1234 5678")).toBe(false);
    expect(maskSecrets("the password is hunter2 ok")).toBe("the [withheld] ok");
  });
});

describe("helpers", () => {
  it("normalizes business names into stable keys", () => {
    expect(orgKeyFor("Comcast Xfinity, Inc.")).toBe("comcast-xfinity");
    expect(orgKeyFor("Bay Auto Glass")).toBe("bay-auto-glass");
  });
  it("keeps SMS text inside the plain-character set", () => {
    expect(sanitizeForSms("Done — it’s “booked”…")).toBe('Done - it\'s "booked"...');
  });
});
