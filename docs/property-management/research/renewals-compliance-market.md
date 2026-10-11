# PM-04: Renewals, move-out, compliance and tenant communications; market, KPIs and software

Researched 2026-10-11. **VERIFIED [n]** means checked against source n; "secondary" marks vendor or blog sources. **INFERRED** means my own reasoning, not checked this session. None of this is legal advice.

## Area summary
After a lease is signed, a manager's phone and text work runs on deadlines: notice periods for renewals and rent increases, move-out and deposit deadlines, city and HOA deadlines to fix violations, and lead times for notice before entering a unit. Telo fits best where several parties must be coordinated while the person in charge stays reachable. Examples: renewals with the owner approving live, building-wide notices with confirmation calls, the chain from notice to vacate through move-out, and calls into city, HOA and locksmith phone lines. Legal risk concentrates in evictions, deposit deductions and domestic-violence lock changes, so there Telo prepares the work and hands it off. Every call should open by saying it's an AI and is recorded. Keewano should learn from typed outcomes (which increases get accepted, how notice lead time affects vendor access, which promises are kept).

## Use-case catalog (part A)

### 0. Rules for every use case
- **Open every call by saying it's an AI and is recorded.** States that require every party's consent to record include CA, FL, IL, MD, MA, MT, NH, PA and WA. Some lists add DE and NV, and CT and OR use different rules for different call types. Courts may apply the stricter state's rule. VERIFIED secondary [17].
- **AI disclosure laws.** Utah SB 226 requires disclosure when someone clearly asks, and up front in high-risk interactions in licensed occupations. Disclosing at the start and throughout the call is a safe harbor. Fines run up to $2,500. VERIFIED [20]. Maine requires disclosure when AI handles a voice or chat exchange (from Sept 23, 2025). VERIFIED secondary [19].
- **TCPA.** FCC 24-17 (2024) treats AI voices as "artificial", so calls to home or mobile lines need prior express consent. VERIFIED [18]. A number the tenant gave on the lease likely covers informational calls; promotional calls need written consent (INFERRED).
- **Legal notices** must be in writing and served the way the statute says. Telo's text is only a courtesy copy unless the lease and state law allow electronic service (INFERRED).
- **Keewano.** Opaque IDs only: no plates, case numbers, lockbox codes or addresses. One event shared by all flows: `promise_resolved{party: enum(tenant|owner|vendor|city|hoa|locksmith), kind: enum(payment|cure|eta|document|callback), kept: bool, days_late: int}`.

### 1. Renewal offer and negotiation
- **Trigger:** Lease end, minus the legal notice period, minus a buffer.
- **Parties and who approves:** Tenant. The owner sets the allowed increase range (the "band") and approves concessions.
- **Calls and texts:** Outbound SMS offer, then a call. Inbound counteroffers. Mid-call tools `renewal_bounds` (legal cap plus owner band) and `ask_owner`. Callbacks before the notice deadline. Transfer to the property manager (PM) on a dispute.
- **Telo decides alone vs asks:** On its own: offers inside the band and under the cap, term options, reminders. Asks first: counters below the floor, concessions, not renewing.
- **Variables to track:** *Task facts:* current and proposed rent, lease end, whether the unit is exempt from the cap, the tenant's reasons. · *Keewano events:* `renewal_offered{increase_bps: int, cap_regime: enum(ca_ab1482|or|wa|local_rc|none), notice_lead_days: int, term_months: int}` and `renewal_resolved{outcome: enum(renewed|renewed_after_counter|month_to_month|vacating|no_response), final_increase_bps: int, concession_cents: int, rounds: int}` on `lease`. · *KPIs it moves:* renewal rate, average increase, vacancy days, renewal fees.
- **A decision that history changes:** Whether to ask for the maximum legal increase or a lower price that keeps the tenant. Inputs: acceptance rates by increase size at this property, the tenant's on-time payment record, and how long the unit took to re-lease last time.
- **Rules and guardrails:**
  - **California (AB 1482):** cap is 5% plus regional CPI, never above 10%. From Aug 1, 2026 that is 8.7% in the LA area and 8.8% in SF and Marin. VERIFIED [2][3][4]. Single-family homes owned by individuals can be exempt if the lease says so. VERIFIED secondary [2]. Notice is 30 days, or 90 if increases over 12 months total more than 10%. VERIFIED [5].
  - **Oregon:** cap is 9.5% in 2026 and 10% in 2027. Notice is 90 days, and rent can't rise in the first year. VERIFIED [1][8].
  - **Washington (HB 1217):** cap is 9.683% in 2026. Notice is 90 days, and rent can't rise in the first 12 months. VERIFIED [6][7]. Seattle requires 180 days' notice. VERIFIED secondary [8].
  - **New York (RPL 226-c):** 30, 60 or 90 days' notice for increases of 5% or more, depending on how long the tenant has been there. VERIFIED secondary [8].
  - **Local rent control** takes precedence over all of the above.
  - **Fair housing:** apply the same offer rules to every tenant (INFERRED).
