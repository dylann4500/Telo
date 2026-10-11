import type { AssetType, Trade } from "../domain/types";

// The seeded portfolio: one small property-management firm with two owners,
// three properties and eight units. It stands in for property-management
// software, so the demo runs without any. Names and phone numbers stay in
// Telo's own database; Keewano only ever sees the opaque ids.
//
// Phone numbers default to fictional 555-01xx numbers, which nobody can be
// reached at. For a live demo, point a party at a real phone with
// TELO_PORTFOLIO_PHONES, e.g. {"ten_alder_b":"+14155550000","own_shah":"+1..."}.

export interface Owner {
  id: string;
  name: string;
  phone: string;
  /** How the owner prefers to be asked: a text, or a call. */
  channel: "sms" | "voice";
  approvalLimitCents: number;
  emergencyLimitCents: number;
}

export interface Property {
  id: string;
  name: string; // the street address, used as the property's name
  city: string;
  state: string; // drives entry-notice rules
  ownerId: string;
  kind: "single_family" | "duplex" | "fourplex";
  utilityId: string | null;
  warrantyId: string | null;
}

export interface Unit {
  id: string;
  propertyId: string;
  label: string;
  beds: number;
  baths: number;
  rentCents: number;
  accessNotes: string;
}

export interface Asset {
  id: string;
  unitId: string;
  type: AssetType;
  installYear: number;
  model: string;
}

export interface Tenancy {
  id: string;
  unitId: string;
  tenantName: string;
  phone: string;
  /** Consent to informational AI calls and texts about their own tenancy, given at lease signing. */
  aiConsent: boolean;
  rentCents: number;
  dueDay: number;
  accessWindows: string[];
}

export interface Vendor {
  id: string;
  name: string;
  phone: string;
  trades: Trade[];
  approved: boolean;
  tripFeeCents: number;
  afterHours: boolean;
  serviceArea: string;
}

export interface Agency {
  id: string;
  name: string;
  kind: "warranty" | "utility";
  phone: string;
}

export interface OnCallPerson {
  name: string;
  phone: string | null;
}

export const FIRM = {
  name: "Bayside Property Management",
  /** Spend Telo may commit to stop damage right now, before anyone approves. */
  emergencyCapCents: 150_000,
  callingHours: { start: 8, end: 20 },
};

export const OWNERS: Owner[] = [
  { id: "own_shah", name: "Priya Shah", phone: "+14155550111", channel: "sms", approvalLimitCents: 50_000, emergencyLimitCents: 150_000 },
  { id: "own_lee", name: "Marcus Lee", phone: "+14155550112", channel: "voice", approvalLimitCents: 75_000, emergencyLimitCents: 200_000 },
];

export const PROPERTIES: Property[] = [
  { id: "prop_alder", name: "1418 Alder St", city: "Oakland", state: "CA", ownerId: "own_shah", kind: "duplex", utilityId: "agy_baygas", warrantyId: "agy_homeshield" },
  { id: "prop_pine", name: "905 Pine Ave", city: "Oakland", state: "CA", ownerId: "own_shah", kind: "fourplex", utilityId: "agy_baygas", warrantyId: null },
  { id: "prop_linden", name: "22 Linden Ct", city: "San Leandro", state: "CA", ownerId: "own_lee", kind: "single_family", utilityId: "agy_baygas", warrantyId: "agy_homeshield" },
];

export const UNITS: Unit[] = [
  { id: "unit_alder_a", propertyId: "prop_alder", label: "1418 Alder St, Unit A", beds: 2, baths: 1, rentCents: 245_000, accessNotes: "Cat; keep the front door closed." },
  { id: "unit_alder_b", propertyId: "prop_alder", label: "1418 Alder St, Unit B", beds: 2, baths: 1, rentCents: 240_000, accessNotes: "Friendly dog; tenant prefers to be home for visits." },
  { id: "unit_pine_1", propertyId: "prop_pine", label: "905 Pine Ave, #1", beds: 1, baths: 1, rentCents: 185_000, accessNotes: "" },
  { id: "unit_pine_2", propertyId: "prop_pine", label: "905 Pine Ave, #2", beds: 1, baths: 1, rentCents: 189_500, accessNotes: "" },
  { id: "unit_pine_3", propertyId: "prop_pine", label: "905 Pine Ave, #3", beds: 1, baths: 1, rentCents: 192_500, accessNotes: "Works nights; mornings before 11 are hard." },
  { id: "unit_pine_4", propertyId: "prop_pine", label: "905 Pine Ave, #4", beds: 1, baths: 1, rentCents: 195_000, accessNotes: "" },
  { id: "unit_linden_house", propertyId: "prop_linden", label: "22 Linden Ct", beds: 3, baths: 2, rentCents: 360_000, accessNotes: "Side gate code is with the manager." },
  { id: "unit_linden_adu", propertyId: "prop_linden", label: "22 Linden Ct, ADU", beds: 1, baths: 1, rentCents: 175_000, accessNotes: "" },
];

