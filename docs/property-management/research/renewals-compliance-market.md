# PM-04: Renewals, move-out, compliance, tenant communications; market and software

Researched 2026-10-11. **VERIFIED [n]** means I checked the claim against source n ("secondary" means a vendor or blog page). **INFERRED** means my own reasoning, not checked. Not legal advice.

## Area summary
After a lease is signed, a manager's calls and texts are driven by deadlines: notice periods for renewals and rent increases, move-out and deposit deadlines, city and HOA dates for fixing violations, and notice before entering a unit. Telo fits work that involves several parties plus a decision-maker it can reach mid-call. Examples are renewals the owner approves live, building-wide notices, the steps from move-out notice to move-out, and calls into city, HOA and locksmith lines. Evictions, deposit deductions and domestic-violence (DV) lock changes carry the legal risk. In those, Telo prepares the work and hands it to a person. Every call opens by saying the caller is an AI and the call is recorded.

## Use-case catalog (part A)

### 0. Rules for every use case
- **Say it's an AI and the call is recorded, at the start of every call.**
  - **Recording consent:** states that require every party's consent include CA, FL, IL, MD, MA, MT, NH, PA and WA. VERIFIED secondary [17].
  - **Utah SB 226:** say it's AI when clearly asked; saying so up front is a safe harbor. VERIFIED [20].
  - **Maine:** requires disclosing AI (from Sept 23, 2025). VERIFIED secondary [19].
- **TCPA:** AI voices count as "artificial" (FCC 24-17), so calls need prior express consent. VERIFIED [18].
- **Legal notices:** served in writing, as each statute requires. Telo's texts are only courtesy copies (INFERRED).
- **Keewano:** opaque IDs only. One event shared by every flow: `promise_resolved{party: enum(tenant|owner|vendor|city|hoa|locksmith), kind: enum(payment|cure|eta|document|callback), kept: bool, days_late: int}`.

### 1. Renewal offer and negotiation
- **Trigger:** Lease end, minus the legal notice period, minus a buffer.
- **Parties and who approves:** Tenant. The owner sets the increase band and approves concessions.
- **Calls and texts:** SMS offer, then a call. Inbound counteroffers. Mid-call tools `renewal_bounds` and `ask_owner`. Callbacks before the deadline. Transfer to the property manager (PM) if the tenant disputes.
- **Telo decides alone vs asks:** Alone: offers within the band and the cap. Asks: counteroffers below the floor, concessions, not renewing.
- **Variables to track:** *Task facts:* current and proposed rent, lease end, cap exemption, the tenant's reasons. · *Keewano events:* `renewal_offered{increase_bps: int, cap_regime: enum(ca_ab1482|or|wa|local_rc|none), notice_lead_days: int}` and `renewal_resolved{outcome: enum(renewed|countered|month_to_month|vacating|no_response), final_increase_bps: int, concession_cents: int}` on `lease`. · *KPIs it moves:* renewal rate, average increase, vacancy days, renewal fees.
- **A decision that history changes:** Whether to ask for the maximum legal increase or a lower price that keeps the tenant, based on how often each increase size was accepted and on the tenant's on-time record.
- **Rules and guardrails:**
  - **California (AB 1482):** 5% plus regional CPI, capped at 10%. From Aug 1, 2026: 8.7% in the LA area, 8.8% in SF and Marin. Notice is 30 days, or 90 if the 12-month total exceeds 10%. Some homes owned by individuals are exempt. VERIFIED [2][3][4][5].
  - **Oregon:** 9.5% in 2026, 10% in 2027, 90 days' notice. VERIFIED [1][8].
  - **Washington:** 9.683% in 2026, 90 days' notice. VERIFIED [6][7].
  - **Seattle:** 180 days' notice. VERIFIED secondary [8].
  - **New York:** 30, 60 or 90 days' notice for increases of 5% or more. VERIFIED secondary [8].
  - **Local rent control** takes precedence. Apply the same rules to every tenant (INFERRED).
