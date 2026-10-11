# Leasing and move-in: what Telo can take over

*Labels:* a claim with [n] is VERIFIED by source n; (INF) means INFERRED. *Keewano:* each field is sent as a context event just before the named event. Entity ids are UUIDs that Telo generates.

## Area summary
Leasing is the most crowded AI niche in property management. EliseAI raised a $250M Series E at more than $2.2B in Aug 2025 [18], and a $350M round at $4B was reported in Sept 2026 by a single source [21]. AppFolio's Realm-X Leasing Performer already answers prospect calls and books tours [22][23]. For managers with 20–500 scattered units, the open work comes after the lead: no-show recovery, Section 8 coordination with housing authorities, and move-in calls to utilities and building offices, all phone menus, holds and parties working in parallel. The pain is measured: inquiries waited 8h17m on average for a reply in a 2024 secret-shopper study [24], more than half of text and email inquiries arrive after hours [26], and vendors report 20–40% tour no-shows [28]. Telo coordinates and reports status; people decide who qualifies.

## Use-case catalog

### 1. Rental inquiries and pre-qualification
- **Trigger:** a call or text to a listing number, or a portal lead email.
- **Parties and who approves:** the prospect. The PM approves exceptions.
- **Calls and texts:** inbound around the clock. Mid-call tools: unit facts, screening criteria, calendar, and PM approval while the prospect holds. MMS photos and the application link.
- **Telo decides alone vs asks:** answers and books alone. Asks before any pet, price or date exception, or holding a unit.
- **Variables to track:**
  - *Task facts:* name, phone, consent record, move-in date, pets, transcript.
  - *Keewano events:* `lead_received{channel: enum[call,sms,email,portal], source: enum[zillow,craigslist,sign,website,other], after_hours: bool, first_response_seconds: uint}` on prospect and unit; `inquiry_topic{topic: enum[price,pets,parking,fees,criteria,vouchers,other]}` on unit.
  - *KPIs it moves:* speed to lead, after-hours capture, lead-to-tour rate.
- **A decision that history changes:** if a unit draws many pet questions and few tours, Telo flags it to the PM. It never changes price or policy itself.
- **Rules and guardrails:** under the Fair Housing Act, everyone gets the same answers and nobody is steered. Source-of-income laws cover 23 states plus DC and 152 localities [7]. HUD withdrew its 2024 AI-advertising guidance [1] in Sept 2025 [2], but the statute stands.
- **Products already doing it, and the gap:** EliseAI [19]; AppFolio (vendor claims +35% showings) [23]; Tenant Turner and ShowMojo (INF). Each is tied to one property-management system, with no memory across portfolios (INF).
- **Build effort:** S. It reuses Telo's existing inbound flow.
- **Demo-ability:** 5

### 2. Lead follow-up
- **Trigger:** no tour booked within X hours, a tour without an application, or a price drop.
- **Parties and who approves:** the prospect. The PM sets the cadence and approves offers.
- **Calls and texts:** SMS first. AI-voice calls only with documented consent. Transfer to a person on request.
- **Telo decides alone vs asks:** runs the cadence alone and stops on opt-out. Asks before offering a concession.
- **Variables to track:**
  - *Task facts:* consent wording, time and page; opt-outs.
  - *Keewano events:* `followup_attempt{channel: enum[sms,ai_call,email], attempt_no: uint, consent_basis: enum[written,express,none]}` and `lead_closed{stage: enum[inquiry,toured,applied,leased], lost_reason: enum[price,location,timing,no_response,chose_other,opted_out]}` on prospect.
  - *KPIs it moves:* lead-to-tour, tour-to-application, opt-out rate.
- **A decision that history changes:** if attempts after the third never convert for a lead source, Telo stops at three.
- **Rules and guardrails:** under the TCPA, AI voices count as "artificial voice." Telemarketing calls need prior express written consent, caller identification and an opt-out [3][4]. A call urging someone to rent is likely telemarketing; a reminder about a tour they booked is likely informational (INF). Texting needs 10DLC registration.
- **Products already doing it, and the gap:** EliseAI and AppFolio [19][22]; Funnel and Knock (INF). Consent is not tracked per channel.
- **Build effort:** S
- **Demo-ability:** 3