- **Products already doing it, and the gap:** AppFolio Realm-X Flows automates renewal workflows. VERIFIED secondary [41]. Colleen AI does renewals and now belongs to Entrata. VERIFIED secondary [44]. The gap: voice negotiation with live owner approval for small firms (INFERRED).
- **Build effort on Telo's engine:** M
- **Demo-ability (1–5):** 5

### 2. Notice to vacate (from tenant or owner)
- **Trigger:** The tenant texts that they're moving out, or the owner won't renew or is selling.
- **Parties and who approves:** Tenant. The owner approves lease-break terms and any notice the owner sends.
- **Calls and texts:** Inbound SMS, then a confirmation call. One attempt to keep the tenant, if the owner allows it. Owner and leasing are told in parallel. Hands off to use case 3.
- **Telo decides alone vs asks:** On its own: acknowledges, checks the notice against the lease, confirms the date, asks for written notice and a forwarding address. Asks first: accepting short notice, lease-break fees, paying the tenant to leave early ("cash for keys").
- **Variables to track:** *Task facts:* move-out date, forwarding address, the reason in the tenant's words. · *Keewano events:* `vacate_notice{initiator: enum(tenant|owner), notice_days_given: int, notice_days_required: int, reason: enum(purchase|relocation|price|maintenance|space|other), retention_offered: bool, retained: bool}` on `lease`. · *KPIs it moves:* turnover rate, vacancy days, retention.
- **A decision that history changes:** If more tenants at a property leave over price, Telo proposes smaller renewal increases there.
- **Rules and guardrails:** Just-cause laws limit when an owner can end a tenancy (CA, OR after the first year, WA), and some require relocation payments (INFERRED).
- **Products already doing it, and the gap:** Tenant portals in property-management software (PMS) accept notices (INFERRED). None try to keep the tenant through conversation.
- **Build effort on Telo's engine:** S
- **Demo-ability (1–5):** 4

### 3. Move-out scheduling, inspections and deposit handoff
- **Trigger:** A confirmed move-out date.
- **Parties and who approves:** Tenant, inspector, cleaners and vendors. The PM or owner approves deductions.
- **Calls and texts:** SMS offering pre-move-out inspection times and key-return reminders. Photos by MMS. Parallel vendor calls to get the unit ready. Booking the final inspection.
- **Telo decides alone vs asks:** On its own: scheduling, reminders, pre-approved cleaning under the spending limit. Asks first: deductions, disputes, waivers.
- **Variables to track:** *Task facts:* forwarding address, photos, condition notes. · *Keewano events:* `move_out_inspection{kind: enum(pre|final), lead_hours: int, tenant_present: bool, issue_count: int}` on `unit`; `deposit_handoff{days_after_vacate: int, deduction_cents: int, disputed: bool}` on `lease`. · *KPIs it moves:* days to get the unit ready, deposits returned on time, disputes.
- **A decision that history changes:** Vendors' past turnaround on this unit decides which cleaner to book and when to list the unit. If pre-move-out inspections lead to fewer disputes, Telo offers them by default.
- **Rules and guardrails:** California Civil Code 1950.5(f): if the tenant asks, the landlord inspects no earlier than two weeks before the lease ends, with 48 hours' written notice. The deposit, or a list of deductions, is due within 21 days. VERIFIED [22]. AB 2801 added photo requirements during 2025; sources disagree on the exact dates. VERIFIED [23]. Telo never decides deductions.
- **Products already doing it, and the gap:** Realm-X Flows covers unit turnovers. VERIFIED secondary [41]. The gap: scheduling the tenant and vendors by phone.
- **Build effort on Telo's engine:** M
- **Demo-ability (1–5):** 4