- **Products already doing it, and the gap:** Realm-X Flows [41]; Colleen AI, now owned by Entrata [44]. Both VERIFIED secondary. Gap: voice negotiation with live owner approval for small firms (INFERRED).
- **Build effort on Telo's engine:** M
- **Demo-ability (1–5):** 5

### 2. Notice to vacate, move-out and deposit handoff
- **Trigger:** The tenant texts that they're leaving, or the owner won't renew.
- **Parties and who approves:** Tenant, inspector, cleaners. The owner approves lease-break terms, notices the owner starts, and deductions.
- **Calls and texts:** Inbound SMS. A confirmation call with one attempt to keep the tenant. SMS with inspection slots and key reminders. Photos by MMS. Parallel calls to vendors to get the unit ready.
- **Telo decides alone vs asks:** Alone: acknowledges the notice, checks it against the lease, schedules inspections, books pre-approved cleaning. Asks: short notice, lease-break fees, deductions.
- **Variables to track:** *Task facts:* move-out date, forwarding address, reason in the tenant's words, photos. · *Keewano events:* `vacate_notice{initiator: enum(tenant|owner), notice_days_given: int, reason: enum(purchase|relocation|price|maintenance|space|other), retained: bool}` on `lease`; `move_out_inspection{kind: enum(pre|final), lead_hours: int, issue_count: int}` on `unit`; `deposit_handoff{days_after_vacate: int, deduction_cents: int, disputed: bool}` on `lease`. · *KPIs it moves:* turnover days, retention, deposit disputes.
- **A decision that history changes:** When more tenants at a property leave over price, Telo lowers that property's renewal band.
- **Rules and guardrails:** California Civil Code 1950.5(f): if the tenant asks, the landlord inspects within two weeks of lease end, with 48 hours' written notice. The deposit, or an itemized list of deductions, is due within 21 days. VERIFIED [22]. AB 2801 added photo rules in 2025. VERIFIED [23]. Telo never decides deductions.
- **Products already doing it, and the gap:** Realm-X Flows handles unit turnovers. VERIFIED secondary [41]. Gap: taking the notice in conversation and scheduling by phone.
- **Build effort on Telo's engine:** M
- **Demo-ability (1–5):** 4

### 3. From late rent to an eviction handoff
- **Trigger:** Rent still unpaid after the grace period.
- **Parties and who approves:** Tenant. The owner approves payment plans and filing. An attorney files.
- **Calls and texts:** SMS, then a call. `ask_owner` mid-call about plans. The tenant's promise is tracked, with a callback on the due date. A handoff packet goes to the attorney.
- **Telo decides alone vs asks:**
  - **Alone:** reminders, the balance, plans within limits, referrals to rental assistance.
  - **Asks:** other plans, fee waivers, notices, filing.
  - **Never:** legal advice, threats, telling third parties.
- **Variables to track:** *Task facts:* ledger, hardship, promises. · *Keewano events:* `rent_late{days_late: int, balance_cents: int, covered_property: enum(yes|no|unknown), subsidy: enum(none|hcv|pbra|public|lihtc)}` on `tenant_account`; `eviction_handoff{days_late: int, balance_cents: int, notice_kind: enum(pay_or_quit|cares_30|hud_30|other)}` on `lease`. · *KPIs it moves:* delinquency, collections, filings per 100 units.
- **A decision that history changes:** How often the tenant kept past promises decides whether Telo offers another plan or escalates.
- **Rules and guardrails:**
  - **CARES Act 30-day notice:** applies to covered properties, meaning those with federally backed mortgages or in federal programs (INFERRED). Unsettled: Iowa's Supreme Court said it lapsed, but a Bronx court applied it in 2025. VERIFIED [9][10][11].
  - **HUD 30-day rule:** covers public housing and project-based rental assistance, in effect since Jan 13, 2025. Its revocation has been on hold since Mar 13, 2026. VERIFIED [12][13][14].
  - **Who can file:** Texas lets managers represent owners in eviction court. VERIFIED [21]. Elsewhere, owners that are companies usually need lawyers (INFERRED).
  - **Debt-collection law:** the FDCPA generally doesn't cover managers collecting current accounts (INFERRED).
