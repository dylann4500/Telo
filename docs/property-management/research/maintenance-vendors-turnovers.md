# Telo for property managers: maintenance, vendors, turnovers, contractor projects

Researched 2026-10-11. **VERIFIED [n]** means the numbered source says it; vendor figures are unaudited claims. Untagged design statements are **INFERRED**. Two direct fetches of Cal. Civ. Code §1954 (leginfo, Justia) returned 403, so the §1954 points rest on secondary summaries [15][16].

## Area summary
Maintenance is the heaviest phone load in a rental portfolio. Each work order turns into calls with the tenant, vendors and the owner, and sometimes warranty companies, insurers and utilities. Incumbents already run AI intake and troubleshooting inside their portals and text vendors from the work order. AppFolio says about 1 in 4 work orders are resolved with the resident, and Latchel says 23% are resolved at intake (VERIFIED, vendor claims [8][3][5][7]). Telo's edge is outbound voice: calling vendors in parallel to negotiate terms, getting through phone menus and hold, and cold-transferring the caller to an on-call human. Keewano turns each call into two things the use cases share: a `vendor` scorecard and an `asset` history. The scorecard covers speed to schedule, ETA kept, first-time fix, callbacks and price accuracy, close to Lula's metric set (VERIFIED [12]).

## Use-case catalog
Enums: `trade` = plumbing|hvac|electrical|appliance|roof|pest|locks|landscape|cleaning|paint|flooring|general; `severity` = emergency|urgent|routine|cosmetic. `(+unit)` means the event is also sent to that entity, because a Keewano batch covers one entity. WO = work order; COI = certificate of insurance; IVR = phone menu.

### 1. Photo intake, self-fix and triage
- **Trigger:** A tenant texts or calls about a problem, often with a photo or video.
- **Parties and who approves:** Tenant, under the PM's triage rules. No approval.
- **Calls and texts:** Inbound SMS/MMS or call. Telo asks for 1–3 targeted photos (the leak, the breaker panel, the model plate) and guides a self-fix. A mid-call tool reads the unit's assets and open WOs.
- **Telo decides alone vs asks:** Alone: trade, severity, a safe self-fix, merging duplicates. Unclear severity is rounded up.
- **Variables to track:** *Task facts:* description, photos, model/serial, pets · *Keewano events:* `wo_opened{channel: sms|mms|call, trade, severity, photo_count: int}` on `work_order` (+unit); `wo_deflected{fix_code: gfci|breaker|disposal|thermostat|filter|clog|other, secs_to_resolve: int}` on `work_order` (+unit) · *KPIs it moves:* seconds to triage, deflection rate, duplicates avoided.
- **A decision that history changes:** If the same `fix_code` comes up twice in 90 days on a unit, Telo dispatches instead of walking the tenant through it again.
- **Rules and guardrails:** No self-fix involving gas, the panel beyond resetting a breaker, ladders or roofs.
- **Products already doing it, and the gap:** AppFolio's Maintenance Performer reviews photos and walks residents through fixes (VERIFIED [7]). Latchel troubleshoots at intake (VERIFIED [3][5]). Gap: both are tied to a portal. Telo works over plain SMS and voice and goes straight into dispatch.
- **Build effort on Telo's engine:** S
- **Demo-ability (1–5):** 5

