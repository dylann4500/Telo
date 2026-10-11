# Telo for property managers: maintenance, vendors, turnovers, contractor projects

Researched 2026-10-11. **VERIFIED [n]** = numbered source (vendor figures unaudited); untagged = **INFERRED**. §1954 via secondary summaries [15][16] (leginfo and Justia returned 403).

## Area summary
Maintenance is the heaviest phone load in a rental portfolio: each work order means calls with the tenant, vendors and owner, and sometimes warranty companies, insurers and utilities. Incumbents run AI intake in their portals (AppFolio claims about 1 in 4 work orders resolved with the resident, Latchel 23% at intake; VERIFIED [8][3][5]) and text vendors [7]. Telo's edge is outbound voice: parallel vendor calls, phone menus and hold, and transfer to an on-call human. Keewano builds `vendor` scorecards (Lula's metrics, VERIFIED [12]) and `asset` histories.

## Use-case catalog
Enums: `trade` = plumbing|hvac|electrical|appliance|roof|pest|locks|landscape|cleaning|paint|flooring|general; `severity` = emergency|urgent|routine|cosmetic. `(+unit)` = also sent to that entity (one entity per Keewano batch). WO = work order; COI = certificate of insurance; IVR = phone menu.

### 1. Photo intake, self-fix and triage
- **Trigger:** A tenant texts or calls about a problem, often with photos.
- **Parties and who approves:** Tenant; PM's triage rules; no approval.
- **Calls and texts:** Inbound SMS/MMS/call; targeted photo requests (leak, panel, model plate); guided self-fix; mid-call tool shows unit assets and open WOs.
- **Telo decides alone vs asks:** Alone: trade, severity, self-fix, duplicates. Unclear severity is rounded up.
- **Variables to track:** *Task facts:* description, photos, model/serial · *Keewano events:* `wo_opened{channel: sms|mms|call, trade, severity, photo_count: int}` on `work_order` (+unit); `wo_deflected{fix_code: gfci|breaker|disposal|thermostat|filter|clog|other, secs_to_resolve: int}` on `work_order` (+unit) · *KPIs it moves:* seconds to triage, deflection rate.
- **A decision that history changes:** If the same `fix_code` comes up twice in 90 days, dispatch instead.
- **Rules and guardrails:** No self-fix involving gas, ladders, roofs, or panel work beyond a breaker reset.
- **Products already doing it, and the gap:** AppFolio Maintenance Performer reviews photos, coaches fixes (VERIFIED [7]); Latchel troubleshoots at intake (VERIFIED [3][5]). Gap: portal-bound; Telo is plain SMS and voice.
- **Build effort on Telo's engine:** S
- **Demo-ability (1–5):** 5

### 2. After-hours emergencies and utility outages
- **Trigger:** After hours: gas, fire, CO alarm, flood, sewage, no heat in a freeze, break-in, lockout, no power or water.
- **Parties and who approves:** Tenant (calls 911 or the utility); on-call ladder; emergency vendors; owner above the emergency limit.
- **Calls and texts:** Instant SMS safety script; on-call ladder with cold transfer when someone answers; parallel vendor calls; utility outage line (PM directory) for area-wide status; SMS to affected tenants.
- **Telo decides alone vs asks:** Alone: script, paging, mitigation within limit, no dispatch for area-wide outages. Asks: over limit; entry with nobody home.
- **Variables to track:** *Task facts:* what was said, who is home, shutoff location · *Keewano events:* `emergency_routed{kind: gas|fire|co|water|sewage|no_heat|no_power|lockout|security, route: tenant_911|utility|oncall|vendor|deescalated, secs_to_human: int}` on `work_order` (+property); `oncall_paged{attempt: int, answered: bool, slot: evening|night|weekend}` on `work_order`; `utility_outage{utility: power|water|gas, area_wide: bool, restore_secs: int}` on `property` · *KPIs it moves:* seconds to reach a human, callouts, trips avoided.
- **A decision that history changes:** The ladder and vendors are re-ranked by who answers in each time slot.
- **Rules and guardrails:** Gas, fire, CO: no troubleshooting; leave, call 911 from a safe place, then the utility (VERIFIED [17]); no electrical devices, phones included, until away (VERIFIED [18]). Telo never dials 911.
- **Products already doing it, and the gap:** Buildium Maintenance Contact Center: humans 24/7, $300 setup (VERIFIED [9]); Latchel: video escalation, automated weather checks (VERIFIED [4][5]); AppFolio: PM-set emergency rules (VERIFIED [7]). Gap: paging, vendor and utility calls at once, then transfer.
- **Build effort on Telo's engine:** M
- **Demo-ability (1–5):** 5