- **Products already doing it, and the gap:** EliseAI [41], AppFolio rent recovery [42], Colleen/Entrata [44]. All VERIFIED secondary. Gap: small firms, flagging covered properties, attorney packets (INFERRED).
- **Build effort on Telo's engine:** L
- **Demo-ability (1–5):** 3

### 4. City and HOA compliance (registration, inspections, code and HOA violations)
- **Trigger:** A registration due date, or a city inspection, code-violation or HOA letter sent by MMS.
- **Parties and who approves:** City or HOA manager, tenant, vendors. The owner approves spending, fines, appeals and chargebacks to the tenant.
- **Calls and texts:** Calls to city and HOA lines (phone menus, hold). SMS entry notices and fix-by dates. Parallel vendor calls. Re-inspections and extension requests.
- **Telo decides alone vs asks:** Alone: scheduling, notices, repairs under the limit, extension requests. Asks: larger spending, fines, appeals.
- **Variables to track:** *Task facts:* case number, letter text, contacts. · *Keewano events:* `city_inspection{kind: enum(registration|periodic|complaint|reinspection), result: enum(pass|fail|rescheduled|no_access), violation_count: int}` on `unit`; `violation{source: enum(city|hoa), category: enum(life_safety|habitability|exterior|trash|parking|pets|architectural|other), cure_days: int, cured_on_time: bool, fine_cents: int}` on `property`. · *KPIs it moves:* violations fixed on time, fines per unit, owner retention.
- **A decision that history changes:** Categories a property failed before trigger a vendor check ahead of the inspection. HOAs that usually grant extensions get asked for one.
- **Rules and guardrails:** City programs vary. HOAs must give notice and a hearing before fines. Landlords may not retaliate against tenants who complain (INFERRED).
- **Products already doing it, and the gap:** None found on the manager side (INFERRED).
- **Build effort on Telo's engine:** M
- **Demo-ability (1–5):** 4 (shows phone menus and hold)

### 5. Building-wide notices (water shutoff, pest treatment, fire-alarm test)
- **Trigger:** Scheduled vendor or utility work.
- **Parties and who approves:** All tenants and the vendor. The PM approves reschedules that cost money.
- **Calls and texts:** Parallel SMS with the notice attached by MMS. Calls to tenants who haven't confirmed. Answers to questions. Prep checklists for pest treatment.
- **Telo decides alone vs asks:** Alone: gives notice with the legal lead time, collects confirmations, logs access problems. Asks: delays, compensation.
- **Variables to track:** *Task facts:* access notes for each unit (pets, medical). · *Keewano events:* `building_notice{kind: enum(water_shutoff|pest|fire_alarm_test|power|other), lead_hours: int, unit_count: int}` on `property`; `notice_ack{acked: bool, minutes_to_ack: int, access: enum(ok|pet|medical|no_answer|refused)}` on `unit`. · *KPIs it moves:* share of units vendors can get into, trip charges avoided.
- **A decision that history changes:** Units vendors couldn't get into last time get called earlier, and more than once.
- **Rules and guardrails:** Notice required before entering a unit. VERIFIED secondary [15][16]; sources conflict for some states.
  - **24 hours:** CA (in writing), FL, OR, UT.
  - **48 hours:** DE, VT.
  - **2 days:** WA (repairs).
  - **"Reasonable":** MN.
  - **No statute:** TX, GA, AR.
- **Products already doing it, and the gap:** Mass texting in property-management software (PMS) is one-way (INFERRED). Gap: collecting confirmations, and following up when a vendor can't get in.
- **Build effort on Telo's engine:** S
- **Demo-ability (1–5):** 5