### 4. From late rent to an eviction handoff
- **Trigger:** Rent is still unpaid after the grace period.
- **Parties and who approves:** Tenant. The owner approves payment plans and filing. An attorney files.
- **Calls and texts:** SMS, then a call. `ask_owner` mid-call about a payment plan. The tenant's promise to pay is tracked, with a callback on the due date. A handoff packet goes to the attorney.
- **Telo decides alone vs asks:**
  - On its own: reminders, the balance, payment plans within its limits, referrals to rental assistance.
  - Asks first: other plans, waiving fees, legal notices, filing.
  - Never: legal advice, threats, telling third parties about the debt, serving notices by text.
- **Variables to track:** *Task facts:* the ledger, any hardship, promises made. · *Keewano events:* `rent_late{days_late: int, balance_cents: int, covered_property: enum(yes|no|unknown), subsidy: enum(none|hcv|pbra|public|lihtc)}` on `tenant_account`; `eviction_handoff{days_late: int, balance_cents: int, notice_kind: enum(pay_or_quit|cares_30|hud_30|other)}` on `lease`. · *KPIs it moves:* delinquency, collections, eviction filings per 100 units.
- **A decision that history changes:** How often the tenant kept past promises decides whether Telo offers another plan or escalates.
- **Rules and guardrails:**
  - **CARES Act** (15 U.S.C. 9058(c)): 30 days' notice at "covered properties", meaning those with federally backed mortgages or in federal programs (INFERRED). Iowa's Supreme Court said the rule lapsed (Jan 2025), but a Bronx court still applied it in 2025, so it's unsettled. VERIFIED [9][10][11].
  - **HUD's 2024 rule:** 30 days' notice in public housing and project-based rental assistance (PBRA), in effect since Jan 13, 2025. HUD's move to revoke it was put on hold indefinitely on Mar 13, 2026. VERIFIED [12][13][14].
  - **Who can go to court:** Texas lets property managers represent owners in justice-court evictions (Rule 500.4). VERIFIED [21]. Elsewhere, owners that are companies usually need a lawyer (INFERRED).
  - **Debt-collection law:** the federal Fair Debt Collection Practices Act generally doesn't cover managers collecting rent that wasn't yet late when they took the account (INFERRED).
- **Products already doing it, and the gap:** EliseAI's delinquency outreach [41], AppFolio's rent recovery [42], Colleen (now Entrata) [44]. All VERIFIED secondary. The gap: small firms, flagging covered properties, attorney packets (INFERRED).
- **Build effort on Telo's engine:** L
- **Demo-ability (1–5):** 3

### 5. City registration, inspections and code enforcement
- **Trigger:** A registration renewal date, or a city inspection or violation letter received by MMS.
- **Parties and who approves:** City office, tenant (for access), vendors. The owner approves spending, fees and appeals.
- **Calls and texts:** Calls into city lines, through phone menus and hold. SMS notices to tenants before entry. Parallel vendor calls. Booking the re-inspection.
- **Telo decides alone vs asks:** On its own: scheduling, entry notices, repairs under the spending limit. Asks first: larger spending, fees, appeals.
- **Variables to track:** *Task facts:* case number, violation text, inspector contact. · *Keewano events:* `city_inspection{kind: enum(registration|periodic|complaint|reinspection), result: enum(pass|fail|rescheduled|no_access), violation_count: int}` on `unit`; `code_violation{category: enum(life_safety|habitability|exterior|trash|permit|other), cure_days_allowed: int, cured_on_time: bool, fine_cents: int}` on `property`. · *KPIs it moves:* violations fixed on time, fines avoided.
- **A decision that history changes:** If a property failed a category before, Telo books a vendor to check it before the next inspection.
- **Rules and guardrails:** Programs vary by city. Entry-notice rules apply, and so do rules against retaliating after a tenant complains (INFERRED, e.g., California Civil Code 1942.5).
- **Products already doing it, and the gap:** None found (INFERRED).
- **Build effort on Telo's engine:** M
- **Demo-ability (1–5):** 4 (shows phone menus and hold)