### 3. Scorecard-ranked parallel dispatch
- **Trigger:** A triaged WO, adding ranking, terms and memory to the basic flow.
- **Parties and who approves:** 2–4 listed vendors. The owner approves anything over the limit.
- **Calls and texts:** Parallel calls: earliest slot, trip fee, flat or hourly rate, labor warranty, after-hours premium; mid-call tool checks tenant windows while the best vendor holds.
- **Telo decides alone vs asks:** Alone: top-scored vendor within limit. Asks: over limit, unlisted vendor, out-of-range quote.
- **Variables to track:** *Task facts:* quotes, spoken terms · *Keewano events:* `quote_received{trade, job_code: short code, amount_cents: int, trip_fee_cents: int, labor_warranty_days: int, earliest_slot_secs: int}` on `vendor` (+work_order); `vendor_declined{reason: busy|out_of_area|wrong_trade|no_answer|price}` on `vendor` · *KPIs it moves:* speed to schedule, quote range per job_code (p25/p50/p75), answer rate.
- **A decision that history changes:** Quote above p75 → one more quote; first-time fix under 60% → lower rank (Lula: 75–85% target, under 60% a warning, VERIFIED [12]).
- **Rules and guardrails:** Only listed vendors with a current COI (#9), and only numbers the PM supplied.
- **Products already doing it, and the gap:** Vendoroo: vendor preferences, property rules, spending thresholds, owner bid approval (VERIFIED [1][2]); AppFolio texts vendors routed by issue, severity, time (VERIFIED [7]). Gap: voice negotiation; portfolio-wide quote ranges.
- **Build effort on Telo's engine:** M
- **Demo-ability (1–5):** 5

### 4. Access scheduling and legal entry notice
- **Trigger:** A vendor slot, inspection, preventive visit or showing.
- **Parties and who approves:** The tenant picks windows. The PM approves any entry when the tenant is absent.
- **Calls and texts:** SMS window offers, checked mid-call with the vendor; written notice (date, approximate time, purpose); day-before reminder; pet and alarm notes to the vendor.
- **Telo decides alone vs asks:** Alone: book inside tenant windows, business hours. Asks: no-consent or short-notice non-emergency entry.
- **Variables to track:** *Task facts:* windows, pets, notice text and timestamp · *Keewano events:* `entry_notice_sent{notice_hours: int, method: sms|email|posted|mail, purpose: repair|inspection|pm|showing}` on `unit`; `access_outcome{result: done|no_access|rescheduled|tenant_cancelled, reschedules: int}` on `work_order` · *KPIs it moves:* trips with no access, reschedules, notice compliance.
- **A decision that history changes:** After a past `no_access`, Telo confirms on the day and books when the tenant is home.
- **Rules and guardrails:** §1954: listed purpose, business hours, written notice (24 h presumed reasonable; 6 days if mailed); none for emergencies or a present, consenting tenant; oral repair agreements within one week (VERIFIED [15][16]). Per-state rule table.
- **Products already doing it, and the gap:** Vendoroo and Latchel schedule visits (VERIFIED [2][5]); none found keeping notice records matched to local rules.
- **Build effort on Telo's engine:** S
- **Demo-ability (1–5):** 4

### 5. Completion verification and promise tracking
- **Trigger:** The window opens, the vendor reports the job done, or an invoice arrives.
- **Parties and who approves:** Vendor and tenant. The PM approves invoice variances.
- **Calls and texts:** 30 minutes in: text, then call; after-photos by MMS; tenant "fixed? Y/N"; rechecks at 14 and 30 days; invoice vs quote.
- **Telo decides alone vs asks:** Alone: chase; backup vendor after a no-show. Asks: invoice over quote by more than a set %; disputes.
- **Variables to track:** *Task facts:* photos, invoice · *Keewano events:* `promise_settled{kind: eta|arrival|parts|quote_by|invoice_by, kept: bool, late_secs: int}` on `vendor` (+work_order); `wo_completed{first_visit_fix: bool, visits: int, invoice_vs_quote_pct: int, tenant_confirmed: bool}` on `work_order` (+vendor); `callback_opened{days_since_done: int}` on `vendor` · *KPIs it moves:* ETA kept, first-time fix, callbacks, price accuracy (VERIFIED [12]).
- **A decision that history changes:** Vendors who often miss ETAs get a confirmation call that morning and rank lower.
- **Rules and guardrails:** Telo never pays. In a vacant unit, the PM's photos replace the tenant's confirmation.
- **Products already doing it, and the gap:** Latchel follows jobs to invoice and review (VERIFIED [5]); Property Meld averages resident ratings per vendor (VERIFIED [6]). Gap: per-promise tracking.
- **Build effort on Telo's engine:** S
- **Demo-ability (1–5):** 4

### 6. Repair-vs-replace and big-project bids (roof, HVAC)
- **Trigger:** Repeat repairs, a quote near the replacement cost, or planned capex.
- **Parties and who approves:** Vendors, or 3+ contractors. The owner decides and awards.
- **Calls and texts:** Mid-call tool gives asset age and repair history; repair and replace prices; parallel site visits; bids chased with identical questions (scope, permit, start, deposit %, warranties); SMS comparison to the owner.
- **Telo decides alone vs asks:** Alone: collecting quotes and normalizing them. Asks: replacing, awarding, deposits, contracts.
- **Variables to track:** *Task facts:* model/serial, bid PDFs · *Keewano events:* `asset_repaired{asset_type: water_heater|furnace|ac|heat_pump|fridge|range|dishwasher|washer|dryer|roof, install_year: int, amount_cents: int, repeat_within_90d: bool}` on `asset`; `bid_received{project_type: roof|hvac_replace|water_heater|sewer_line|other, amount_cents: int, deposit_pct: int, labor_warranty_months: int, start_in_days: int, permit_included: bool}` on `project` (+vendor); `repair_vs_replace{choice: repair|replace|defer, age_years: int}` on `asset` (+owner) · *KPIs it moves:* recurrence, repair spend per asset, days to 3 bids.
- **A decision that history changes:** 12-month repairs plus the quote above a PM-set share of replacement cost → recommend replace; drop contractors who go silent.
- **Rules and guardrails:** Options, not financial advice. Telo never signs or pays deposits.
- **Products already doing it, and the gap:** Vendoroo presents multiple bids to owners (VERIFIED [1]); none found doing repair-vs-replace from asset history.
- **Build effort on Telo's engine:** M
- **Demo-ability (1–5):** 4

### 7. Preventive maintenance, service contracts and notices
- **Trigger:** A due date or season (HVAC, filters, gutters, smoke and CO tests, dryer vents, backflow, pest, lawn), a snowfall, or a letter from the utility or city.
- **Parties and who approves:** Vendors and tenants. The owner approves the budget and renewals once, and pays notices.
- **Calls and texts:** Batch calls for compact vendor routes; entry notices (#4); calendar; visit checks (vendor photo or tenant confirmation); post-storm plow chase; utility calls on shutoff notices.
- **Telo decides alone vs asks:** Alone: booking within the budget or contract, and checking. Asks: new programs, extra work, renewals, payments.
- **Variables to track:** *Task facts:* device locations, test reports, account numbers · *Keewano events:* `pm_done{pm_type: hvac_service|filter|gutter|smoke_co_test|backflow_test|dryer_vent|pest|lawn|snow, days_late: int, amount_cents: int, finding: ok|minor|major, verified: bool}` on `property` (+vendor); `notice_received{kind: backflow|shutoff|past_due|boil_water, days_to_deadline: int}` on `property` · *KPIs it moves:* on-time %, missed visits, reactive WOs per unit.
- **A decision that history changes:** HVAC calls drop after service → shorter intervals elsewhere; missed visits → rebid; pests recurring next door → whole-building treatment.
- **Rules and guardrails:** Backflow: commonly annual by a certified tester, owner books it, utility may not remind (VERIFIED [25][26]); a lapse → shutoff notice (VERIFIED [27]) or a test billed to the owner (VERIFIED [28]). Smoke and CO rules not verified.
- **Products already doing it, and the gap:** Second Nature: scheduled right-size filters, claims 37–42% fewer HVAC calls, pest control (VERIFIED [14]). Gap: booking and checking visits by phone.
- **Build effort on Telo's engine:** M
- **Demo-ability (1–5):** 3

### 8. Make-ready turnover orchestration
- **Trigger:** A notice to vacate, then the move-out date.
- **Parties and who approves:** PM approves scope; owner approves overages and upgrades; cleaners, painters, flooring, appliances, pest, locksmith.
- **Calls and texts:** Parallel availability calls book backward from the ready date: trash-out → repair → paint → flooring → clean → rekey → walkthrough; daily ETA checks; SMS rebooking when a trade slips.
- **Telo decides alone vs asks:** Alone: rebooking within scope. Asks: scope changes, and rush fees over a set amount.
- **Variables to track:** *Task facts:* punch list, photos, lockbox code · *Keewano events:* `turn_stage_done{stage: trashout|repair|paint|flooring|clean|rekey|appliance|pest|walkthrough, day_n: int, amount_cents: int, slipped_days: int}` on `turn` (+vendor); `turn_ready{beds: int, turn_days: int, cost_cents: int, vacant_day_cents: int}` on `turn` (+unit) · *KPIs it moves:* turn days, cost per turn, vacant-day cost, slip days per trade.
- **A decision that history changes:** Pay a rush fee when vacant-day cost (rent × 12 ÷ 365) × days saved exceeds it; book the most-slipping trade first.
- **Rules and guardrails:** Lockbox code only to the booked vendor for its window, never to Keewano; change it afterwards. Deposit deductions stay human.
- **Products already doing it, and the gap:** Lula: Scope → Approve → Coordinate → Walkthrough, 4–6 days per turn in select markets; its guide calls $3,000–5,000 and 5–7 days typical (VERIFIED, vendor claims [10][11]); in AppFolio's network (VERIFIED [13]). Gap: the PM's own vendors, any market.
- **Build effort on Telo's engine:** L
- **Demo-ability (1–5):** 4

### 9. Vendor compliance: COI, license, W-9
- **Trigger:** A new vendor, a COI close to expiry, or a dispatch to a vendor whose cover has lapsed.
- **Parties and who approves:** Vendor office; its insurance agent (number from the vendor); PM grants exceptions.
- **Calls and texts:** SMS, then a call, at 30, 14 and 7 days; COI by upload; dispatch blocked on a lapse.
- **Telo decides alone vs asks:** Alone: reminders and blocking. Asks: emergency exceptions.
- **Variables to track:** *Task facts:* COI PDF, policy and license numbers, W-9 · *Keewano events:* `coi_status{coverage: gl|wc|auto|umbrella, days_to_expiry: int, additional_insured: bool, meets_minimum: bool}` on `vendor`; `dispatch_blocked{reason: coi_expired|license|w9_missing|not_approved}` on `vendor` · *KPIs it moves:* % of vendors compliant, days lapsed, dispatches blocked.
- **A decision that history changes:** Vendors who keep lapsing get reminders from 45 days out.
- **Rules and guardrails:** Never take a tax ID by voice or SMS, and never put one in Keewano.
- **Products already doing it, and the gap:** VendorProof: reminders at 30, 14 and 7 days (VERIFIED [20]); Yardi VendorShield verifies tax IDs (VERIFIED [21]); NetVendor blocks lapsed vendors (VERIFIED [22]). Gap: they email; small trades answer the phone.
- **Build effort on Telo's engine:** S
- **Demo-ability (1–5):** 3

### 10. Home-warranty claims
- **Trigger:** A covered system or appliance fails in a unit with a warranty contract.
- **Parties and who approves:** Warranty company (IVR, then agent), its contractor, tenant; owner decides uncovered costs, cash-outs, disputes.
- **Calls and texts:** IVR, hold, open the claim; record claim number and contractor; book the contractor within tenant windows; escalate after N silent days or a denial.
- **Telo decides alone vs asks:** Alone: opening, chasing, rescheduling. Asks: uncovered charges, cash-outs, disputes.
- **Variables to track:** *Task facts:* contract and claim numbers, denial reason · *Keewano events:* `warranty_claim{system: hvac|water_heater|appliance|plumbing|electrical, ivr_secs: int, hold_secs: int, service_fee_cents: int}` on `claim` (+asset); `warranty_outcome{result: repaired|replaced|cash_out|denied|abandoned, days_to_fix: int, out_of_pocket_cents: int}` on `claim` · *KPIs it moves:* hold time, days to fix compared with the PM's own vendors, denial rate.
- **A decision that history changes:** If a provider is slow on no-heat claims, send urgent jobs to the PM's own vendor. The same data informs the renewal decision.
- **Rules and guardrails:** Habitability problems don't wait in warranty queues; the PM decides. Numbers come from the PM's directory.
- **Products already doing it, and the gap:** Landlord and customer accounts: assigned contractor, authorization waits, per-visit fee, emergency gaps (VERIFIED [23][24]). No PM tool advertises waiting on hold.
- **Build effort on Telo's engine:** M
- **Demo-ability (1–5):** 5

### 11. Water-damage insurance claim
- **Trigger:** After mitigation (#2), when the damage needs more than a simple repair.
- **Parties and who approves:** Restoration company, plumber, owner (insured; decides whether to file), adjuster, tenant.
- **Calls and texts:** Restoration within the limit; photo summary to the owner; if filed, adjuster booked around tenant access; dry-out and estimate tracked.
- **Telo decides alone vs asks:** Alone: mitigation, scheduling, documents. Asks: filing, settlement, relocating the tenant.
- **Variables to track:** *Task facts:* photos, moisture logs, claim and policy numbers · *Keewano events:* `water_loss{source: supply_line|water_heater|toilet|roof|appliance|sewer|unknown, water: clean|gray|black, hrs_to_mitigation: int}` on `property` (+claim); `claim_step{step: reported|adjuster_booked|inspected|estimate|approved|paid|denied|withdrawn, days_since_loss: int, amount_cents: int}` on `claim` · *KPIs it moves:* hours to mitigation, days to dry, claim cycle time.
- **A decision that history changes:** Repeat `supply_line` losses → preventive replacement program; estimate under the deductible → owner warned filing likely won't pay.
- **Rules and guardrails:** EPA: dry within 24–48 hours; no fans until the water is confirmed clean (VERIFIED [19]). Black water: professionals only.
- **Products already doing it, and the gap:** None of the PM products I reviewed coordinates insurance claims.
- **Build effort on Telo's engine:** L
- **Demo-ability (1–5):** 3

## Build first
1. **Emergencies with triage (#1, #2):** highest stakes; shows parallel calls and a human transfer at 2 a.m.; deterministic rules suit the mock LLM; every competitor sells 24/7 intake.
2. **Scorecard dispatch with promise tracking (#3, #5):** Keewano SQL across `vendor` entities gives quote ranges, ETA kept and first-time fix that visibly change the next dispatch; the engine already tracks promises.
3. **Warranty claim on hold (#10):** IVR and hold are native to Dial; no PM product found doing it; `hold_secs` per provider is a vivid demo number.
Next comes make-ready (#8): the biggest money lever, but L effort.

## Keep human or avoid
- **Dialing 911:** Telo tells the tenant to call and pages a human, because it is not on site.
- **Entry without notice or consent** outside real emergencies [15].
- **Money:** invoices, utility bills, deposits, contracts, settlements, capex awards.
- **Legal calls:** deposit deductions, charge-backs, habitability and code complaints.
- **Hazards:** large areas of mold, sewage, asbestos, lead. Licensed professionals only.
- **Sensitive data:** tax IDs, policy and account numbers, lockbox codes and tenants' medical needs stay in task facts. They never go to Keewano, which has no delete API.

## Sources
1. https://vendoroo.ai
2. https://www.rentmanager.com/integrations/vendoroo/
3. https://latchel.com/multifamily
4. https://latchel.com/emergency-maintenance-support
5. https://latchel.com/property-management-software-features/property-maintenance-services/
6. https://help.propertymeld.com/hc/en-us/articles/45926721564051-How-to-Find-Average-Meld-Rating-Per-Vendor
7. https://www.appfolio.com/product-demos/realm-x-performers
8. https://www.theaiconsultingnetwork.com/blog/appfolio-realm-x-ai-completion-rates-property-management-cre-2026
9. https://www.buildium.com/maintenance-contact-center/
10. https://lula.life/make-ready
11. https://lula.life/articles/how-long-does-a-make-ready-take
12. https://lula.life/articles/vendor-scorecard
13. https://www.appfolio.com/blog/lula-vendor-network
14. https://secondnature.com/benefits/air-filter-delivery and https://secondnature.com/benefits
15. https://ezel.ai/surveys/landlord-entry-notice/california
16. https://ipropertymanagement.com/laws/california-landlord-entry-rights
17. https://pge.com/en_US/safety/report-emergency/report-emergency.page
18. https://www.pgworks.com/emergencies
19. https://epa.gov/mold/mold-remediation-schools-and-commercial-buildings-guide-chapter-4
20. https://alternativeto.net/software/vendorproof/about
21. https://resources.yardi.com/documents/vendorshield-universal-checks-brochure
22. https://www.netvendor.com/vendor-compliance
23. https://www.biggerpockets.com/posts/1218845
24. https://www.consumeraffairs.com/insurance/am_home.html
25. https://ochealthinfo.com/sites/healthcare/files/2026-04/Reminder_Annual_Testing_of_All_Internal_Backflow_Prevention_Assemblies.pdf
26. https://www.portland.gov/water/backflow-prevention/testing-requirements-and-reports
27. https://www.silverthorne.org/town-government/public-works/utilities/backflow
28. https://www.mymanatee.org/connect/news-and-information/news-and-information/article-detail/utilities-backflow-inspection-division-posts/2025/08/26/did-you-receive-a-letter-about-your-backflow-preventer