### 2. After-hours emergencies and utility outages
- **Trigger:** An after-hours report that matches the emergency rules (gas, fire, CO alarm, flood, sewage, no heat in freezing weather, break-in, lockout), or no power or water.
- **Parties and who approves:** Tenant; 911 and the utility, which the tenant calls; the on-call ladder; emergency vendors. The owner approves anything above the emergency limit.
- **Calls and texts:** Telo texts a safety script at once. It calls down the on-call ladder and cold-transfers the tenant when someone answers. At the same time it calls vendors and the utility's outage line (number from the PM's directory) to learn whether the outage is area-wide and when power returns, then texts the affected tenants.
- **Telo decides alone vs asks:** Alone: the script, paging, mitigation within the limit, and skipping dispatch for an area-wide outage. Asks: anything over the limit, or entry when nobody is home.
- **Variables to track:** *Task facts:* what was said, who is home, shutoff location · *Keewano events:* `emergency_routed{kind: gas|fire|co|water|sewage|no_heat|no_power|lockout|security, route: tenant_911|utility|oncall|vendor|deescalated, secs_to_human: int}` on `work_order` (+property); `oncall_paged{attempt: int, answered: bool, slot: evening|night|weekend}` on `work_order`; `utility_outage{utility: power|water|gas, area_wide: bool, restore_secs: int}` on `property` · *KPIs it moves:* seconds to reach a human, after-hours callouts, de-escalations, vendor trips avoided.
- **A decision that history changes:** The on-call ladder and the vendor list are re-ordered by who actually answers in each time slot.
- **Rules and guardrails:** For gas, fire or CO, Telo does no troubleshooting. The tenant leaves, calls 911 from a safe place, then calls the utility (VERIFIED [17]), and avoids electrical devices, phones included, until away (VERIFIED [18]). Telo never dials 911 itself, because it is not on site.
- **Products already doing it, and the gap:** Buildium's Maintenance Contact Center has humans on duty 24/7, screens for emergencies and charges a $300 setup fee (VERIFIED [9]). Latchel escalates to a live expert on video and checks weather and emergency rules automatically (VERIFIED [4][5]). AppFolio applies emergency rules set by the PM (VERIFIED [7]). Gap: none of them pages humans and calls vendors and the utility at the same time, then transfers the call.
- **Build effort on Telo's engine:** M
- **Demo-ability (1–5):** 5

### 3. Scorecard-ranked parallel dispatch
- **Trigger:** A triaged WO needs a vendor. This extends the basic flow with ranking, terms and memory.
- **Parties and who approves:** 2–4 vendors from the PM's list, under the PM's rules. The owner approves anything over the limit.
- **Calls and texts:** Parallel calls ask for the earliest slot, the trip or diagnostic fee, flat or hourly pricing, the labor warranty and any after-hours premium. While the best vendor holds, a mid-call tool checks the tenant's windows.
- **Telo decides alone vs asks:** Alone: books the top-scored vendor within the limit. Asks: over the limit, a vendor not on the list, or a quote out of the usual range.
- **Variables to track:** *Task facts:* quotes, spoken terms · *Keewano events:* `quote_received{trade, job_code: short code, amount_cents: int, trip_fee_cents: int, labor_warranty_days: int, earliest_slot_secs: int}` on `vendor` (+work_order); `vendor_declined{reason: busy|out_of_area|wrong_trade|no_answer|price}` on `vendor` · *KPIs it moves:* speed to schedule, quote range per job_code (p25/p50/p75), answer rate.
- **A decision that history changes:** A quote above the job_code's p75 triggers one more quote. A vendor with first-time fix under 60% ranks lower (Lula targets 75–85% and calls under 60% a warning sign, VERIFIED [12]).
- **Rules and guardrails:** Only vendors from the PM's list with a current COI (#9), and only numbers the PM supplied.
- **Products already doing it, and the gap:** Vendoroo uses vendor preferences, property rules and spending thresholds, and its upper tier adds owner bid approval (VERIFIED [1][2]). AppFolio texts vendors routed by issue, severity and time of day (VERIFIED [7]). Gap: terms negotiated by voice, and quote ranges across the whole portfolio.
- **Build effort on Telo's engine:** M
- **Demo-ability (1–5):** 5