### 3. Tours (agent-led and self-guided) and no-shows
- **Trigger:** a tour is booked or close, the prospect doesn't arrive, or a caller is stuck at the door.
- **Parties and who approves:** the prospect and the showing agent. The PM sets the security policy.
- **Calls and texts:**
  - "Reply YES" texts 24 hours and 2 hours before, then a call if there's no reply.
  - Ten minutes after the start time, Telo calls the prospect and texts the agent in parallel.
  - Self-tours: an ID-check link, then a time-boxed lock code. A mid-call tool reissues the code if it fails.
  - After the tour, Telo follows up and checks that the door is locked.
- **Telo decides alone vs asks:** confirms, reschedules, releases slots and issues codes alone, once the ID check passes. Asks before giving after-hours or extended access.
- **Variables to track:**
  - *Task facts:* tour time, agent, lock id, code.
  - *Keewano events:* `tour_result{type: enum[agent,self], result: enum[showed,no_show,cancelled,rescheduled,access_failed], confirmed: bool, lead_time_hours: uint}` on unit, prospect and showing_agent; `lock_issue{type: enum[battery_low,offline,code_failed,left_unlocked]}` on unit.
  - *KPIs it moves:* show rate, tour-to-application, wasted agent hours.
- **A decision that history changes:**
  - If a time slot or lead source has many no-shows, the YES reply becomes required, applied to everyone and not person by person.
  - After two lock failures in a month, Telo opens a repair task and switches the unit to agent-led tours.
- **Rules and guardrails:** treat every prospect the same, and keep ID data private.
- **Products already doing it, and the gap:**
  - AppFolio handles scheduling counteroffers [22].
  - EliseAI's AI-Guided Tours add phone help and ID checks [20].
  - Rently, Tenant Turner and ShowMojo (INF).
  - In vendor data, self-guided tours completed for 28% of leads versus 14% for accompanied tours [27].

  None of them makes a live recovery call.
- **Build effort:** S for agent-led tours. M for self-guided tours, which need a lock integration.
- **Demo-ability:** 4

### 4. Application status and missing documents (status only)
- **Trigger:** an "any update?" call or text, or an application incomplete for more than 24 hours.
- **Parties and who approves:** the applicants. The PM or owner decides.
- **Calls and texts:** inbound, with a mid-call status lookup in the property-management system. Outbound reminders carry an upload link; documents are never taken by voice.
- **Telo decides alone vs asks:** states the stage and what's missing. It never gives decisions, reasons or predictions, and it escalates stuck files.
- **Variables to track:**
  - *Task facts:* application id, missing items, fees.
  - *Keewano events:* `application_stage{stage: enum[received,docs_missing,screening,pending_owner,decided,withdrawn]}` and `docs_chase{doc_type: enum[pay_stub,id,bank_statement,other], attempt_no: uint}` on applicant.
  - *KPIs it moves:* time to decision, application-to-lease.
- **A decision that history changes:** if this owner usually takes 3 days, Telo calls at 48 hours.
- **Rules and guardrails:**
  - Under the FCRA, requiring a co-signer, a bigger deposit or higher rent counts as adverse action. The notice must name the screening company and explain the right to a free report and to dispute [5][6].
  - Application fees are capped at $20 in New York; at cost in California (about $64.50) and Colorado [9][32]; and at $50 in New Jersey from May 2026 [11]. Seven states, including Illinois, accept portable screening reports [10].
  - In New York City, criminal history can be checked only after conditional approval [12].
- **Products already doing it, and the gap:** property-management portals show status (INF), but nobody answers the phone.
- **Build effort:** S
- **Demo-ability:** 3