### 6. Noise, neighbor and parking complaints
- **Trigger:** A complaint by text or call, including parking problems.
- **Parties and who approves:** The person complaining, the other tenant, the HOA, a tow company. The PM approves formal notices and every tow.
- **Calls and texts:** Takes the complaint, with MMS photos. Sends a neutral SMS or call to the other tenant without naming who complained. Calls back to follow up. Tells callers to dial 911 in an emergency.
- **Telo decides alone vs asks:** Alone: logging, reminders, follow-ups. Asks: lease-violation notices, tows.
- **Variables to track:** *Task facts:* who is involved, plates. · *Keewano events:* `neighbor_complaint{category: enum(noise|odor|pets|parking|harassment|safety), time_bucket: enum(day|evening|night), role: enum(complainant|subject), repeats_30d: int, escalated: bool}` on `unit`. · *KPIs it moves:* retention of tenants who complain, repeat complaints.
- **A decision that history changes:** A third complaint within 30 days (the owner sets the number) leads Telo to recommend a formal notice.
- **Rules and guardrails:** Fair housing, keep the complainant's identity confidential, no retaliation. Tows need posted signs (INFERRED). Harassment and safety issues go to a person.
- **Products already doing it, and the gap:** None found (INFERRED).
- **Build effort on Telo's engine:** S
- **Demo-ability (1–5):** 4

### 7. Lockouts and key management
- **Trigger:** A lockout (often after hours), a lost key, rekeying between tenants, or a DV lock change.
- **Parties and who approves:** Tenant, locksmith, the on-call PM. The owner approves unusual spending.
- **Calls and texts:** Inbound call. Identity check through a mid-call lease lookup. Parallel calls to locksmiths for arrival time and price. Cold transfer to on-call staff. Access details by SMS only after the caller is verified.
- **Telo decides alone vs asks:** Alone: sends a locksmith within the price limit, schedules rekeys. Asks: access for anyone not on the lease, fee waivers.
- **Variables to track:** *Task facts:* lockbox codes (secret), identity answers. · *Keewano events:* `lockout{time_bucket: enum(business|after_hours), resolution: enum(self|staff|locksmith|denied), minutes_to_resolve: int, fee_cents: int}` and `rekey{trigger: enum(turnover|lost_key|dv_request|break_in), days_after_trigger: int}` on `unit`. · *KPIs it moves:* staff time after hours, rekeys done on time.
- **A decision that history changes:** Each locksmith's on-time record decides who Telo calls first.
- **Rules and guardrails:**
  - **California Civil Code 1941.5 and 1941.6:** change the locks within 24 hours of a documented DV request; the landlord pays. VERIFIED [24].
  - **Texas Property Code 92.156:** rekey within 7 days of each change of tenant. VERIFIED [25]. Texas presumes 72 hours is reasonable after a reported break-in. VERIFIED secondary [26].
  - DV cases go to a person.
- **Products already doing it, and the gap:** Smart-lock tools (INFERRED). Gap: phone triage plus calling several locksmiths at once.
- **Build effort on Telo's engine:** M
- **Demo-ability (1–5):** 4

### 8. Tenant check-ins
- **Trigger:** 7 and 30 days after move-in, mid-lease, before the renewal window, and after a work order closes.
- **Parties and who approves:** Tenant. The PM sees escalations.
- **Calls and texts:** Outbound SMS or a short call. Callbacks. Problems routed to maintenance.
- **Telo decides alone vs asks:** Runs alone and escalates complaints.
- **Variables to track:** *Task facts:* comments. · *Keewano events:* `tenant_checkin{kind: enum(move_in_7|move_in_30|mid_lease|pre_renewal|post_work_order), score_1_5: int, issue_found: bool, renewal_intent: enum(likely|unsure|unlikely|no_answer)}` on `lease`. · *KPIs it moves:* renewal rate, problems caught early.
- **A decision that history changes:** If the tenant says renewal is unlikely and has open issues, Telo makes a retention offer earlier.
- **Rules and guardrails:** TCPA consent, AI disclosure and opt-outs (see section 0).
- **Products already doing it, and the gap:** EliseAI-style messaging, built for large apartment operators. VERIFIED secondary [41]. Small single-family firms are not served (INFERRED).
- **Build effort on Telo's engine:** S
- **Demo-ability (1–5):** 5