export const ASSETS: Asset[] = [
  { id: "ast_alder_b_ac", unitId: "unit_alder_b", type: "ac", installYear: 2011, model: "Carrier 24ACC6 (3 ton)" },
  { id: "ast_alder_b_wh", unitId: "unit_alder_b", type: "water_heater", installYear: 2016, model: "Rheem 40 gal gas" },
  { id: "ast_alder_a_ac", unitId: "unit_alder_a", type: "ac", installYear: 2019, model: "Goodman GSX14 (2.5 ton)" },
  { id: "ast_alder_a_wh", unitId: "unit_alder_a", type: "water_heater", installYear: 2014, model: "AO Smith 40 gal gas" },
  { id: "ast_pine_roof", unitId: "unit_pine_1", type: "roof", installYear: 2004, model: "Composition shingle" },
  { id: "ast_pine_1_fridge", unitId: "unit_pine_1", type: "fridge", installYear: 2018, model: "Whirlpool WRT518" },
  { id: "ast_pine_3_fridge", unitId: "unit_pine_3", type: "fridge", installYear: 2012, model: "GE GTS18" },
  { id: "ast_pine_3_wh", unitId: "unit_pine_3", type: "water_heater", installYear: 2013, model: "Bradford White 30 gal" },
  { id: "ast_linden_furnace", unitId: "unit_linden_house", type: "furnace", installYear: 2009, model: "Lennox ML180" },
  { id: "ast_linden_wh", unitId: "unit_linden_house", type: "water_heater", installYear: 2012, model: "Rheem 50 gal gas" },
  { id: "ast_linden_dishwasher", unitId: "unit_linden_house", type: "dishwasher", installYear: 2017, model: "Bosch 300" },
  { id: "ast_linden_adu_wh", unitId: "unit_linden_adu", type: "water_heater", installYear: 2020, model: "Rinnai tankless" },
];

export const TENANCIES: Tenancy[] = [
  { id: "ten_alder_a", unitId: "unit_alder_a", tenantName: "James Park", phone: "+14155550121", aiConsent: true, rentCents: 245_000, dueDay: 1, accessWindows: ["weekdays 9 AM-5 PM"] },
  { id: "ten_alder_b", unitId: "unit_alder_b", tenantName: "Maria Gomez", phone: "+14155550122", aiConsent: true, rentCents: 240_000, dueDay: 1, accessWindows: ["weekdays after 5 PM", "Saturday mornings"] },
  { id: "ten_pine_1", unitId: "unit_pine_1", tenantName: "Aisha Rahman", phone: "+14155550123", aiConsent: true, rentCents: 185_000, dueDay: 1, accessWindows: ["any weekday"] },
  { id: "ten_pine_2", unitId: "unit_pine_2", tenantName: "Tom Becker", phone: "+14155550124", aiConsent: true, rentCents: 189_500, dueDay: 1, accessWindows: ["weekday mornings"] },
  { id: "ten_pine_3", unitId: "unit_pine_3", tenantName: "Lena Novak", phone: "+14155550125", aiConsent: true, rentCents: 192_500, dueDay: 5, accessWindows: ["afternoons after noon"] },
  { id: "ten_pine_4", unitId: "unit_pine_4", tenantName: "Chris Walsh", phone: "+14155550126", aiConsent: false, rentCents: 195_000, dueDay: 1, accessWindows: ["weekends"] },
  { id: "ten_linden_house", unitId: "unit_linden_house", tenantName: "Grace Okafor", phone: "+14155550127", aiConsent: true, rentCents: 360_000, dueDay: 1, accessWindows: ["weekdays 8 AM-noon"] },
  { id: "ten_linden_adu", unitId: "unit_linden_adu", tenantName: "Ben Carter", phone: "+14155550128", aiConsent: true, rentCents: 175_000, dueDay: 1, accessWindows: ["weekdays after 4 PM"] },
];

export const VENDORS: Vendor[] = [
  { id: "ven_coolbreeze", name: "CoolBreeze HVAC", phone: "+14155550131", trades: ["hvac"], approved: true, tripFeeCents: 8_900, afterHours: false, serviceArea: "Oakland, San Leandro" },
  { id: "ven_rapidair", name: "Rapid Air Heating & Cooling", phone: "+14155550132", trades: ["hvac"], approved: true, tripFeeCents: 12_900, afterHours: true, serviceArea: "East Bay" },
  { id: "ven_summit", name: "Summit Mechanical", phone: "+14155550133", trades: ["hvac", "plumbing"], approved: true, tripFeeCents: 7_900, afterHours: false, serviceArea: "Oakland, Berkeley, San Leandro" },
  { id: "ven_dripfix", name: "DripFix Plumbing", phone: "+14155550134", trades: ["plumbing"], approved: true, tripFeeCents: 9_500, afterHours: false, serviceArea: "Oakland" },
  { id: "ven_flowright", name: "FlowRight Plumbing & Rooter", phone: "+14155550135", trades: ["plumbing"], approved: true, tripFeeCents: 14_900, afterHours: true, serviceArea: "East Bay" },
  { id: "ven_brightspark", name: "Bright Spark Electric", phone: "+14155550136", trades: ["electrical"], approved: true, tripFeeCents: 9_900, afterHours: false, serviceArea: "East Bay" },
  { id: "ven_applianceworks", name: "ApplianceWorks Repair", phone: "+14155550137", trades: ["appliance"], approved: true, tripFeeCents: 8_500, afterHours: false, serviceArea: "Oakland, San Leandro" },
  { id: "ven_handyhank", name: "Handy Hank's Home Repair", phone: "+14155550138", trades: ["general", "locks", "paint"], approved: true, tripFeeCents: 6_500, afterHours: false, serviceArea: "Oakland" },
];

export const AGENCIES: Agency[] = [
  { id: "agy_homeshield", name: "HomeShield Home Warranty", kind: "warranty", phone: "+14155550151" },
  { id: "agy_baygas", name: "Bay Gas & Power", kind: "utility", phone: "+14155550152" },
];

/** Who gets paged in an emergency, in order. The manager is first. */
export const ON_CALL_EXTRA: OnCallPerson[] = [{ name: "Sam Ortiz (maintenance lead)", phone: "+14155550190" }];