### 6. HOA violation notices
- **Trigger:** The owner or the HOA's community manager forwards a violation letter.
- **Parties and who approves:** HOA manager and tenant. The owner pays or contests the fine. The PM approves passing the cost on to the tenant.
- **Calls and texts:** The letter arrives by MMS. SMS to the tenant with the fix-by date. A call to the HOA manager to confirm the fix or get an extension. Vendor dispatch.
- **Telo decides alone vs asks:** On its own: tells the tenant, asks for extensions, books fixes under the spending limit. Asks first: paying or contesting fines, hearings, passing costs to the tenant.
- **Variables to track:** *Task facts:* the letter, the HOA contact. · *Keewano events:* `hoa_violation{category: enum(landscape|trash_bins|parking|noise|pets|architectural|other), fine_cents: int, cure_days: int, cured: bool, repeat_index: int}` on `unit`. · *KPIs it moves:* fines per unit, owner retention.
- **A decision that history changes:** If this HOA usually grants extensions, Telo asks for one; if not, it books the fix right away.
- **Rules and guardrails:** HOA rules (CC&Rs) and state HOA laws give notice and a hearing before fines. Passing costs to the tenant needs a lease clause (INFERRED).
- **Products already doing it, and the gap:** Only HOA-side software (INFERRED).
- **Build effort on Telo's engine:** S
- **Demo-ability (1–5):** 4

### 7. Building-wide notices (water shutoff, pest treatment, fire-alarm test)
- **Trigger:** Scheduled vendor or utility work.
- **Parties and who approves:** All tenants and the vendor. The PM approves reschedules that cost money.
- **Calls and texts:** Parallel SMS with the notice attached by MMS. Calls to tenants who haven't confirmed. Answers questions. Prep checklists for pest treatment.
- **Telo decides alone vs asks:** On its own: sends notice with the legal lead time, collects confirmations, logs access problems. Asks first: delays, compensation.
- **Variables to track:** *Task facts:* access notes per unit (pets, medical). · *Keewano events:* `building_notice{kind: enum(water_shutoff|pest|fire_alarm_test|power|other), lead_hours: int, unit_count: int}` on `property`; `notice_ack{acked: bool, minutes_to_ack: int, access: enum(ok|pet|medical|no_answer|refused)}` on `unit`. · *KPIs it moves:* how often vendors get in, trip charges avoided.
- **A decision that history changes:** Units where the vendor couldn't get in before get earlier, repeated calls.
- **Rules and guardrails:** Notice required before entering a unit. Sources disagree on some states. VERIFIED secondary [15][16].
  - **24 hours:** CA in writing (48 hours for a pre-move-out inspection); FL, OR, UT.
  - **48 hours:** DE, VT.
  - **2 days:** WA, for repairs.
  - **"Reasonable":** MN.
  - **No statute:** TX, GA, AR.
- **Products already doing it, and the gap:** PMS mass texting is one-way (INFERRED). The gap: confirmations and follow-up when a vendor couldn't get in.
- **Build effort on Telo's engine:** S
- **Demo-ability (1–5):** 5

### 8. Noise, neighbor and parking complaints
- **Trigger:** A complaint by text or call, including blocked parking spots and abandoned cars.
- **Parties and who approves:** The complaining tenant, the other tenant, the HOA, a tow company. The PM approves formal notices and every tow.
- **Calls and texts:** Takes the complaint, with MMS photos. Sends a neutral SMS or call to the other tenant without naming who complained. Calls back to follow up. Tells callers to dial 911 in emergencies; Telo never dials it.
- **Telo decides alone vs asks:** On its own: logging, reminders about quiet hours or parking, follow-ups. Asks first: lease-violation notices, tows.
- **Variables to track:** *Task facts:* who is involved, plates, details. · *Keewano events:* `neighbor_complaint{category: enum(noise|odor|pets|parking|harassment|safety), time_bucket: enum(day|evening|night), role: enum(complainant|subject), repeats_30d: int, days_to_resolve: int, escalated: bool}` on `unit`. · *KPIs it moves:* retention of tenants who complain, repeat complaints.
- **A decision that history changes:** A third complaint about the same unit within 30 days (the owner sets the number) leads Telo to recommend a formal notice. An unresolved complaint marks the complaining tenant's renewal as at risk.
- **Rules and guardrails:** Fair housing, keeping the complaining tenant's identity confidential, no retaliation. Towing requires posted signs (INFERRED, e.g., California Vehicle Code 22658). Harassment and safety issues go to a human.
- **Products already doing it, and the gap:** None found (INFERRED).
- **Build effort on Telo's engine:** S
- **Demo-ability (1–5):** 4