## Build first / Keep human or avoid
**Build first**
- **Renewal negotiation:** a cap and notice calculator, `ask_owner`, and a record of which increases were accepted. Most revenue and the best demo.
- **Building-wide notices** with confirmations gathered in parallel.
- **Notice to vacate** through move-out to deposit handoff.
- **Check-ins before renewal.**
- **Booking a city inspection** through phone menus and hold, which shows off Dial.

**Keep human or avoid**
- Legal notices, eviction filings and court. Telo only builds the packet.
- Deposit deductions and disputes.
- DV, harassment, safety and discrimination.
- Increases on rent-controlled units.
- Who gets concessions: the owner's rules decide, not the model.
- Tows, HOA hearings, citation appeals.

## Market, KPIs and software (part B)

### 1. Firms, units and staffing
- **Firms:** 340,403 US property-management businesses in 2026, all property types. VERIFIED [28].
- **Concentration:** the top 20 managers run about 3.23M units, roughly 7.15% of rented homes (2024). VERIFIED secondary [29].
- **Single-family rentals:** the share run by third-party managers grew from 30% (2017) to 36% (2024). VERIFIED, sponsored study [30].
- **Staffing:** about 49 units per direct team member (NARPM), 54 per employee (AppFolio), and a median of 40 properties per manager (NAR, 2022). VERIFIED secondary [31]. I found no benchmark for maintenance coordinators.

### 2. KPIs and pains
- **KPIs (INFERRED):** days vacant, delinquency, work-order cycle time, vendor response, days to ready a unit, renewal rate, owner retention.
- **Buildium 2026:** VERIFIED [27].
  - 75% of managers saw more rental fraud.
  - 75% plan to grow, but only 55% grew in 2025.
  - Firms are dropping high-effort accounts.
  - AI is now "essential".
- **Earlier Buildium edition:** labor shortages. VERIFIED [45].

### 3. Revenue
- **Fees:** VERIFIED, 2022 survey plus secondary [32].
  - Management: 8.49% of rent on average (range 3.75–14%), or about $101 per unit per month flat.
  - Placement: about 70.6% of a month's rent.
  - Renewal: about $212.
  - Maintenance markup: commonly 10–20%.
- **What moves revenue (INFERRED):**
  - Renewals: fee plus no vacant months.
  - Collections, since fees are often charged on rent collected [32].
  - Faster turnovers.
  - Maintenance markup.
  - Fewer fines.

### 4. PMS APIs
- **Buildium:** official Open API (read/write, webhooks, sandbox) on the Premium plan; the best first target. VERIFIED secondary [33][38].
- **AppFolio Stack:** partner application and security review required; read/write only on the Max plan. VERIFIED secondary [34].
- **Rent Manager:** REST API; production needs partner tokens. VERIFIED secondary [35][37].
- **Yardi Breeze:** no public API. VERIFIED secondary [36].
- **Rentvine and DoorLoop:** public APIs (INFERRED).
- **Unified APIs:** Propexo, Nango and Supergood each cover several PMS products. VERIFIED [33][37][38].

### 5. AI products and the gap
- **AppFolio Realm-X:** partly secondary sources.
  - Leasing and Maintenance Performers (June 2025) [39].
  - Flows for renewals and rent recovery [41][42].
  - Over 99% of customers use AI features (Q1 2026) [42][46].
  - A new Realm-X (Sept 29, 2026) whose headline mentions a Claude agent connector [40].
- **Others:** VERIFIED secondary.
  - EliseAI targets large apartment operators [41].
  - Entrata bought Colleen AI (renewals, collections) in 2024 [44].
  - Vendoroo coordinates maintenance for small firms and claims 500+ customers [43].
  - Latchel does maintenance (INFERRED).
- **Gap (INFERRED):** AI agents stick to leasing and maintenance on the big platforms. For firms with 20–500 units, no product does any of these:
  - negotiate renewals by voice with live owner approval;
  - call cities, HOAs and locksmiths;
  - run move-out and compliance against deadlines.

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
