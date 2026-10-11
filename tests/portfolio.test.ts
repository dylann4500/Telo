import { beforeAll, describe, expect, it } from "vitest";

// The seeded portfolio and its history: what Keewano knows on day one.
process.env.DATABASE_URL = "file:./data/test-portfolio.db";

type Mods = {
  history: typeof import("../src/server/portfolio/history");
  portfolio: typeof import("../src/server/portfolio");
  data: typeof import("../src/server/portfolio/data");
  keewano: typeof import("../src/server/memory/keewano");
  local: typeof import("../src/server/memory/local");
  client: typeof import("../src/server/db/client");
};
let m: Mods;

beforeAll(async () => {
  const { rmSync, mkdirSync } = await import("node:fs");
  mkdirSync("data", { recursive: true });
  for (const f of ["data/test-portfolio.db", "data/test-portfolio.db-shm", "data/test-portfolio.db-wal"]) rmSync(f, { force: true });
  m = {
    history: await import("../src/server/portfolio/history"),
    portfolio: await import("../src/server/portfolio"),
    data: await import("../src/server/portfolio/data"),
    keewano: await import("../src/server/memory/keewano"),
    local: await import("../src/server/memory/local"),
    client: await import("../src/server/db/client"),
  };
  await m.client.ensureDb();
});

describe("the seeded portfolio", () => {
  it("routes a phone number to its party", () => {
    expect(m.portfolio.partyByPhone("(415) 555-0122")).toMatchObject({ role: "tenant", id: "ten_alder_b", name: "Maria Gomez" });
    expect(m.portfolio.partyByPhone("+14155550111")).toMatchObject({ role: "owner", id: "own_shah" });
    expect(m.portfolio.partyByPhone("+14155550132")).toMatchObject({ role: "vendor", id: "ven_rapidair" });
    expect(m.portfolio.partyByPhone("+14155550199")).toBeNull();
  });

  it("knows a tenant's home: unit, property, owner and assets", () => {
    const home = m.portfolio.homeOf("ten_alder_b")!;
    expect(home.unit.label).toBe("1418 Alder St, Unit B");
    expect(home.owner).toMatchObject({ id: "own_shah", approvalLimitCents: 50_000 });
    expect(home.assets.map((a) => a.type)).toContain("ac");
    expect(m.portfolio.assetFor("unit_alder_b", "hvac", "the AC is out")?.id).toBe("ast_alder_b_ac");
  });
});

describe("the portfolio's history", () => {
  const rows = () => m.history.portfolioHistoryRows(new Date("2026-10-11T19:00:00-07:00"));

  it("sends only typed values to Keewano: no names, phone numbers or addresses", () => {
    const secrets = [
      ...m.data.TENANCIES.flatMap((t) => [t.tenantName, t.phone]),
      ...m.data.VENDORS.flatMap((v) => [v.name, v.phone]),
      ...m.data.OWNERS.flatMap((o) => [o.name, o.phone]),
      ...m.data.PROPERTIES.map((p) => p.name),
    ];
    for (const r of rows()) {
      const sent = JSON.stringify(m.keewano.toKeewanoEvents({ type: r.type, occurredAt: (r.occurredAt as Date).toISOString(), typed: r.typed ?? null }, "unit"));
      for (const s of secrets) expect(sent).not.toContain(s);
    }
  });

  it("puts every event on at least one portfolio stream", () => {
    for (const r of rows()) {
      const streams = m.keewano.keewanoEntitiesFor({ userId: "usr_default", taskId: r.taskId ?? null, orgKey: null, type: r.type, refs: r.refs, typed: r.typed });
      expect(streams.length, r.id).toBeGreaterThan(0);
      expect(m.keewano.toKeewanoEvents({ type: r.type, occurredAt: (r.occurredAt as Date).toISOString(), typed: r.typed ?? null }, streams[0].type).length, r.id).toBeGreaterThan(1);
    }
  });

  it("tells the demo's story: Unit B's AC failed twice since June, and CoolBreeze no-showed twice", () => {
    const all = rows();
    const acRepairs = all.filter((r) => r.type === "asset.repaired" && r.refs?.asset === "ast_alder_b_ac");
    expect(acRepairs).toHaveLength(2);
    const noShows = all.filter((r) => r.type === "vendor.outcome" && r.typed?.vendorOutcome === "no_show");
    expect(noShows.filter((r) => r.refs?.vendor === "ven_coolbreeze")).toHaveLength(2);
    expect(noShows.filter((r) => r.refs?.vendor === "ven_rapidair")).toHaveLength(0);
  });

  it("never stamps two events of one stream with the same second", () => {
    const seen = new Map<string, string>();
    for (const r of rows()) {
      for (const s of m.keewano.keewanoEntitiesFor({ userId: "usr_default", taskId: r.taskId ?? null, orgKey: null, type: r.type, refs: r.refs, typed: r.typed })) {
        const key = `${s.type}:${s.id}@${Math.floor((r.occurredAt as Date).getTime() / 1000)}`;
        expect(seen.get(key), `${r.id} collides with ${seen.get(key)}`).toBeUndefined();
        seen.set(key, r.id!);
      }
    }
  });

  it("loads once: a second load adds nothing, and local memory reads a vendor's stream", async () => {
    const first = await m.history.seedPortfolioHistory();
    expect(first.created).toBe(first.total);
    expect((await m.history.seedPortfolioHistory()).created).toBe(0);
    const tl = await new m.local.LocalMemory().timeline({ type: "vendor", id: "ven_coolbreeze" });
    expect(tl.events.filter((e) => e.type === "vendor.outcome" && e.typed?.vendorOutcome === "no_show")).toHaveLength(2);
  });
});
