import { config } from "../config";
import type { EntityRefs, PartyRole, Trade } from "../domain/types";
import { AGENCIES, ASSETS, FIRM, ON_CALL_EXTRA, OWNERS, PROPERTIES, TENANCIES, UNITS, VENDORS } from "./data";
import type { Agency, Asset, OnCallPerson, Owner, Property, Tenancy, Unit, Vendor } from "./data";

export { FIRM };
export type { Agency, Asset, Owner, Property, Tenancy, Unit, Vendor };

const digits = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-10);

/** Phone overrides for a live demo: {"<party id>": "+1..."} in TELO_PORTFOLIO_PHONES. */
function overrides(): Record<string, string> {
  const raw = process.env.TELO_PORTFOLIO_PHONES;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    console.warn("[portfolio] TELO_PORTFOLIO_PHONES is not valid JSON; ignoring it");
    return {};
  }
}

const withPhone = <T extends { id: string; phone: string }>(x: T): T => {
  const o = overrides()[x.id];
  return o ? { ...x, phone: o } : x;
};

export const owners = (): Owner[] => OWNERS.map(withPhone);
export const tenancies = (): Tenancy[] => TENANCIES.map(withPhone);
export const vendors = (): Vendor[] => VENDORS.map(withPhone);
export const agencies = (): Agency[] => AGENCIES.map(withPhone);
export const properties = (): Property[] => PROPERTIES;
export const units = (): Unit[] => UNITS;
export const assets = (): Asset[] => ASSETS;

export const getOwner = (id: string | null | undefined) => owners().find((o) => o.id === id);
export const getProperty = (id: string | null | undefined) => PROPERTIES.find((p) => p.id === id);
export const getUnit = (id: string | null | undefined) => UNITS.find((u) => u.id === id);
export const getAsset = (id: string | null | undefined) => ASSETS.find((a) => a.id === id);
export const getTenancy = (id: string | null | undefined) => tenancies().find((t) => t.id === id);
export const getVendor = (id: string | null | undefined) => vendors().find((v) => v.id === id);
export const getAgency = (id: string | null | undefined) => agencies().find((a) => a.id === id);

/** The emergency page order: the manager first, then the rest of the on-call ladder. */
export function onCallLadder(): OnCallPerson[] {
  return [{ name: config.user.name, phone: config.user.phone }, ...ON_CALL_EXTRA.map((p) => ({ ...p, phone: overrides()[`oncall_${p.name.split(" ")[0].toLowerCase()}`] ?? p.phone }))];
}

export interface Party {
  role: PartyRole;
  id: string;
  name: string;
  phone: string | null;
}

/** Who a phone number belongs to: the manager, an owner, a tenant, a vendor or an agency. */
export function partyByPhone(phone: string | null | undefined): Party | null {
  const d = digits(phone);
  if (d.length < 10) return null;
  if (digits(config.user.phone) === d) return { role: "manager", id: config.user.id, name: config.user.name, phone: config.user.phone };
  const o = owners().find((x) => digits(x.phone) === d);
  if (o) return { role: "owner", id: o.id, name: o.name, phone: o.phone };
  const t = tenancies().find((x) => digits(x.phone) === d);
  if (t) return { role: "tenant", id: t.id, name: t.tenantName, phone: t.phone };
  const v = vendors().find((x) => digits(x.phone) === d);
  if (v) return { role: "vendor", id: v.id, name: v.name, phone: v.phone };
  const a = agencies().find((x) => digits(x.phone) === d);
  if (a) return { role: "agency", id: a.id, name: a.name, phone: a.phone };
  return null;
}

/** Everything about one tenancy's home: unit, property, owner and the unit's assets. */
export function homeOf(tenancyId: string) {
  const tenancy = getTenancy(tenancyId);
  const unit = getUnit(tenancy?.unitId);
  const property = getProperty(unit?.propertyId);
  const owner = getOwner(property?.ownerId);
  if (!tenancy || !unit || !property || !owner) return null;
  return { tenancy, unit, property, owner, assets: ASSETS.filter((a) => a.unitId === unit.id) };
}

/** The refs (stream ids) for work at one unit. */
export function unitRefs(unitId: string, extra: EntityRefs = {}): EntityRefs {
  const unit = getUnit(unitId);
  const property = getProperty(unit?.propertyId);
  const tenancy = TENANCIES.find((t) => t.unitId === unitId);
  return { unit: unitId, property: property?.id, owner: property?.ownerId, tenancy: tenancy?.id, ...extra };
}

/** Approved vendors for a trade, in the seeded order (the scorecard reorders them). */
export function vendorsFor(trade: Trade): Vendor[] {
  return vendors().filter((v) => v.approved && v.trades.includes(trade));
}