### 4. Access scheduling and legal entry notice
- **Trigger:** A vendor proposes a slot, or entry is needed for an inspection, preventive visit or showing.
- **Parties and who approves:** The tenant picks windows. The PM approves any entry while the tenant is absent.
- **Calls and texts:** Telo offers windows by SMS, and the agent on the vendor call checks them mid-call. Written notice goes by SMS or email with the date, approximate time and purpose, followed by a reminder the day before. Pet and alarm notes go to the vendor.
- **Telo decides alone vs asks:** Alone: booking within the tenant's windows, in business hours. Asks: entry without consent, or short-notice entry that is not an emergency.
- **Variables to track:** *Task facts:* windows, pets, the notice text and timestamp (legal proof) · *Keewano events:* `entry_notice_sent{notice_hours: int, method: sms|email|posted|mail, purpose: repair|inspection|pm|showing}` on `unit`; `access_outcome{result: done|no_access|rescheduled|tenant_cancelled, reschedules: int}` on `work_order` · *KPIs it moves:* trips with no access (wasted trip fees), reschedules per WO, notice compliance %.
- **A decision that history changes:** After a past `no_access`, Telo confirms on the day and books a slot when the tenant is home.
- **Rules and guardrails:** Under §1954, entry is allowed only for the listed purposes, in business hours. Written notice is required: 24 hours is presumed reasonable, or 6 days if mailed. No notice is needed in an emergency, or when the tenant is present and consents. An oral agreement for repairs must set a date within one week (VERIFIED [15][16]). Needs a rules table per state.
- **Products already doing it, and the gap:** Vendoroo and Latchel schedule visits (VERIFIED [2][5]). I found none that keeps a notice record matched to each jurisdiction's rules.
- **Build effort on Telo's engine:** S
- **Demo-ability (1–5):** 4