### 9. Lockouts and key management
- **Trigger:** A lockout (often after hours), a lost key, rekeying between tenants, or a request to change locks because of domestic violence (DV).
- **Parties and who approves:** Tenant, locksmith, the on-call PM. The owner approves unusual spending.
- **Calls and texts:** Inbound call. Identity check through a mid-call lease lookup. Parallel locksmith calls for arrival time and price. Cold transfer to on-call staff. Access details by SMS only after the caller is verified.
- **Telo decides alone vs asks:** On its own: sends a locksmith within the price limit, schedules rekeys. Asks first: access for anyone not on the lease, fee waivers.
- **Variables to track:** *Task facts:* lockbox codes (secret), identity answers. · *Keewano events:* `lockout{time_bucket: enum(business|after_hours), resolution: enum(self|staff|locksmith|denied), minutes_to_resolve: int, fee_cents: int}` and `rekey{trigger: enum(turnover|lost_key|dv_request|break_in), days_after_trigger: int, cost_cents: int}` on `unit`. · *KPIs it moves:* staff time after hours, rekeys done on time.
- **A decision that history changes:** Locksmiths' on-time records set the order Telo calls them in.
- **Rules and guardrails:** California Civil Code 1941.5 and 1941.6: change the locks within 24 hours of a documented DV request, at the landlord's cost. VERIFIED [24]. Texas Property Code 92.156: rekey within 7 days of each change of tenant. VERIFIED [25]. In Texas, 72 hours is presumed reasonable after a tenant reports a break-in. VERIFIED secondary [26]. DV requests go to a human.
- **Products already doing it, and the gap:** Smart-lock tools (INFERRED). The gap: phone triage with identity checks and calling several locksmiths at once.
- **Build effort on Telo's engine:** M
- **Demo-ability (1–5):** 4

### 10. Tenant check-ins
- **Trigger:** 7 and 30 days after move-in, mid-lease, before the renewal window, and after a work order closes.
- **Parties and who approves:** Tenant. The PM sees anything escalated.
- **Calls and texts:** Outbound SMS or a short call. Scheduled callbacks. Problems are passed to maintenance.
- **Telo decides alone vs asks:** Runs on its own and escalates complaints.
- **Variables to track:** *Task facts:* the tenant's comments. · *Keewano events:* `tenant_checkin{kind: enum(move_in_7|move_in_30|mid_lease|pre_renewal|post_work_order), score_1_5: int, issue_found: bool, renewal_intent: enum(likely|unsure|unlikely|no_answer)}` on `lease`. · *KPIs it moves:* renewal rate, problems caught early.
- **A decision that history changes:** If the tenant says renewal is unlikely and has open issues, Telo makes a retention offer earlier.
- **Rules and guardrails:** TCPA consent, AI disclosure and opt-outs (section 0).
- **Products already doing it, and the gap:** EliseAI-style messaging for large apartment operators. VERIFIED secondary [41]. Small single-family firms aren't served (INFERRED).
- **Build effort on Telo's engine:** S
- **Demo-ability (1–5):** 5

## Build first / Keep human or avoid
**Build first**
- **Renewal negotiation:** a calculator for caps and notice periods, `ask_owner` mid-call, and history of which increases were accepted. It brings the most revenue and makes the best demo.
- **Building-wide notices** with confirmations collected in parallel.
- **Notice to vacate**, then the move-out inspection, then the deposit handoff.
- **Check-ins before renewal** that feed into renewal offers.
- **Booking a city inspection** through phone menus and hold, which shows what Dial can do.