/** The asset a trade's problem most likely concerns, e.g. hvac -> the unit's AC or furnace. */
export function assetFor(unitId: string, trade: Trade, hint?: string): Asset | undefined {
  const mine = ASSETS.filter((a) => a.unitId === unitId);
  const h = (hint ?? "").toLowerCase();
  if (/water heater|hot water/.test(h)) return mine.find((a) => a.type === "water_heater");
  if (/fridge|refrigerator/.test(h)) return mine.find((a) => a.type === "fridge");
  if (/dishwasher/.test(h)) return mine.find((a) => a.type === "dishwasher");
  if (/heat|furnace/.test(h) && !/\bac\b|a\/c|cool/.test(h)) return mine.find((a) => a.type === "furnace" || a.type === "heat_pump");
  if (trade === "hvac") return mine.find((a) => a.type === "ac") ?? mine.find((a) => a.type === "furnace" || a.type === "heat_pump");
  if (trade === "plumbing" && /leak|water/.test(h)) return undefined;
  if (trade === "appliance") return mine.find((a) => ["fridge", "range", "dishwasher", "washer", "dryer"].includes(a.type));
  if (trade === "roof") return ASSETS.find((a) => a.type === "roof" && UNITS.find((u) => u.id === unitId)?.propertyId === UNITS.find((u) => u.id === a.unitId)?.propertyId);
  return undefined;
}

/** Display names for every portfolio entity, so query results can be read back as names (never sent to Keewano). */
export function entityNames(): { kind: string; id: string; name: string }[] {
  return [
    ...owners().map((o) => ({ kind: "owner", id: o.id, name: o.name })),
    ...PROPERTIES.map((p) => ({ kind: "property", id: p.id, name: p.name })),
    ...UNITS.map((u) => ({ kind: "unit", id: u.id, name: u.label })),
    ...ASSETS.map((a) => ({ kind: "asset", id: a.id, name: `${a.type.replace(/_/g, " ")} at ${getUnit(a.unitId)?.label}` })),
    ...vendors().map((v) => ({ kind: "vendor", id: v.id, name: v.name })),
    ...tenancies().map((t) => ({ kind: "tenancy", id: t.id, name: `${getUnit(t.unitId)?.label} lease` })),
    ...agencies().map((a) => ({ kind: "agency", id: a.id, name: a.name })),
  ];
}

/** The seeded 555-01xx numbers are fictional: a real line never dials or texts them. */
export function isFictional(phone: string | null | undefined): boolean {
  return /^(\+?1)?\d{3}55501\d{2}$/.test((phone ?? "").replace(/[^\d+]/g, ""));
}

/** The portfolio vendor a call or task target names (by name, or by the org key derived from it). */
/** Email overrides for a live demo: {"<party id>": "name@example.com"} in TELO_PORTFOLIO_EMAILS. */
function emailOverrides(): Record<string, string> {
  const raw = process.env.TELO_PORTFOLIO_EMAILS;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    console.warn("[portfolio] TELO_PORTFOLIO_EMAILS is not valid JSON; ignoring it");
    return {};
  }
}

function partyById(id: string): Party | null {
  const o = getOwner(id);
  if (o) return { role: "owner", id: o.id, name: o.name, phone: o.phone };
  const t = getTenancy(id);
  if (t) return { role: "tenant", id: t.id, name: t.tenantName, phone: t.phone };
  const v = getVendor(id);
  if (v) return { role: "vendor", id: v.id, name: v.name, phone: v.phone };
  const a = getAgency(id);
  if (a) return { role: "agency", id: a.id, name: a.name, phone: a.phone };
  return null;
}

/** Who sent an email, by the address mapped in TELO_PORTFOLIO_EMAILS. */
export function partyByEmail(address: string | null | undefined): Party | null {
  const a = (address ?? "").trim().toLowerCase();
  if (!a) return null;
  const id = Object.entries(emailOverrides()).find(([, e]) => e.trim().toLowerCase() === a)?.[0];
  return id ? partyById(id) : null;
}

/** A tenant, owner or vendor by the name an email gives (a person's full name, or the vendor's company). */
export function partyByName(name: string | null | undefined): Party | null {
  const n = (name ?? "").trim().toLowerCase();
  if (n.length < 3) return null;
  const t = tenancies().find((x) => x.tenantName.toLowerCase() === n);
  if (t) return { role: "tenant", id: t.id, name: t.tenantName, phone: t.phone };
  const o = owners().find((x) => x.name.toLowerCase() === n);
  if (o) return { role: "owner", id: o.id, name: o.name, phone: o.phone };
  const v = vendorByName(name);
  return v ? { role: "vendor", id: v.id, name: v.name, phone: v.phone } : null;
}

/** The names an email might come from, for the model reading it. */
export function portfolioNames() {
  return { tenants: tenancies().map((t) => t.tenantName), owners: owners().map((o) => o.name), vendors: vendors().map((v) => v.name) };
}

export function vendorByName(name: string | null | undefined): Vendor | undefined {
  const key = (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!key) return undefined;
  return vendors().find((v) => {
    const k = v.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return k === key || k.replace(/and/g, "") === key.replace(/and/g, "") || (key.length >= 6 && (k.startsWith(key) || key.startsWith(k)));
  });
}

/** How a person says an asset type: "AC", "water heater". */
export function assetLabel(type: string): string {
  return ({ ac: "AC", water_heater: "water heater", heat_pump: "heat pump", garage_door: "garage door" } as Record<string, string>)[type] ?? type.replace(/_/g, " ");
}