### 5. Completion verification and promise tracking
- **Trigger:** The appointment window opens, the vendor says the job is done, or an invoice arrives.
- **Parties and who approves:** Vendor and tenant. The PM approves invoices that differ from the quote.
- **Calls and texts:** 30 minutes into the window, Telo texts the vendor, then calls. It collects after-photos by MMS, sends the tenant a one-tap "fixed? Y/N", rechecks at 14 and 30 days, and compares the invoice with the quote.
- **Telo decides alone vs asks:** Alone: chasing, and sending a backup vendor after a no-show. Asks: an invoice over the quote by more than a set %, or a dispute.
- **Variables to track:** *Task facts:* photos, invoice · *Keewano events:* `promise_settled{kind: eta|arrival|parts|quote_by|invoice_by, kept: bool, late_secs: int}` on `vendor` (+work_order); `wo_completed{first_visit_fix: bool, visits: int, invoice_vs_quote_pct: int, tenant_confirmed: bool}` on `work_order` (+vendor); `callback_opened{days_since_done: int}` on `vendor` · *KPIs it moves:* ETA kept %, first-time fix, callback rate, price accuracy (Lula's scorecard, VERIFIED [12]).
- **A decision that history changes:** A vendor with a low ETA-kept rate gets a confirmation call the morning of each job and drops in rank.
- **Rules and guardrails:** Telo never pays. In a vacant unit, the PM's photos replace the tenant's confirmation.
- **Products already doing it, and the gap:** Latchel follows each job through to the invoice and a review (VERIFIED [5]). Property Meld averages residents' ratings per vendor (VERIFIED [6]). Gap: tracking each promise a vendor makes.
- **Build effort on Telo's engine:** S
- **Demo-ability (1–5):** 4

### 6. Repair-vs-replace and big-project bids (roof, HVAC)
- **Trigger:** A WO on an asset with past repairs, a repair quote close to the cost of replacement, or planned capex.
- **Parties and who approves:** Vendors, or 3 or more contractors for capex. The owner decides and awards the work.
- **Calls and texts:** A mid-call tool gives Telo the asset's age and repair history, and Telo asks for both repair and replacement prices. For capex, it books site visits in parallel and chases bids (PDF or MMS), asking every contractor the same questions: scope, permit, start date, deposit %, and labor and manufacturer warranty. It then texts the owner a comparison.
- **Telo decides alone vs asks:** Alone: gathering quotes and putting them in one format. Asks: replacement, the award, deposits, contracts.
- **Variables to track:** *Task facts:* model/serial, bid PDFs · *Keewano events:* `asset_repaired{asset_type: water_heater|furnace|ac|heat_pump|fridge|range|dishwasher|washer|dryer|roof, install_year: int, amount_cents: int, repeat_within_90d: bool}` on `asset`; `bid_received{project_type: roof|hvac_replace|water_heater|sewer_line|other, amount_cents: int, deposit_pct: int, labor_warranty_months: int, start_in_days: int, permit_included: bool}` on `project` (+vendor); `repair_vs_replace{choice: repair|replace|defer, age_years: int}` on `asset` (+owner) · *KPIs it moves:* recurrence, repair spend per asset, days to 3 bids, spread between bids.
- **A decision that history changes:** If the last 12 months of repairs plus the new quote pass a share of replacement cost set by the PM, Telo recommends replacing. Contractors who go silent after a site visit stop being invited.
- **Rules and guardrails:** Telo lays out options and gives no financial advice. It never signs or pays deposits. Serial numbers stay in task facts.
- **Products already doing it, and the gap:** Vendoroo shows owners several bids to approve (VERIFIED [1]). I found none that weighs repair against replace from an asset's history.
- **Build effort on Telo's engine:** M
- **Demo-ability (1–5):** 4

### 7. Preventive maintenance, service contracts and notices
- **Trigger:** A due date or season (HVAC, filters, gutters, smoke/CO tests, dryer vents, backflow, pest, lawn), snow above the contract trigger, or a letter from the utility or the city.
- **Parties and who approves:** Vendors, and tenants for access. The owner approves the annual budget and renewals, and pays any notices.
- **Calls and texts:** Batch calls book tight routes for each vendor. Telo sends entry notices (#4), adds the visits to Google Calendar, and checks they happened (a vendor photo or the tenant's confirmation). After a storm it chases the plow. It calls the utility to confirm any shutoff notice.
- **Telo decides alone vs asks:** Alone: booking within the budget or contract, and verification. Asks: new programs, work outside the contract, renewals, payments.
- **Variables to track:** *Task facts:* device locations, test reports, account numbers · *Keewano events:* `pm_done{pm_type: hvac_service|filter|gutter|smoke_co_test|backflow_test|dryer_vent|pest|lawn|snow, days_late: int, amount_cents: int, finding: ok|minor|major, verified: bool}` on `property` (+vendor); `notice_received{kind: backflow|shutoff|past_due|boil_water, days_to_deadline: int}` on `property` · *KPIs it moves:* on-time %, missed visits, reactive WOs per unit, preventive vs reactive spend.
- **A decision that history changes:** If HVAC calls fall after service, Telo shortens the service interval elsewhere. Missed visits lead to new bids. Pests that keep returning next door lead to treating the whole building.
- **Rules and guardrails:** Backflow devices commonly need an annual test by a certified tester. The owner schedules it, and the utility may send no reminder (VERIFIED [25][26]). A lapse can bring a shutoff notice (VERIFIED [27]), or a test the utility orders and bills to the owner (VERIFIED [28]). Smoke and CO rules are not verified here. Late snow clearing gets escalated.
- **Products already doing it, and the gap:** Second Nature ships filters of the right size on a schedule, with sizes taken from the PM's accounting. It claims 37–42% fewer HVAC calls and offers on-demand pest control (VERIFIED [14]). Gap: booking and checking dozens of visits by phone.
- **Build effort on Telo's engine:** M
- **Demo-ability (1–5):** 3

### 8. Make-ready turnover orchestration
- **Trigger:** A notice to vacate, then the move-out date.
- **Parties and who approves:** The PM approves scope; the owner approves anything over the limit and any upgrades. Trades: cleaners, painters, flooring, appliances, pest control, locksmith. Utilities move to the owner's name.
- **Calls and texts:** Telo books backward from the target ready date, calling for availability in parallel. The order is trash-out → repair → paint → flooring → clean → rekey → walkthrough. It checks ETAs daily, and when one trade slips it rebooks the later ones by SMS.
- **Telo decides alone vs asks:** Alone: rebooking within scope. Asks: scope changes, and rush fees over a set amount.
- **Variables to track:** *Task facts:* punch list, photos, lockbox code · *Keewano events:* `turn_stage_done{stage: trashout|repair|paint|flooring|clean|rekey|appliance|pest|walkthrough, day_n: int, amount_cents: int, slipped_days: int}` on `turn` (+vendor); `turn_ready{beds: int, turn_days: int, cost_cents: int, vacant_day_cents: int}` on `turn` (+unit) · *KPIs it moves:* turn days, cost per turn, cost of a vacant day, days slipped per trade.
- **A decision that history changes:** Pay a rush fee when the cost of a vacant day (rent × 12 ÷ 365) times the days saved is more than the fee. Book the trade that slips most often first.
- **Rules and guardrails:** The lockbox code goes only to the booked vendor for its window, never into Keewano, and is changed after the turn. Deposit deductions stay with a human.
- **Products already doing it, and the gap:** Lula runs Scope → Approve → Coordinate → Walkthrough with one field manager and a flat-rate punch list. It reports an average of 4–6 days per turn in select markets, and its guide cites $3,000–5,000 and 5–7 days as typical (VERIFIED, vendor claims [10][11]). It is part of AppFolio's vendor network (VERIFIED [13]). Gap: Telo coordinates the PM's own vendors in any market.
- **Build effort on Telo's engine:** L
- **Demo-ability (1–5):** 4

### 9. Vendor compliance: COI, license, W-9
- **Trigger:** A new vendor, a COI close to expiry, or dispatch to a vendor whose COI has lapsed.
- **Parties and who approves:** The vendor's office and its insurance agent (the vendor supplies the number). The PM grants exceptions.
- **Calls and texts:** A text, then a call, at 30, 14 and 7 days before expiry. Telo requests the COI as an upload and blocks dispatch when it lapses.
- **Telo decides alone vs asks:** Alone: reminders and blocking. Asks: emergency exceptions.
- **Variables to track:** *Task facts:* COI PDF, policy and license numbers, W-9 · *Keewano events:* `coi_status{coverage: gl|wc|auto|umbrella, days_to_expiry: int, additional_insured: bool, meets_minimum: bool}` on `vendor`; `dispatch_blocked{reason: coi_expired|license|w9_missing|not_approved}` on `vendor` · *KPIs it moves:* % of vendors compliant, days lapsed, blocked dispatches.
- **A decision that history changes:** Vendors who lapse repeatedly get reminders starting at 45 days.
- **Rules and guardrails:** Never take a tax ID by voice or SMS. Policy and tax numbers never go into Keewano.
- **Products already doing it, and the gap:** VendorProof sends reminders at 30, 14 and 7 days (VERIFIED [20]). Yardi VendorShield verifies tax IDs on W-9s (VERIFIED [21]). NetVendor blocks vendors whose COI lapses (VERIFIED [22]). Gap: these tools email, but small trades answer calls and texts.
- **Build effort on Telo's engine:** S
- **Demo-ability (1–5):** 3

### 10. Home-warranty claims
- **Trigger:** A covered system or appliance fails at a unit that has a warranty contract.
- **Parties and who approves:** The warranty company (IVR, then an agent), its assigned contractor and the tenant. The owner decides on uncovered costs, cash-outs and disputes.
- **Calls and texts:** Telo calls the warranty line, gets through the IVR, waits on hold and opens a claim. It records the claim number and the assigned contractor, then calls the contractor to book a time within the tenant's windows. It escalates after N silent days or on a denial.
- **Telo decides alone vs asks:** Alone: opening, chasing, rescheduling. Asks: uncovered charges, cash-outs, disputes.
- **Variables to track:** *Task facts:* contract and claim numbers, denial reason · *Keewano events:* `warranty_claim{system: hvac|water_heater|appliance|plumbing|electrical, ivr_secs: int, hold_secs: int, service_fee_cents: int}` on `claim` (+asset); `warranty_outcome{result: repaired|replaced|cash_out|denied|abandoned, days_to_fix: int, out_of_pocket_cents: int}` on `claim` · *KPIs it moves:* hold time, days to fix compared with the PM's own vendors, denial rate.
- **A decision that history changes:** If a provider is slow on no-heat or no-cooling claims, urgent jobs go to the PM's own vendor. The same data informs the renewal decision.
- **Rules and guardrails:** Habitability problems don't wait in warranty queues; the PM decides. Phone numbers come from the PM's directory.
- **Products already doing it, and the gap:** Landlord and customer accounts describe contractors being assigned, waits for authorization, fees per visit, reassignment by phone, and gaps in emergency cover (VERIFIED [23][24]). No PM tool above advertises waiting on warranty hold lines.
- **Build effort on Telo's engine:** M
- **Demo-ability (1–5):** 5

### 11. Water-damage insurance claim
- **Trigger:** A leak or flood after mitigation (#2), with damage beyond a simple repair.
- **Parties and who approves:** Restoration company, plumber, owner (the insured, who decides whether to file), insurer and adjuster, tenant.
- **Calls and texts:** Telo dispatches restoration within the emergency limit and sends the owner a summary with photos. If the owner files, Telo books the adjuster around the tenant's access and tracks the dry-out and the estimate.
- **Telo decides alone vs asks:** Alone: mitigation, scheduling, documents. Asks: filing, settlement, relocating the tenant.
- **Variables to track:** *Task facts:* photos, moisture logs, claim and policy numbers · *Keewano events:* `water_loss{source: supply_line|water_heater|toilet|roof|appliance|sewer|unknown, water: clean|gray|black, hrs_to_mitigation: int}` on `property` (+claim); `claim_step{step: reported|adjuster_booked|inspected|estimate|approved|paid|denied|withdrawn, days_since_loss: int, amount_cents: int}` on `claim` · *KPIs it moves:* hours to mitigation, days to dry, days to close the claim.
- **A decision that history changes:** Repeated `supply_line` losses lead to a program of replacing supply lines before they fail. If the estimate is under the deductible, the owner is told that filing likely won't pay.
- **Rules and guardrails:** The EPA says to dry materials within 24–48 hours, with no fans until the water is confirmed clean (VERIFIED [19]). Black water is for professionals only.
- **Products already doing it, and the gap:** None of the PM products I reviewed coordinates insurance claims.
- **Build effort on Telo's engine:** L
- **Demo-ability (1–5):** 3

## Build first
1. **Emergencies with photo triage (#1, #2).** They carry the highest stakes and show parallel calls and the transfer to a human at 2 a.m. The rules are deterministic, which suits the mock LLM. Every competitor sells 24/7 intake, so Telo needs it too.
2. **Scorecard dispatch with promise tracking (#3, #5).** Keewano SQL across `vendor` entities gives quote ranges, ETA kept and first-time fix, and those visibly change the next dispatch. The engine already tracks promises.
3. **A home-warranty claim on hold (#10).** IVR and hold are native to Dial, I found no PM product doing it, and `hold_secs` for each provider makes a vivid demo number.
After those, make-ready (#8) is the biggest money lever, but it is L effort.

## Keep human or avoid
- **Calling 911.** Telo tells the tenant to call and pages a human, because it is not on site.
- **Entering without notice or consent**, outside real emergencies, because of §1954-style limits [15].
- **Money:** invoices, utility bills, deposits, contracts, settlements, capex awards.
- **Legal calls:** deposit deductions, charges back to tenants, habitability and code complaints.
- **Hazards:** large mold areas, sewage, and asbestos or lead need licensed professionals.
- **Sensitive data:** tax IDs, policy and account numbers, lockbox codes and tenants' medical needs stay in task facts only and never go to Keewano, which has no delete API.

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