**Keep human or avoid**
- Legal notices, eviction filings and court appearances. Telo only builds the handoff packet.
- Deposit deductions and disputes.
- Complaints about DV, harassment, safety or discrimination.
- Rent increases on rent-controlled units.
- Deciding who gets concessions (fair housing). The owner's rules decide, not the model's judgment.
- Tows, HOA hearings and appeals of city citations.

## Market, KPIs and software (part B)

### 1. Firms, units and staffing
- There are 340,403 US property-management businesses in 2026, across all property types, up 2.4% from 2025. VERIFIED [28].
- The top 20 managers run about 3.23M units, about 7.15% of 45.2M rented homes (2024). VERIFIED secondary [29]. The share of single-family rentals run by a third-party manager rose from 30% in 2017 to 36% in 2024. VERIFIED, sponsored study [30].
- **Staffing.** I found no public benchmark per maintenance coordinator. VERIFIED secondary [31]:
  - NARPM: about 49 units per direct team member; the top firms reach 59.
  - AppFolio: about 54 units per employee.
  - NAR (2022): median 40 properties per manager.

### 2. KPIs and pains
- **KPIs (INFERRED):** days vacant, delinquency, work-order cycle time, vendor response time, days to get a unit ready, renewal rate, owner retention, deposit disputes.
- **Buildium 2026.** VERIFIED [27]:
  - 75% of managers saw more rental fraud.
  - 75% plan to grow, but only 55% grew in 2025.
  - Firms are dropping accounts that take too much work.
  - AI has become "essential".

  An earlier edition pointed to labor shortages. VERIFIED [45].
- **Phone-related pains (INFERRED):** after-hours calls, notice deadlines, and coordinating with cities, HOAs and vendors, which no PMS automates.

### 3. Revenue
- **Fees.** VERIFIED, from a 2022 survey plus secondary sources [32]:
  - Management fee: average 8.49% of rent (range 3.75% to 14%), or about $101 per unit per month as a flat fee.
  - Placement: about 70.6% of one month's rent.
  - Renewal: about $212 flat.
  - Maintenance markup: commonly 10% to 20%.
- **Revenue movers (INFERRED):**
  - Renewals: the fee itself, plus no vacant months.
  - Collections: fees are often charged on rent collected [32].
  - Faster turnovers.
  - Coordinated maintenance, which carries the markup.
  - Fewer fines, which helps keep owners.

### 4. PMS APIs
- **Buildium:** official Open API with read and write access, webhooks and a sandbox, on the Premium plan. VERIFIED secondary [33][38]. The best first target.
- **AppFolio Stack:** requires a partner application and a security review. Read-only on Plus, read and write on Max. VERIFIED secondary [34].
- **Rent Manager:** REST API; partner tokens are required in production. VERIFIED secondary [35][37].
- **Yardi Breeze:** no public API. VERIFIED secondary [36].
- **Rentvine and DoorLoop:** public APIs, according to vendor docs (INFERRED).
- **Unified APIs** (Propexo, Nango, Supergood) cover several of these systems through one integration. VERIFIED [33][37][38].

### 5. AI products and the gap
- **AppFolio Realm-X.** VERIFIED, some secondary:
  - Leasing and Maintenance "Performers" (June 2025) [39].
  - Flows for renewals and rent recovery [41][42].
  - Over 99% of customers use AI features (Q1 2026) [42][46].
  - A new Realm-X (Sept 29, 2026) with a connector to Claude agents, according to the headline [40].
- **EliseAI:** leasing, maintenance routing and delinquency outreach for large apartment operators. VERIFIED secondary [41].
- **Colleen AI:** renewals and collections; Entrata bought it in June 2024. VERIFIED secondary [44].
- **Vendoroo:** AI maintenance coordination for small single-family and multifamily firms on AppFolio, Buildium, Rentvine and Rent Manager. It claims 500+ firms. VERIFIED, vendor claim [43].
- **Latchel:** maintenance coordination (INFERRED).
- **The gap (INFERRED):** AI agents focus on leasing and maintenance inside the big platforms. For firms with 20 to 500 units, no product does any of these:
  - negotiates renewals by voice with live owner approval;
  - calls cities, HOAs and locksmiths;
  - runs move-out and compliance work against its deadlines.

