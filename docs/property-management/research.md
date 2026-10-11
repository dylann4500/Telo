# Telo for property managers: research

For the agent building Telo for property managers, and for the team. Researched 2026-10-11. Claims link their source; **(inferred)** marks reasoning without one. Workflows, scores and event names are proposals.

## 1. The customer and the bet

- **Who:** property-management firms and owner-operators running roughly 20–500 long-term rental units, mostly scattered single-family homes and small buildings, with no dedicated maintenance coordinator. The US has about 245,000 residential property-management firms ([IBISWorld](https://www.ibisworld.com/united-states/number-of-businesses/residential-property-managers/6136/)).
- **Why long-term rentals first:**
  - Tenants phone in. Short-term guests mostly message inside Airbnb, so a short-term product's incoming calls come mostly from cleaners and vendors (inferred).
  - Management agreements set a dollar limit above which the owner must approve a repair; about $500 is common ([Green Residential](https://support.greenresidential.com/hc/en-us/articles/17593173793943-FAQ-Owner-Approval-for-Repair-and-Maintenance-Tasks)). Oregon disciplined a manager who billed above a $400 limit without approval ([Oregon REA](https://www.oregon.gov/rea/Documents/Administrative-Actions/2026/Monroe-Cynthia-2026.pdf)). That makes "approve it while the vendor holds" a written rule rather than a nice-to-have.
  - History changes big decisions: repair or replace, which vendor to call first.
  - It's the closest fit to Telo's engine: calling parties in parallel, getting approval mid-call, tracking promises.
- **Why not big apartment complexes:** leasing calls there are the crowded part of the market. EliseAI raised a $250M Series E in August 2025 ([BusinessWire](https://www.businesswire.com/news/home/20250820023566/en/EliseAI-Secures-$250M-Series-E-to-Automate-Healthcare-and-Housing-Hiring-Hundreds-to-Fuel-Expansion)), and AppFolio sells voice leasing agents ([AppFolio](https://www.appfolio.com/blog/product-update-2026-q2)). Large sites also tend to have on-site maintenance staff (inferred).
- **Short-term rentals later, on the same engine.** There are about 25,000 vacation-rental management companies, and 70% of them manage 1–19 units ([iPropertyManagement](https://ipropertymanagement.com/research/vacation-rental-industry-statistics)). Short-term adds a turnover calendar and "first cleaner to say yes gets the job" calls.
- **The pitch:** hours lost to phone tag, not missed calls. Real-estate businesses miss only about 9% of calls ([CallRail, Jan 2025](https://www.businesswire.com/news/home/20250114793850/en/CallRail-Releases-Report-Benchmarking-Marketing-Efforts-for-Small-Businesses)). The pain is chasing vendors, owners and tenants (inferred).
- **The moat:** Telo builds a history of every unit and vendor across the portfolio: who shows up, what jobs cost, which equipment keeps failing, which promises were kept. Each call makes the next decision better.
- **Market facts:**
  - **Firms:** 340,403 US property-management businesses of all types in 2026 ([IBISWorld](https://www.ibisworld.com/industry-statistics/number-of-businesses/property-management-united-states/)). The top 20 managers run about 7% of 45.2M rented homes (2024, secondary: [iPropertyManagement](https://ipropertymanagement.com/research/property-management-industry-statistics)), so the market is fragmented.
  - **Single-family rentals:** the share run by a third-party manager rose from 30% (2017) to 36% (2024), per a sponsored study ([report](https://www.accessnewswire.com/newsroom/en/real-estate/the-property-management-trends-report-reveals-massive-surge-in-professionally-managed-u.-943013)).
  - **Staffing:** about 49 units per direct team member (NARPM, secondary: [LetHub](https://www.lethub.co/blog/doors-per-leasing-agent-benchmarks)).
  - **How managers earn:** a management fee averaging 8.49% of rent, a renewal fee around $212, and a 10–20% maintenance markup (2022 survey, secondary: [iPropertyManagement](https://ipropertymanagement.com/research/average-property-management-fees)). Renewals, collections, faster turns and coordinated maintenance all move a manager's revenue.
  - **Industry mood:** Buildium's 2026 industry report says 75% of managers plan to grow but only 55% grew in 2025. Firms are dropping accounts that take too much work, and AI has become "essential" ([Buildium](https://www.buildium.com/resource/2026-property-management-industry-report/)).

## 2. What the judges and sponsors want

- **Dial** judges depth and creativity of the application. Dial's own material centers on agents that "book, confirm, follow up" across calls and texts, calling your tools mid-call ([getdial.ai](https://getdial.ai), [docs](https://docs.getdial.ai/llms.txt)). Use every capability where it does real work (section 6).
- **Keewano's "Best Use" criteria**, from its [SpeedHacks quickstart](https://docs.keewano.com/getting-started/speedhacks-quickstart.md):
  - memory is load-bearing: the product breaks without Keewano
  - events go in during the hackathon
  - the demo runs at least one live query
  - the answer changes what the agent does
  - a real bottleneck is removed, with a bonus for measuring before and after in Keewano itself
  - the agent answers a judge's unprepared question from Keewano

  Low scores go to storage nobody queries, a dashboard as the product, and decisions that never change. Its suggested patterns, "decide on live data" and "self-improving loop", fit vendor scorecards exactly (inferred).
- **Investors** want a sharp customer, a real bottleneck and a moat (section 1).

## 3. Parties and authority

| Party | How they reach Telo | What Telo does with them | Decides |
|---|---|---|---|
| Property manager (Telo's principal) | Texts and calls Telo; the dashboard mirrors it | Sends questions, approvals within their own authority, updates | Policy, anything outside the rules |
| Owner | Texts and calls; Telo calls them for approvals | Approvals above the limit, updates, answers to "how's my property?" | Spending above their limit, big projects |
| Tenant | Calls and texts Telo's number (photos welcome) | Intake, triage, access windows, follow-ups, rent reminders | Access times, their own payment plan |
| Prospect or applicant | Calls and texts about listings | Answers, tour booking, reminders, application status | Nothing about screening, ever |
| Vendor or contractor | Telo calls them; they call back | Availability, quotes, terms, arrival times, completion | Their own price and schedule |
| Housing authority, HOA, utility, home-warranty company, insurer, city | Telo calls them, often through phone menus and hold | Inspections, claims, shutoffs, violations | Their own processes |

**Authority (the existing envelope, per owner):** allowed, ask first, never, plus a spending limit.
- **Allowed:** routine dispatch under the limit, scheduling, reminders, status calls.
- **Ask first:** anything over the owner's limit, a vendor not on the approved list, replacement instead of repair, any change to rent or a lease.
- **Never:** legal notices, screening decisions, sharing payment or wire details, promising rent concessions.
- **Emergencies:** their own cap to stop damage now (for example water shutoff and extraction), with the owner told at once.

## 4. Use-case catalog

Every use case, with a priority for today:
- **P0** is the demo.
- **P1** comes next if time allows.
- **P2** is the roadmap.

The full write-ups, with triggers, parties, what Telo decides alone, variables, rules and sources, are in `research/`:
- [maintenance-vendors-turnovers.md](research/maintenance-vendors-turnovers.md)
- [rent-money-owners.md](research/rent-money-owners.md)
- [leasing-move-in.md](research/leasing-move-in.md)

The event names in those files are the researchers' proposals. Section 5 is the normalized version to implement.

**Abbreviations used in the tables**

*Dial:*
- **in:** inbound call or text
- **out:** outbound call or text
- **‖:** several calls at once
- **mid:** mid-call tool
- **menu:** phone menus and hold
- **xfer:** transfer to a person
- **mms:** photos

*Effort:* S, M or L on Telo's engine.

### Maintenance, vendors, turnovers and projects

| # | Use case | What Telo does | Dial | Effort | Priority |
|---|---|---|---|---|---|
| M1 | Photo intake and triage | Tenant texts or calls, Telo asks for the right photos, walks through safe self-fixes, sets trade and severity (more severe when unsure) | in, mms, mid | S | **P0** |
| M2 | Emergencies, day and night | Gas, fire or CO: leave, call 911, then the utility. Telo pages the on-call ladder, transfers the tenant to whoever answers, and calls mitigation vendors at once within the emergency cap | in, out ‖, xfer | M | **P0** (the safety script and paging); P1 (the parallel vendor dispatch) |
| M3 | Parallel dispatch ranked by scorecard | Calls the 2–3 best-ranked approved vendors at once for earliest slot, trip fee, price, warranty and after-hours premium, then books the best one within the limit | out ‖, mid | M | **P0** |
| O1 | Owner approval while the vendor holds | Over the owner's limit, a different vendor, or replace instead of repair: Telo texts or calls the owner mid-call and the vendor waits | mid, out, mms | S | **P0** |
| M4 | Access window and entry notice | Books inside the tenant's windows and sends written notice (24 h in California, more if mailed), with a reminder the day before | out, mid | S | **P0** |
| M5 | Completion check and promise tracking | "On the way?" 30 minutes into the window, before-and-after photos, the tenant's "fixed?" answer, invoice against quote, each vendor promise marked kept or broken | out, mms | S | **P0** |
| M6 | Repair vs replace | Asset age and repair history go into the vendor call; Telo collects both prices and the owner chooses repair, replace or defer | mid, out | M | **P0** (the Keewano moment) |
| M11 | Home-warranty claim | Works the warranty line's phone menu and hold, opens the claim, books the assigned contractor and chases a denial | out, menu, xfer | M | P1 |
| M8 | Turnover between tenants | From notice to vacate, books trades backward from the ready date, calling in parallel. Order: trash-out → repairs → paint → flooring → clean → rekey → walkthrough. Rebooks when one slips | out ‖ | L | P1 |
| M9 | Competitive bids for projects | Books site visits with 3+ contractors, chases bids, gives the owner a side-by-side of scope, permit, start date, deposit and warranty | out ‖, mms | M | P1 |
| M7 | Preventive maintenance | HVAC service, filters, gutters, smoke and CO tests, backflow tests: books routes and sends notices | out ‖ | M | P2 |
| M10 | Vendor insurance and licenses | Chases insurance certificates 30, 14 and 7 days before expiry; blocks dispatch on a lapse | out | S | P2 |
| M12 | Water-damage insurance claim | Restoration, adjuster visits, dry-out tracking; the owner decides whether to file | out ‖ | L | P2 |
| M13 | Utility outages and shutoff notices | Calls the utility's outage line before sending anyone; tells affected tenants | out, menu | S | P2 |
| M14 | Pest, landscaping and snow contracts | Books treatments and checks that recurring visits actually happened | out | S | P2 |

### Rent, money and owners

| # | Use case | What Telo does | Dial | Effort | Priority |
|---|---|---|---|---|---|
| R2 | Late rent, partial and returned payments | States the balance, sends the pay link, logs the reason; voicemails without detail; transfers to the manager on a dispute or legal threat | out, in, xfer | M | P1 |
| R3 | Payment plans and promises to pay | "Can I pay Friday?" Telo checks the tenant's kept and broken promises, asks the manager mid-thread if it's outside the rules, confirms by text and checks on the date | in, out, mid | S | P1 (the second demo scene) |
| O2 | Owner check-ins and statements | "How's my property?" and "why was my distribution lower?" answered by phone, read-only, after verifying the owner | in, xfer | S | P1 |
| R1 | Rent reminders before the due date | Text by default; a call only for tenants whose payments are drifting late | out | S | P2 |
| R4 | Rental-assistance coordination | Status calls to housing authorities and charities through menus and hold, with the tenant's written consent | out ‖, menu | M | P2 |
| R5 | Utility billing and chargebacks | Transfers service between owner and tenant; a bill far above the unit's normal opens a leak work order instead of a chargeback | out ‖, menu | M | P2 |
| R6 | Security-deposit deadlines | Computes the state deadline, collects invoices and photos, drafts the itemization; a person sends it | out ‖ | M | P2 |
| O3 | Owner onboarding | Chases the prior manager, utilities and the HOA for documents | out ‖ | M | P2 |
| R7 | Vendor invoices and payment status | Answers "when do I get paid?", requests missing documents, checks invoice against quote | in, out, mms | S | P2 |

### Leasing and move-in

| # | Use case | What Telo does | Dial | Effort | Priority |
|---|---|---|---|---|---|
| L1 | Inquiries and pre-qualification | The same answers for everyone (fair housing), books tours, sends the application link | in, mid, mms | S | P1 |
| L3 | Tours and no-show recovery | Asks for a YES 24 h and 2 h before; if they don't show, calls the prospect and texts the agent at once; reissues self-tour lock codes | out ‖, mid | S–M | P1 |
| L6 | Section 8 (housing vouchers) | Calls the housing authority's landlord line through menus and hold for approval status, inspections and payments; schedules re-inspections and repairs in parallel | out ‖, menu, mid | M | P2 (no competitor found) |
| L8 | Move-in coordination | Parallel calls: utility transfer, the building's elevator or dock booking, the tenant's insurance proof; lock code released when the checklist is done | out ‖, mms | M | P2 |
| L2 | Lead follow-up | Texts first; AI voice calls only with written consent (marketing rules) | out | S | P2 |
| L4 | Application status | Status and missing documents only, never decisions or reasons | in, out | S | P2 |
| L5, L7, L9 | Guarantors, lease-signing reminders, welcome and first-week calls | Chase documents and signatures; first-week issues become work orders | out | S | P2 |

### Renewals, move-out, compliance and tenant communications

Full write-up: [renewals-compliance-market.md](research/renewals-compliance-market.md).

| # | Use case | What Telo does | Dial | Effort | Priority |
|---|---|---|---|---|---|
| N1 | Renewal offer and negotiation | Offers inside the owner's band and under the legal cap: California AB 1482 is 5% + CPI, at most 10%; Oregon 9.5% in 2026; Washington 9.683% in 2026. Negotiates by phone, asks the owner mid-call about concessions, tracks notice deadlines | out, in, mid, xfer | M | P1 (most revenue; strong demo) |
| N2 | Notice to vacate | Checks the date against the lease, asks for written notice and a forwarding address, makes one retention attempt if the owner allows, hands off to the turn (M8) | in, out | S | P2 |
| N3 | Move-out inspection and deposit handoff | Books pre-move-out inspections (California: 48 h written notice, at most two weeks before the lease ends) and final ones, collects photos, hands deductions to a person | out ‖, mms | M | P2 |
| N4 | Late rent to an eviction handoff | Reminders and plans (R2, R3), then a handoff packet for the attorney; flags CARES Act covered properties (30-day notice) | out, mid | L | P2 (the handoff only) |
| N5 | City registration, inspections, code enforcement | Calls city lines through menus and hold, books re-inspections, sends tenants notice, books repairs | out, menu, ‖ | M | P2 |
| N6 | HOA violation notices | Tells the tenant the fix-by date, asks the HOA for an extension, books the fix | in, out | S | P2 |
| N7 | Building-wide notices | Water shutoffs, pest treatment, fire-alarm tests: parallel texts with the legal lead time, then calls to tenants who haven't confirmed | out ‖, mms | S | P2 (demo-ability 5) |
| N8 | Noise, neighbor and parking complaints | Logs the complaint with photos; sends the other tenant a neutral reminder without naming who complained; follows up. Tows and formal notices go to a person | in, out | S | P2 |
| N9 | Lockouts and key management | Checks identity mid-call, calls locksmiths in parallel, transfers to the on-call person. Lock changes requested over domestic violence (California: within 24 h) go to a person | in, out ‖, xfer | M | P2 |
| N10 | Tenant check-ins | Day 7 and day 30, mid-lease, before renewal, after a work order; feeds renewal offers | out | S | P2 |

### Keep human, always

- **Legal:** notices to pay or quit, evictions, terminations, deposit deductions, settlements, write-offs, fee waivers.
- **Leasing decisions:** screening decisions, reasons and predictions; adverse-action notices; criminal-history questions; reasonable-accommodation requests (assistance animals, disability).
- **Money and contracts:** paying anyone, collecting card or bank numbers by voice or text (send the software's link instead), signing or awarding contracts, HAP contracts, rent counteroffers.
- **Debt collection:** accounts where the manager may count as a debt collector, such as arrears inherited at takeover. Send them to an agency or attorney.
- **Emergencies:** Telo never calls 911 itself (it isn't on site); it tells the tenant to call and pages a human. No entry without notice or consent except in a real emergency.
- **Fees:** no threats, and no new or hidden fees. The FTC settled with Invitation Homes ($48M) and Greystar ($24M) over hidden rental fees ([rent research](research/rent-money-owners.md)).

## 5. Variables to track

This is the normalized list to implement. It fits how Telo already writes Keewano (`src/server/memory/keewano.ts`), so the event names here supersede the researchers' proposals in `research/`.

### 5.1 How the variables fit Telo's memory

- **Everything lives in Telo's own database:** task facts, messages, transcripts, photos and the portfolio. Keewano gets only typed slices.
- **Keewano's shape:** one table, `events`. Columns are `user_id` (an entity UUID), `event_datetime`, and **one column per catalog entry**. Each entry has one type: `string`, `uint`, `bool`, `timestamp` or `price_usd_cent`.
- **A logical event:** its context columns are written first, then its **anchor** column (a string category), all stamped with the same second. This is the existing pattern.
- **Amount columns are per family** (`quote_cents`, `rent_cents`, `bid_cents`…), so sums never mix.
- **Fan-out:** each event goes to several entity streams, one batch per entity, the same way today's user, task, org and relationship streams work.
- **The catalog is append-only.** Ids 2000–2025 stay as they are. New entries start at 2026, in the order below.
  - Every new column needs a line in `COLUMN_NOTES` (`src/server/memory/keewano-ask.ts`), so the SQL writer knows it.
  - Keewano's SQL has no JOIN, CTE or window functions; it works by `GROUP BY user_id` and `FILTER`.
- **Never in Keewano:**
  - names, phone numbers, addresses or emails
  - account, policy, claim, tax, voucher or lockbox numbers
  - free text or photos
  - hardship or medical details
  - voucher status on prospects, or anything that stands in for a protected class

  Rules learned from history apply to a unit, vendor, time slot, lead source or agency, never to one person's protected traits.
- **Names stay local.** Telo keeps the mapping from entity UUID to display name in its own database. It gives Claude that mapping when writing or explaining SQL, and resolves query results locally.

### 5.2 Entities (Keewano streams)

| `entity_kind` | What it is | Events it collects |
|---|---|---|
| `pm` | The management firm, Telo's principal (replaces `user`) | Portfolio totals |
| `owner` | One owner | Approvals, spend, inquiries, distributions |
| `property` | A house or building | Emergencies, utilities, service contracts |
| `unit` | A rentable unit | Work orders, turns, access, leasing |
| `asset` | A system or appliance in a unit (water heater, AC…) | Repairs, replacement, preventive maintenance |
| `vendor` | A vendor company (replaces `org` for vendors) | Quotes, declines, outcomes, promises, compliance, invoices |
| `tenancy` | One lease or tenant account (pseudonymous) | Rent, promises to pay, access outcomes, check-ins |
| `prospect` | One lead | Lead and tour outcomes, never protected attributes |
| `agency` | A housing authority, utility, warranty company or insurer | Hold times and outcomes |
| `task` | One Telo task: work order, turn, bid project, claim, rent case (as today) | Its whole timeline |

The `relationship` stream (one user with one business) has no equivalent and can go.

### 5.3 Event catalog

Format: **anchor column** = its string values · context columns (type) · → streams.

**P0: maintenance, vendors, approvals, promises**

1. **`wo_opened`** = trade: `plumbing|hvac|electrical|appliance|roof|pest|locks|landscape|cleaning|paint|flooring|general`
   - context: `severity` (string: `emergency|urgent|routine|cosmetic`), `intake_channel` (string: `sms|mms|call|email`), `photo_count` (uint)
   - → task, unit, property, owner, tenancy, pm
2. **`wo_deflected`** = fix_code: `gfci|breaker|disposal|thermostat|filter|clog|other`
   - context: `secs_to_resolve` (uint)
   - → task, unit
3. **`emergency_routed`** = `gas|fire|co|water|sewage|no_heat|no_power|lockout|security`
   - context: `emergency_route` (string: `tenant_911|utility|oncall|vendor|deescalated`), `secs_to_human` (uint)
   - → task, property, pm
4. **`quote_received`** = trade
   - context: `job_code` (string short code such as `ac_no_cool`, `wh_replace`), `quote_cents` (price), `trip_fee_cents` (price), `warranty_days` (uint), `earliest_slot_hours` (uint)
   - → vendor, task, unit
5. **`vendor_declined`** = `busy|out_of_area|wrong_trade|no_answer|price`
   - → vendor, task
6. **`vendor_booked`** = trade
   - context: `dispatch_rank` (uint, 1 = top of the scorecard), `booked_cents` (price)
   - → vendor, task, unit
7. **Approvals** reuse the existing `approval_requested` / `approval_granted` / `approval_denied` and `approval_amount_cents`.
   - kinds: `repair|replace|vendor_off_list|emergency|plan|bid|reserve`
   - add context: `approval_response_seconds` (uint), `approval_channel` (string: `sms|voice|dashboard`), `approval_while_holding` (bool: a vendor was on the line)
   - → owner, task, pm
8. **`entry_notice_sent`** = purpose: `repair|inspection|preventive|showing`
   - context: `notice_hours` (uint), `notice_method` (string: `sms|email|posted|mail`)
   - → unit, task
9. **`access_outcome`** = `done|no_access|rescheduled|tenant_cancelled`
   - context: `reschedules` (uint)
   - → task, unit, tenancy
10. **Promises** reuse the existing `commitment_received` / `commitment_fulfilled` / `commitment_broken` and `commitment_due_at`.
    - extend the kinds with: `arrival|eta|parts|quote_by|invoice_by|payment`
    - add context: `commitment_late_minutes` (uint)
    - → vendor (or tenancy, for payments), task
11. **`vendor_outcome`** = `on_time|late|no_show|cancelled`
    - context: `late_minutes` (uint)
    - → vendor, task, unit
12. **`wo_completed`** = `fixed_first_visit|fixed_multi_visit|not_fixed|cancelled`
    - context: `visits` (uint), `days_to_fix` (uint), `invoice_over_quote_pct` (uint, 0 when at or under), `tenant_confirmed` (bool), `manager_touches` (uint: times the manager had to act)
    - → task, unit, vendor, owner, pm
13. **`callback_opened`** = trade
    - context: `days_since_done` (uint)
    - → vendor, unit
14. **Assets:**
    - **`asset_registered`** = `water_heater|furnace|ac|heat_pump|fridge|range|dishwasher|washer|dryer|roof|garage_door`; context: `install_year` (uint); → asset, unit
    - **`asset_repaired`** = asset type; context: `repair_cents` (price), `repeat_within_90d` (bool); → asset, unit, owner
    - **`repair_vs_replace`** = `repair|replace|defer`; context: `replace_cents` (price), `asset_age_years` (uint); → asset, owner
15. **Calls** reuse `call_started`, `call_ended`, `call_duration_seconds` and `hold_seconds`.
    - add context: `call_party` (string: `tenant|owner|vendor|agency|prospect|manager`)

**P1: rent, warranty claims, turns, bids, leasing, owner questions**

16. **Rent:**
    - **`rent_paid`** = `on_time|late|partial`; context: `days_from_due` (uint), `rent_cents` (price), `pay_method` (string: `ach|card|check|money_order|assistance`); → tenancy, unit, owner
    - **`rent_late`** = `grace_ended`; context: `days_late` (uint), `balance_cents` (price), `late_fee_cents` (price); → tenancy, owner
    - **`collection_contact`** = `paid|promise|needs_time|dispute|no_answer|voicemail|wrong_party|refused`; context: `contact_channel` (string: `sms|voice`), `contacts_7d` (uint); → tenancy
    - **`payment_returned`** = `nsf|closed|stop_payment|chargeback|other`; → tenancy
    - **`payment_plan`** = `offered|agreed|completed|defaulted|renegotiated`; context: `installments` (uint), `plan_cents` (price), `approved_by` (string: `telo|pm|owner`); → tenancy
    - Promises to pay use the commitment events with kind `payment`.
    - **`escalated_to_human`** = `dispute|legal_threat|notice_due|cap_hit|waiver`; → tenancy, task
    - **`contact_opt_out`** = `sms|voice`; → tenancy
17. **Warranty claims:**
    - **`warranty_claim`** = system: `hvac|water_heater|appliance|plumbing|electrical`; context: `ivr_seconds` (uint), `hold_seconds`, `service_fee_cents` (price); → agency, task, asset
    - **`warranty_outcome`** = `repaired|replaced|cash_out|denied|abandoned`; context: `days_to_fix`, `out_of_pocket_cents` (price); → agency, task
18. **Turns:**
    - **`turn_started`** = `notice_given|move_out`; context: `notice_days` (uint), `beds` (uint); → task, unit
    - **`turn_stage_done`** = `trashout|repair|paint|flooring|clean|rekey|appliance|pest|walkthrough`; context: `slipped_days` (uint), `stage_cents` (price); → task, vendor
    - **`turn_ready`** = `on_time|late`; context: `turn_days` (uint), `turn_cost_cents` (price), `vacant_day_cents` (price: monthly rent × 12 ÷ 365); → task, unit, owner
19. **Bids:**
    - **`bid_received`** = project type: `roof|hvac_replace|water_heater|sewer_line|fence|ext_paint|other`; context: `bid_cents` (price), `deposit_pct` (uint), `labor_warranty_months` (uint), `start_in_days` (uint), `permit_included` (bool); → task, vendor
    - **`bid_ghosted`** = project type; context: `after_site_visit` (bool); → vendor
    - **`bid_awarded`** = project type; context: `price_rank` (uint), `bid_spread_pct` (uint); → task, owner
20. **Leasing:**
    - **`lead_received`** = source: `zillow|craigslist|sign|website|referral|other`; context: `lead_channel` (string: `call|sms|email|portal`), `after_hours` (bool), `first_response_seconds` (uint); → prospect, unit
    - **`tour_result`** = `showed|no_show|cancelled|rescheduled|access_failed`; context: `tour_type` (string: `agent|self`), `tour_confirmed` (bool); → prospect, unit
    - **`lead_closed`** = stage: `inquiry|toured|applied|leased`; context: `lost_reason` (string: `price|location|timing|no_response|chose_other|opted_out`); → prospect, unit
21. **Owner questions:**
    - **`owner_inquiry`** = topic: `distribution|statement|vacancy|repair|tenant|fees|sale`; context: `resolved_by` (string: `telo|pm`); → owner

**P2:** the remaining events in the `research/` write-ups:
- preventive maintenance
- vendor insurance certificates
- water-damage claims, utility events, service contracts
- rent reminders, rental assistance, utility billing
- deposits, onboarding, distributions, invoices
- application stages, housing-authority calls and inspections
- move-in checks, first-week check-ins
- renewals

Normalize each the same way when you build it.

### 5.4 Portfolio data and task facts (local only)

**The seeded portfolio.** It replaces the consumer demo history and stays in Telo's database.

- **Manager:** name, phone, calling hours, the on-call ladder (people and phones, in order), the emergency cap.
- **Owners:** name, phone, preferred channel, approval limit, emergency limit, properties.
- **Properties:** address, state (it drives entry-notice, late-fee and deposit rules), and the phone numbers the manager gave for utilities, the warranty company (plus contract number) and the HOA.
- **Units:** label, beds and baths, rent, assets (type, install year, model and serial number), access notes (pets, alarm), lockbox code (secret).
- **Tenancies:** tenant names and phones, consent flags for AI calls and texts, lease dates, rent, due day, balance, preferred access windows.
- **Vendors:** company, phone (office line preferred), trades, approved flag, trip fee and rates, insurance-certificate expiry, after-hours availability, service area.
- **Agencies:** warranty companies, utilities, the housing authority. Phone numbers come only from the manager; Telo never looks them up.

**Task facts.** These use the existing `tasks.facts`, with source and sensitive flags.
- **Maintenance:** the description, photo URLs, triage reasons, access windows, each vendor's quote and spoken terms, arrival times, the approval exchange, completion photos, the invoice.
- **Proof:** the entry-notice text and its timestamp (the legal record).
- **Rent:** the balance, the promise wording, plan terms.
- **Leasing:** the prospect's contact details, the consent record, the tour time.

Sensitive values (codes, account numbers) are masked in the dashboard and redacted when the task ends, as today.

### 5.5 Decisions that history changes (the Keewano moments)

1. **Who gets called first.** Vendors are ranked by no-show rate, ETA kept, first-time fix and median quote for the `job_code`.
2. **Repair or replace.** Count `asset_repaired` over 12 months and sum `repair_cents`, then compare with `replace_cents`. Past a threshold the manager sets, Telo asks for a replacement quote as well as a repair.
3. **Quote sanity.** A quote above the portfolio's 75th percentile for its `job_code` makes Telo get one more quote.
4. **How to reach the owner.** The owner's fastest `approval_channel` decides between a text and a call.
5. **Payment promises.** A tenant with a recent `commitment_broken` (kind `payment`) needs the manager's approval for a new promise. Otherwise Telo accepts one promise dated before the next due date.

**Questions a judge might ask, worth rehearsing:**
- "Which vendor no-shows most?"
- "What does a water-heater replacement usually cost us?"
- "Which unit cost the most in repairs this year?"
- "How long do owners take to approve?"
- "How many trips were wasted because nobody let the vendor in?"

**Before and after (Keewano's bonus):** compare `manager_touches` per work order and the hours from report to vendor booked. Before Telo, these come from seeded history; after, from Telo-handled jobs. Label the "before" as seeded on any slide.

**A query sketch**, checked against the live project:

```sql
SELECT user_id, count(vendor_outcome) AS no_shows
FROM events WHERE entity_kind = 'vendor' AND vendor_outcome = 'no_show'
GROUP BY user_id ORDER BY no_shows DESC LIMIT 10
```

**Note from the build:** Keewano rejects `count(...) FILTER (WHERE ...)` with "unsupported aggregate in the SELECT list", with or without `GROUP BY`. Put the condition in `WHERE` instead: a column's own occurrence carries its new value, so `WHERE vendor_outcome = 'no_show'` counts exactly the no-shows. Each condition is then its own query (Telo's vendor ranking runs four at once). An anchor written on an asset's stream holds forward, so `WHERE entity_kind = 'asset' AND asset_registered = 'water_heater'` selects every water heater, and `avg(replace_cents)` there gives the replacement price.

Telo then maps each `user_id` to the vendor's name locally.

## 6. How Telo uses Dial

The facts behind each row are in `docs/integrations/dial.md`.

| Dial capability | Where it does real work |
|---|---|
| Inbound calls on Telo's number (managed agent plus mid-call tools) | Tenants report problems, prospects ask about listings, vendors call back, owners ask for status. The caller is identified by number: tenant → unit, owner → properties, vendor → trades. |
| Outbound calls with a per-call brief | Vendors, owners, tenants, housing authorities, utilities, warranty companies. Each brief carries the unit's and vendor's history and the authority rules. |
| Several calls at once | Two or three vendors per job; several contractors per project bid; a whole make-ready crew for a turnover. Free accounts allow 2 at once and 5 minutes per call until the first top-up. |
| Mid-call tools (Context MCP) | Ask the owner while the vendor holds; check the tenant's access windows and the manager's calendar; look up a unit's history, warranty or approved vendors; record a quote; check whether a slot is still open on another call. |
| SMS and MMS | Tenants send photos of the problem; vendors send completion photos. Telo texts windows, reminders and summaries. Outbound SMS to US phones needs 10DLC registration. |
| Phone menus and hold | Home-warranty claim lines, utilities, housing authorities, insurers and city inspection lines: Dial's agent presses the keys and waits. |
| Transfer to a person (`transferTo`, set when the call is placed) | Telo sits through a warranty company's hold queue and patches the manager in when a person answers. Emergency calls can connect the on-call person. |
| Transcripts after each call | Claude extracts quotes, arrival times, promises, confirmation numbers and the outcome. These feed Keewano and the next decision. |

Telo already has the mid-call tools `ask_customer`, `wait_for_customer`, `check_calendar`, `report_progress`, `get_status` and `ask_telo` (`src/server/live-call.ts`). They need new wording and roles (`ask_customer` becomes asking the owner or manager) plus new lookups such as unit history and slot claims.

## 7. Rules and guardrails

Not legal advice; these are the constraints to build in.

- **AI voices count as "artificial" voices under the TCPA**, the federal law on automated calls ([FCC, Feb 2024](https://www.fcc.gov/document/fcc-makes-ai-generated-voices-robocalls-illegal)).
  - Informational calls to cell phones need prior express consent. Marketing calls need prior express written consent ([47 CFR 64.1200](https://www.law.cornell.edu/cfr/text/47/64.1200)).
  - Calling tenants, owners and vendors who gave their number, about their own business with the manager, is informational. Cold calls and promotional calls are not, so don't make them.
  - Opt-outs must be honored, across channels (a texted STOP also stops calls on that topic) ([revoke-all rule](https://www.burr.com/telephone-consumer-protection-act/the-fcc-delays-effective-date-of-tcpa-revoke-all-rule-until-january-31-2027), delayed to 2027).
- **Calling hours:** federal rules bar sales calls before 8 AM or after 9 PM. State laws such as Florida's and Oklahoma's are stricter ([summary](https://www.leadgen-economy.com/blog/state-mini-tcpa-laws-ftsa-otsa/)). Use 8 AM–8 PM local time for anything that isn't an emergency.
- **Disclose AI and recording on every call.**
  - Several states require every party's consent to record, including California, Florida, Illinois, Pennsylvania and Washington ([list](https://www.recordinglaw.com/united-states-recording-laws/)).
  - A wiretap claim against an AI contact-center product went ahead in California ([Ambriz v. Google](https://www.goodwinlaw.com/en/insights/publications/2025/02/alerts-practices-dpc-ftec-ai-voice-products-subject-to-california-invasion-of-privacy-claims)).
  - Several states have bot-disclosure laws ([Orrick, 2026](https://www.orrick.com/en/Insights/2026/04/2026-State-Chatbot-Laws-Key-Provisions-and-Regulatory-Trends)).
  - Telo's existing opening ("an AI assistant calling for …") becomes "an AI assistant calling for [manager]; this call is recorded".
- **Debt collection (FDCPA, Regulation F):** limits how often a collector may call about one debt and how voicemails must read ([CFPB](https://www.consumerfinance.gov/compliance/compliance-resources/other-applicable-requirements/debt-collection/debt-collection-rule-faqs/)). A manager chasing an owner's past-due rent can fall under these rules (inferred). Keep Telo to reminders and conversations about payment plans.
- **Fair housing:** leasing conversations must treat every prospect the same, so give fixed answers about the listing. Telo never makes screening decisions.
- **Texting:** each business's number needs 10DLC registration before outbound SMS reaches US phones ([Bandwidth](https://www.bandwidth.com/support/en/articles/12823085)).
- **Entry and emergencies:** non-emergency entry needs the state's notice (24 hours is common, including in California) (inferred; details by use case in section 4). For gas, fire, carbon monoxide or flooding, Telo gives safety instructions and 911 or the utility first, then the on-call person. The AI is never the only responder.

## 8. Competition and pricing

| Company | What it does | For whom |
|---|---|---|
| EliseAI | Leasing, resident messages, maintenance ([BusinessWire](https://www.businesswire.com/news/home/20250820023566/en/EliseAI-Secures-$250M-Series-E-to-Automate-Healthcare-and-Housing-Hiring-Hundreds-to-Fuel-Expansion)) | Large apartment operators |
| AppFolio | Built-in AI "Performers" for leasing (voice), maintenance and accounting ([AppFolio](https://www.appfolio.com/blog/product-update-2026-q2)) | AppFolio customers |
| Vendoroo | AI maintenance coordinator: triage, vendor choice, scheduling; from $3/door/month ([vendoroo.ai](https://www.vendoroo.ai/)) | Small and mid-size managers |
| Latchel | Maintenance coordination service ([funding](https://vcnewsdaily.com/latchel/venture-capital-funding/mhttvpsttd)) | Small and mid-size managers |
| Buildium maintenance contact center | Human call center: $1.10/unit/month, or $0.70 for missed calls only ([Buildium](https://www.buildium.com/maintenance-contact-center/)) | Buildium customers |
| Vantaca HOAi Voice | AI voice for HOA management ([Vantaca](https://www.vantaca.com/ai-voice-technology-revolutionizing-community-association-management)) | HOA managers |
| Conduit | AI guest and operations messaging, $3.1M seed ([Tech Funding News](https://techfundingnews.com/y-combinator-backed-conduit-raises-3-1m-to-transform-short-term-rental-management-with-ai/)) | Short-term rental operators |

**The gap (inferred):** existing products answer tenants and route work orders. Fewer of them work the phones outward to vendors, owners, warranty companies and housing authorities, or learn from every call.

**Pricing anchors:** $1.10 per unit per month (Buildium's human call center) up to $3+ (Vendoroo's AI).

**Software to integrate with later** (not today; the demo runs on the seeded portfolio):
- **Buildium:** Open API with read, write, webhooks and a sandbox, on its Premium plan. The best first target.
- **AppFolio Stack:** needs a partner application and a security review.
- **Rent Manager:** REST API with partner tokens.
- **Yardi Breeze:** no public API.
- **Unified APIs** (Propexo, Nango) cover several of these at once.

Details and sources are in [renewals-compliance-market.md](research/renewals-compliance-market.md).

## 9. Build order and demo

**Building ends at 4:00 PM today.** Rough timeline:

| By | Done |
|---|---|
| 1:30 PM | Portfolio seeded (manager, 2 owners, 3 properties, ~8 units with assets, tenancies, 6–8 vendors across trades, a warranty company, a utility). Calls and texts routed by phone number to manager, owner, tenant or vendor. The **P0 event catalog** (section 5.3, items 1–15) and its `COLUMN_NOTES` written. |
| 1:45 PM | **Seeded history loaded into Keewano** (vendor outcomes, quotes, repeat AC failures on one unit, owner approval times). It takes 15–20 minutes to become queryable on a fresh project, so this can't slip. |
| 2:45 PM | The P0 maintenance flow works end to end on the simulated stack: intake with a photo, triage (emergency script), parallel vendor calls, owner approval while the vendor holds, access window and notice, completion follow-up, promise kept or broken, vendor ranking and repair-vs-replace driven by Keewano. Tests pass. |
| 3:15 PM | A live rehearsal on Dial (top up first) with teammates playing tenant, two vendors and owner. Fix what breaks. Unplanned questions to Keewano answered with vendor and unit names. |
| 3:45 PM | One P1 slice if there's time: the rent promise flow (R3), or a home-warranty claim through phone menus and hold (M11). |
| 4:00 PM | Freeze. `docs/demo.md`, `README.md` and `docs/architecture.md` describe what's real. |

**The demo (about 5 minutes; teammates play the tenant, two HVAC vendors and the owner):**
1. **7 PM, a tenant calls:** "The AC is out." Telo asks for a photo of the thermostat and the unit, and the tenant texts them.
2. **The task page shows what Telo remembered:** a live Keewano query says this is the unit's third AC failure since June, and the usual vendor no-showed twice. Telo ranks vendors accordingly.
3. **Telo calls two HVAC vendors at once.** Vendor A: earliest Thursday, $180 diagnostic. Vendor B: tonight, $650 repair.
4. **$650 is over the owner's $500 limit.** Telo says "one moment" to vendor B and texts the owner: "Approve $650 tonight? This is the third failure; want a replacement quote too?" The owner replies "yes, and get a replacement quote," and vendor B, still holding, agrees.
5. **The tenant gets the window by text,** with the entry notice. Telo turns vendor A down politely.
6. **Telo follows up:** an "on the way?" check during the window, the tenant's "fixed? Y", and vendor B's promise marked kept.
7. **A judge asks an unplanned question,** such as "which vendor no-shows most?" Telo answers with live SQL, and the dashboard shows the query.

**Backup scenes:**
- **2 AM water leak:** safety script, on-call page, restoration vendors called at once.
- **"Can I pay Friday?":** promise history, the manager approves a split, Telo checks back on Friday.

**After today, in order:** turns (M8), bids (M9), leasing (L1, L3), Section 8 (L6), then the P2 list. Short-term rentals come later on the same engine, adding a turnover calendar and "first cleaner to say yes" calls.

## 10. Open questions

- Does Dial's managed agent reliably call mid-call tools at the right moment on live calls? Telo has only tested this with Claude standing in for Dial's agent. Rehearse the demo calls live early.
- Dial concurrency: the free account allows 2 calls at once. Top up before demoing parallel vendor calls plus a call to the owner.
- Keewano takes about 5 minutes (15–20 on a fresh project) before new events can be queried. Load the demo portfolio's history at least 30 minutes before presenting.
- Short-term rentals: confirm how guests contact operators (platform messaging vs phone) before building a guest phone line.