### 5. Guarantor coordination
- **Trigger:** the PM requires a guarantor, or the applicant asks about one.
- **Parties and who approves:** the applicant, the guarantor and any institutional guarantor. The PM approves.
- **Calls and texts:** calls and texts to the guarantor at the number the applicant gave, with e-sign links.
- **Telo decides alone vs asks:** chases documents alone. Asks before accepting an out-of-state guarantor or an alternative.
- **Variables to track:**
  - *Task facts:* guarantor contact, documents.
  - *Keewano events:* `guarantor_path{type: enum[personal,institutional], days_to_complete: uint, outcome: enum[completed,abandoned,declined]}` on applicant.
  - *KPIs it moves:* application-to-lease, days to lease.
- **A decision that history changes:** if personal guarantors often drop out, Telo suggests offering an institutional guarantor first.
- **Rules and guardrails:** a co-signer requirement counts as adverse action, and a person sends the notice [5].
- **Products already doing it, and the gap:** TheGuarantors, Leap and Insurent (INF).
- **Build effort:** S
- **Demo-ability:** 3

### 6. Section 8 / Housing Choice Voucher coordination with housing authorities
- **Trigger:** a Request for Tenancy Approval (RFTA) is submitted, an inspection is scheduled or failed, a HAP payment (the authority's share of the rent) is late, or a rent increase is due.
- **Parties and who approves:** the authority's leasing specialist, inspector and finance staff, plus the tenant and vendors. The PM or owner approves rent and repairs.
- **Calls and texts:**
  - Outbound calls to the authority's landlord line, through its phone menu and hold.
  - In parallel, Telo confirms access with the tenant and books a vendor for failed items.
  - Mid-call, Telo pulls comparable rents and gets the PM's yes or no on the authority's rent counteroffer while its staff member waits.
  - Repair photos go by MMS where the authority accepts them [15]. Telo transfers to the PM for signatures.
- **Telo decides alone vs asks:** makes status calls and schedules alone. Asks before accepting rent counteroffers or repairs over the spending limit. The HAP contract stays human.
- **Variables to track:**
  - *Task facts:* voucher and case numbers, caseworker extensions, inspection reports.
  - *Keewano events:*
    - `pha_call{purpose: enum[rfta_status,rent_reasonableness,inspection,reinspection,hap_payment], hold_seconds: uint, reached_human: bool, resolved: bool}` on housing_authority
    - `hcv_inspection{result: enum[pass,fail,inspector_no_show,no_access], fail_items: uint, days_from_rfta: uint}` on unit and housing_authority
    - `rent_determination{requested_cents: cents, approved_cents: cents}` and `hap_first_payment{days_after_move_in: uint}` on lease
  - *KPIs it moves:* days from RFTA to first payment, first-pass inspection rate, vacancy days.
- **A decision that history changes:** if this authority's inspectors no-showed twice and take 19 days on average, Telo confirms 48 hours ahead, calls at the hours with the shortest holds, and asks the PM about fixing commonly failed items in advance.
- **Rules and guardrails:**
  - 23 states plus DC protect source of income, and 16 of them name vouchers [7].
  - SafeRent agreed in a Nov 2024 settlement to stop scoring voucher holders [8].
  - NSPIRE replaces HQS inspections by Feb 1, 2027 [16][17].
  - Voucher status never goes on prospect events.
- **Products already doing it, and the gap:** landlords report having no single point of contact and not being told about rescheduled inspections [14]. No product was found that phones housing authorities (INF).
- **Build effort:** M. It needs a phone-menu script for each authority and a state machine that runs for weeks.
- **Demo-ability:** 5

### 7. Lease signing and move-in funds reminders
- **Trigger:** a lease is still unsigned, or move-in funds are due.
- **Parties and who approves:** the signers. The PM approves changes.
- **Calls and texts:** an e-sign link by text, and a call at 48 hours that answers questions from the lease summary.
- **Telo decides alone vs asks:** sends reminders alone. Asks before changing terms, extending a deadline or releasing the unit.
- **Variables to track:**
  - *Task facts:* signers, terms, link status.
  - *Keewano events:* `lease_signature{hours_to_sign: uint, reminders: uint}` and `move_in_funds{status: enum[paid,partial,late], amount_cents: cents}` on lease.
  - *KPIs it moves:* time from approval to signature, fall-through rate.
- **A decision that history changes:** if leases unsigned at 72 hours usually fall through, Telo asks the PM about a deadline at 48 hours.
- **Rules and guardrails:** no card or bank details by voice; Telo sends the portal link.
- **Products already doing it, and the gap:** property-management systems send email reminders only (INF).
- **Build effort:** S
- **Demo-ability:** 3

### 8. Move-in coordination
- **Trigger:** the lease is signed, then checkpoints at 14, 7 and 2 days before move-in.
- **Parties and who approves:** the tenant, utilities, the building office or HOA, and the inspector. The PM approves.
- **Calls and texts:**
  - Parallel calls: the utility, to move service out of the owner's name; the building, for elevator or loading dock and the movers' insurance certificate; the tenant by text, for utility confirmations and an MMS photo of the insurance page.
  - Telo books the move-in inspection and releases the smart-lock code when the checklist is complete.
  - Mid-call, the PM can approve releasing keys with an item still missing.
- **Telo decides alone vs asks:** chases items and books slots alone. Asks before releasing access with an item missing or paying building fees.
- **Variables to track:**
  - *Task facts:* utility and policy numbers, insurance certificates, codes.
  - *Keewano events:*
    - `move_in_check{item: enum[utilities,insurance,funds,inspection,access], done: bool, days_before_move_in: uint}` on lease
    - `utility_transfer{utility: enum[electric,gas,water,trash], result: enum[confirmed,pending,failed], hold_seconds: uint}` on unit and utility_provider
    - `building_booking{type: enum[elevator,loading_dock], result: enum[booked,conflict,coi_required]}` on property
  - *KPIs it moves:* on-time move-ins, insurance compliance, days the owner pays utilities after move-in.
- **A decision that history changes:** if city water took 5 days to transfer twice, Telo calls 10 days out.
- **Rules and guardrails:** lease and state insurance rules. One manager requires proof 4 business days ahead and charges $50 a month while insurance lapses [31].
- **Products already doing it, and the gap:** Updater tracks tasks, utilities and insurance [29]; Second Nature sets up utilities [30]. Neither phones utilities or building offices (INF).
- **Build effort:** M, for parallel calls and checklist state.
- **Demo-ability:** 4

### 9. Welcome and first-week check-in
- **Trigger:** day 1 and day 7 after move-in.
- **Parties and who approves:** the tenant and the PM.
- **Calls and texts:** an outbound call or text. Issues become maintenance tasks, with MMS photos.
- **Telo decides alone vs asks:** handles all of it alone.
- **Variables to track:**
  - *Task facts:* issue notes.
  - *Keewano events:* `welcome_check{day: uint, reached: bool, issues: uint}` on lease; `early_issue{category: enum[hvac,plumbing,appliance,access,utility,pests,other], days_after_move_in: uint}` on unit.
  - *KPIs it moves:* work orders in the first 30 days, reviews, renewals.
- **A decision that history changes:** if a unit has repeated HVAC problems in the first week, Telo asks the PM for an HVAC check at the next turnover.
- **Rules and guardrails:** disclose that Telo is an AI, and keep quiet hours (INF).
- **Products already doing it, and the gap:** EliseAI follows up on resident requests [19].
- **Build effort:** S
- **Demo-ability:** 4

*Also seen:* occupied-unit showings, which need written entry notice to the current tenant (INF). Also owner leasing updates, verification requests about current tenants, and holding-deposit refunds.

## Build first
1. **Inquiry → tour → no-show recovery (cases 1 and 3).** The quickest demo. It builds history by unit, time slot and lead source, and shows a PM approving something mid-call.
2. **Section 8 / HCV (case 6).** Pure phone work, no competitor found, and vacancy days at stake. Keewano remembers each housing authority's habits.
3. **Move-in coordination (case 8).** It shows parallel calls and promise tracking, with a clear KPI.

## Keep human or avoid
- **Decisions.** Approvals, denials, conditional approvals and adverse-action notices stay with people [5][6]; Telo states the stage only.
- **Criminal history and screening explanations** [12][13].
- **Reasonable accommodations,** such as assistance animals or disability: hand off to a person. HUD withdrew its animal notices [2], but the Fair Housing Act duty remains (INF).
- **Schools, crime and demographics:** neutral facts only.
- **Calls to prior landlords and employers.** The FTC treats rental history gathered by a screening service as a consumer report [5], so Telo could become a consumer reporting agency (INF). These need legal review first.
- **Money and commitments.** Card numbers, refunds, rent counteroffers, HAP contracts and holding a unit stay with people.
- **What goes into Keewano.** Nothing that stands in for a protected class (voucher status on prospects, household makeup, criminal history), because Keewano has no delete API. Rules learned from history apply by time slot, lead source, unit or housing authority, never to a single person.

## Sources
1. https://archives.hud.gov/news/2024/pr24-098.cfm
2. https://leadingage.org/hud-withdraws-wide-ranging-fair-housing-policies/
3. https://hunton.com/privacy-and-information-security-law/fcc-issues-declaratory-ruling-that-tcpa-applies-to-ai-generated-voice-calls
4. https://www.womblebonddickinson.com/us/insights/blogs/fcc-adopts-declaratory-ruling-confirming-ai-voice-calls-are-subject-tcpa-takes
5. https://www.ftc.gov/opa/2002/01/fcraguide.htm
6. https://hud.gov/sites/dfiles/PIH/documents/Adverse%20Action%20Notice.pdf
7. https://www.hudoig.gov/reports-publications/report/public-housing-authorities-and-source-income-discrimination
8. https://www.claimsjournal.com/news/national/2024/11/22/327550.htm
9. https://www.turbotenant.com/rental-applications/rental-application-fees/
10. https://naahq.org/node/6406
11. https://ncjar.com/industry-360/news-publications/industry-news/new-jersey-rental-application-fee-cap-what-ncjar-r-members-need-to-know
12. https://www.coleschotz.com/fair-chance-for-housing-act-what-nyc-housing-providers-need-to-know/
13. https://ccresourcecenter.org/new-jersey-puts-fair-chance-housing-on-the-national-agenda/
14. https://nahro.org/?p=39015
15. https://www.hud.gov/sites/dfiles/PIH/documents/HCV_Admin_Flexibilities_Reference.pdf
16. https://www.hud.gov/sites/default/files/PIH/documents/PIH-2026-18.pdf
17. https://public-inspection.federalregister.gov/2025-19070.pdf
18. https://finder.techleap.nl/news/feed/eliseai-raises-250m-in-funding-round
19. https://eliseai.com/lp/eliseai-voiceai-nb
20. https://www.businesswire.com/news/home/20250106716044/en/EliseAI-Unveils-AI-Guided-Tours-AIGT-Revolutionizing-Property-Management-with-Effortless-Touring-Technology
21. https://aiweekly.co/alerts/eliseai-raises-350m-at-4b-valuation-led-by-a16z-and-bessemer-for-housing-and
22. https://www.appfolio.com/blog/leasing-performer
23. https://www.appfolio.com/newsroom/appfolio-deepens-agentic-ai-across-leasing-accounting-and-resident-operations
24. https://www.lethub.co/blog/rental-inquiry-response-time-speed-to-lead (secondary source; cites a 2024 DelPrete study)
25. https://propmodo.com/what-the-research-on-lead-conversion-tells-us-about-ais-role-in-leasing/ (claims about half of leasing calls go unanswered, without naming a source)
26. https://realpage.com/blog/pump-volume-maximize-lead-conversion
27. https://rentengine.io/blog/self-guided-showings-vs-accompanied-showings
28. https://www.myaifrontdesk.com/property-management/facts/tour-no-show-rate
29. https://updater.com/blog/ultimate-checklist-for-smooth-resident-move-ins/
30. https://secondnature.com/benefits/move-in-concierge
31. https://bell-prop.helpscoutdocs.com/article/28-new-residents-welcome
32. https://tenant.checkr.com/resources/application-screening-fee/state/colorado