## Sources
1. https://apps.oregon.gov/oregon-newsroom/OR/DAS/Posts/Post/das-publishes-annual-maximum-rent-increase-2027
2. https://sf.gov/information/california-tenant-protection-act-2019-ab-1482
3. https://www.marincounty.gov/departments/cda/housing-and-grants/renting-marin/rent-increase
4. https://dcba.lacounty.gov/news/understanding-rent-increases/
5. https://www.oag.ca.gov/system/files/media/Know-Your-Rights-Tenants-English.pdf
6. https://washingtonstatestandard.com/briefs/was-new-rent-cap-set-just-below-10-for-2026/
7. https://www.atg.wa.gov/news/news-releases/consumer-alert-attorney-general-s-office-issues-know-your-rights-flyers-12
8. https://managecasa.com/articles/rent-increase-notice
9. https://naahq.org/news/iowa-supreme-court-no-permanent-cares-act
10. https://www.nycourts.gov/reporter/3dseries/2025/2025_25076.htm
11. https://www.nmhc.org/advocacy/comment-letters/2025/real-estate-industry-letter-to-president-trump-on-cares-act-notice-to-vacate
12. https://www.govinfo.gov/content/pkg/FR-2024-12-13/html/2024-28861.htm
13. https://www.nixonpeabody.com/insights/alerts/2026/02/26/hud-rescinds-30-day-notice-requirement-for-nonpayment-evictions
14. https://www.govinfo.gov/content/pkg/FR-2026-03-13/pdf/2026-04990.pdf
15. https://www.nolo.com/legal-encyclopedia/free-books/renters-rights-book/chapter8-1.html
16. https://tellusapp.com/blog/landlord-right-of-entry-laws-notice-to-enter-by-state
17. https://viirtue.com/call-recording-consent-laws-by-state-2026-guide/
18. https://www.bhfs.com/insight/fcc-declares-ai-generated-calls-subject-to-tcpa/
19. https://www.compliancepoint.com/?p=20040
20. https://perkinscoie.com/insights/update/new-utah-ai-laws-change-disclosure-requirements-and-identity-protections-target
21. https://guides.sll.texas.gov/c.php?g=299024
22. https://california.public.law/codes/ca_civ_code_section_1950.5
23. https://baylegal.com/ab-2801-security-deposit-photo-documentation-rules/
24. https://www.womenslaw.org/laws/ca/housing-laws/changing-locks
25. https://codes.findlaw.com/tx/property-code/prop-sect-92-156/
26. https://texaslawhelp.org/sites/default/files/2025-09/locks_and_other_security_devices_-_austin_tenants_council.pdf
27. https://www.buildium.com/resource/2026-property-management-industry-report/
28. https://www.ibisworld.com/industry-statistics/number-of-businesses/property-management-united-states/
29. https://ipropertymanagement.com/research/property-management-industry-statistics
30. https://www.accessnewswire.com/newsroom/en/real-estate/the-property-management-trends-report-reveals-massive-surge-in-professionally-managed-u.-943013
31. https://www.lethub.co/blog/doors-per-leasing-agent-benchmarks
32. https://ipropertymanagement.com/research/average-property-management-fees
33. https://supergood.ai/api-report-card/buildium
34. https://supergood.ai/api-report-card/appfolio
35. https://supergood.ai/api-report-card/rentmanager
36. https://supergood.ai/api-report-card/yardi-breeze
37. https://propexo-knowledge-base.help.usepylon.com/articles/8454638524-creating-a-rent-manager-integration
38. https://www.nango.dev/docs/integrations/all/buildium
39. https://www.appfolio.com/newsroom/appfolio-ai-agents
40. https://www.appfolio.com/newsroom/appfolio-introduces-the-new-realm-x
41. https://www.usecarly.com/blog/best-ai-automation-tools-appfolio/
42. https://financialfilings.com/filings/appfolio-inc/call-transcript/2026/48463537/
43. https://vendoroo.ai
44. https://app.dealroom.co/companies/colleen_ai
45. https://www.multifamilyexecutive.com/property-management/buildium-survey-shows-strongest-trends-in-property-management_o
46. https://www.chartmill.com/news/external/36677/appfolio-realm-x-shows-how-ai-agents-are-reshaping-rentals
