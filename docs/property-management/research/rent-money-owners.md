# Telo for property managers: rent, money and owners

*Researched 2026-10-11. **VERIFIED [n]** means the numbered source says so (mostly read via search summaries); anything unmarked is **INFERRED**. Not legal advice. Keewano entities: `tenant_account` (one ledger per lease), `lease`, `unit`, `owner`, `vendor`, `agency`. `_cents`, `_seconds` and `_days` fields are integers; `state` is a 2-letter code.*

## Area summary
Money is a PM's most frequent and most regulated phone and text work: reminders, late rent, payment plans, owner statements and approvals. A PM collecting rent it managed before any default is generally not an FDCPA debt collector, but accounts it takes over already in default can make it one VERIFIED [1][2]. AI voices count as "artificial" under the TCPA, so Dial calls to cell phones need consent and opt-out handling VERIFIED [3][4]. Massachusetts also caps original creditors at two calls or texts per 7 days per debt VERIFIED [8]. Incumbents automate reminders and delinquency outreach [17][19][21][22]; Telo's opening is follow-through across parties that remembers who keeps promises.

## Use-case catalog

### 1. Pre-due rent reminders
- **Trigger:** N days before rent is due; autopay failure; a lease's first rent.
- **Parties and who approves:** Tenant; the PM approves cadence and template once.
- **Calls and texts:** Outbound SMS; voice only for tenants who were late before; replies go to #3.
- **Telo decides alone vs asks:** Alone: remind, state balance, send link. Asks: any change to amount or date.
- **Variables to track:** *Task facts:* phone, balance, consent · *Keewano* on `tenant_account`: `rent_reminder_sent{channel: sms|voice, days_before_due: int, autopay: flag}`, `rent_paid{days_from_due: int, method: ach|card|check|money_order|assistance, full: flag, amount_cents}`, `contact_opt_out{channel: sms|voice}` · *KPIs:* on-time rate, autopay share.
- **A decision that history changes:** Reliable payers get no reminder; a rising `days_from_due` earns a call.
- **Rules and guardrails:** Consent before AI calls to cell phones VERIFIED [3][4]; honor opt-outs, including STOP, within 10 business days VERIFIED [5][6][7]; "revoke-all" delayed to Jan 31, 2027 VERIFIED [5].
- **Products already doing it, and the gap:** Buildium AutoPay and auto late fees (secondary) [21]; AppFolio Realm-X "Rent Collection" flow VERIFIED [17]. Gap: turning replies into promises.
- **Build effort:** S · **Demo-ability:** 2

### 2. Late rent, late notices, partial and NSF payments
- **Trigger:** Grace period ends with a balance; ACH return or chargeback; partial payment.
- **Parties and who approves:** Tenant (lease signers only); the PM approves waivers, partials after a notice, certified-funds rules and escalations.
- **Calls and texts:** SMS then voice; verify identity before naming the debt; voicemails without detail; cold transfer to the PM on a dispute or legal threat; promises go to #3.
- **Telo decides alone vs asks:** Alone: balance, link, reason. Asks: waivers, disputes, anything about eviction.
- **Variables to track:** *Task facts:* ledger, hardship story, who answered · *Keewano* on `tenant_account`:
  - `rent_late{days_late: int, balance_cents, late_fee_cents, state: code}`
  - `collection_contact{channel: sms|voice, outcome: paid|promise|dispute|hardship|no_answer|voicemail|wrong_party|refused, contacts_7d: int}`
  - `payment_returned{reason: nsf|closed|stop_payment|chargeback|other, amount_cents, count_12mo: int}`
  - `partial_payment{amount_cents, remaining_cents, accepted: flag}`
  - `escalated_to_human{reason: dispute|legal_threat|notice_due|cap_hit|waiver}`

  *KPIs:* delinquency at days 5, 10 and 30; dollars per contact; return rate.
- **A decision that history changes:** One-text payers never get calls; tenants who broke a promise get the PM's terms; a second return in 12 months prompts a certified-funds question to the PM.
- **Rules and guardrails:**
  - **MA:** creditors get at most two phone or text contacts per 7 days per debt; autodialed attempts without a voicemail still count VERIFIED [8][9]. Whether landlords count as "creditors" there is unconfirmed, so apply the cap anyway.
  - **CA:** the Rosenthal Act covers original creditors, but courts mostly hold rent isn't "consumer credit" (disputed) VERIFIED [13][14][16]. SB 1324, which would have covered rental debt, died [15].
  - **PM as debt collector:** validation notice, 7 calls in 7 days, 8am–9pm, no third-party disclosure (Reg F, not re-fetched).
  - **Late fees**, VERIFIED (secondary) [10][11][12]:
    - ME: up to 4%, after 15 days.
    - MA: none before 30 days.
    - TX: 12% (up to 4 units) or 10% safe harbor, after 2 full days.
    - MD: 5%.
    - DE: 5%, after 5 days.
    - NY: lesser of $50 or 5% (secondary) [10].
    - CO and OR: sources conflict.
  - **Never:** threats the PM won't carry out, or taking card or bank numbers.
- **Products already doing it, and the gap:**
  - AppFolio: Realm-X "Debt Collection" flow VERIFIED [17].
  - Frontdesk: claims voice and SMS follow-up on late rent for AppFolio and Buildium [19][20].
  - Colleen AI: integrates Yardi, RealPage, Entrata, Rent Manager and ResMan VERIFIED [22][23]; a reported Entrata acquisition is unconfirmed [24].
  - Gap: small PMs with scattered sites.
- **Build effort:** M · **Demo-ability:** 4

### 3. Payment plans and promises to pay
- **Trigger:** Tenant asks for time; #2 ends in a promise or hardship.
- **Parties and who approves:** Tenant; the PM (or the owner, if the agreement says so) approves plans outside the envelope.
- **Calls and texts:** Two-way SMS and voice; mid-call `ask_customer` to the PM while the tenant waits; terms by SMS confirmed with YES; a check-in on each due date.
- **Telo decides alone vs asks:** Alone: one promise before the next due date. Asks: installments, waivers, tenants who broke a promise.
- **Variables to track:** *Task facts:* terms, hardship · *Keewano* on `tenant_account`: existing `commitment_received{commitment_amount_cents, commitment_due_at}`, `commitment_fulfilled`, `commitment_broken`; new `payment_plan{installments: int, total_cents, approved_by: telo|pm|owner, outcome: completed|defaulted|renegotiated}` · *KPIs:* promise-kept rate, plan completion, filings avoided.
- **A decision that history changes:** Completion by installment count (portfolio SQL) sets the default offer; a promise broken within 12 months needs PM approval.
- **Rules and guardrails:** Written terms; accepting partial rent after a notice can waive rights in some states; coarse hardship codes, no health data (Keewano can't delete).
- **Products already doing it, and the gap:** Frontdesk claims it writes plans back to AppFolio [19]; no native Buildium plans found [21]. Gap: a memory of kept and broken promises that shapes the next offer.
- **Build effort:** S · **Demo-ability:** 5

### 4. Rental-assistance coordination
- **Trigger:** Tenant reports pending aid; a housing-authority payment is missing or cut; a caseworker calls.
- **Parties and who approves:** Tenant, caseworker, housing authority or charity; the PM approves landlord commitments.
- **Calls and texts:** Parallel calls through agency phone menus and hold; inbound caseworker calls; secure upload link (no IDs by MMS); mid-call question to the PM when an agency needs the landlord's agreement.
- **Telo decides alone vs asks:** Alone: status checks, sending the ledger or W-9 on file. Asks: agreeing to terms, pausing enforcement.
- **Variables to track:** *Task facts:* case numbers, caseworker, tenant consent · *Keewano:* `assistance_case{program: hcv|local_era|charity|state|other, status: started|submitted|approved|denied|paid, amount_cents, days_in_status: int}` on `tenant_account`; `agency_call{hold_seconds, menu_steps: int, outcome: status_given|callback|voicemail|wrong_dept}` on `agency` · *KPIs:* aid dollars, days to payment.
- **A decision that history changes:** Each agency's hold time by hour picks the call slot.
- **Rules and guardrails:** Tenant's written consent first; agency numbers come from the PM (Telo never dials a number nobody gave it); source-of-income protections. HUD's 2024 rule requiring 30 days' notice for unpaid rent (public housing and project-based units) was revoked effective Mar 30, 2026 VERIFIED [25][26].
- **Products already doing it, and the gap:** None found; long-hold calling suits Dial.
- **Build effort:** M · **Demo-ability:** 5

### 5. Utility billing and chargebacks
- **Trigger:** Owner-paid bill; move-in or move-out; tenant hasn't opened an account; shutoff notice.
- **Parties and who approves:** Utilities, tenant; the PM approves charges not in the lease; the owner bears vacancy costs.
- **Calls and texts:** Parallel calls to water, gas and electric (menus, hold); bill image by MMS with the chargeback.
- **Telo decides alone vs asks:** Alone: transfers, chargebacks the lease defines. Asks: disputes, odd bills.
- **Variables to track:** *Task facts:* utility account numbers · *Keewano:* `utility_bill{type: water|sewer|trash|gas|electric, amount_cents, payer: owner|tenant, period_days}` and `utility_transfer{type, direction: to_owner|to_tenant, status: done|pending|failed, hold_seconds}` on `unit`; `utility_chargeback{type, amount_cents, method: direct|rubs|submeter, disputed: flag}` on `lease` · *KPIs:* recovery rate, vacancy utility cost.
- **A decision that history changes:** A bill far above the unit's baseline opens a leak work order, not a chargeback.
- **Rules and guardrails:** Undisclosed "utility administration fees" were part of the FTC/Colorado Greystar case VERIFIED [29][30]; states regulate RUBS and submetering.
- **Products already doing it, and the gap:** Utility-billing services (not researched). Gap: calling the utilities.
- **Build effort:** M · **Demo-ability:** 4

### 6. Security-deposit disposition and former-tenant balances
- **Trigger:** Keys returned; the state clock starts.
- **Parties and who approves:** Former tenant, vendors; the PM approves the itemization; the owner approves deductions over a limit.
- **Calls and texts:** SMS for a forwarding address; parallel vendor calls for invoices; deadline reminders; balance follow-up under #2 rules.
- **Telo decides alone vs asks:** Alone: gather, compute the deadline, draft. Asks: every deduction; a human sends.
- **Variables to track:** *Task facts:* forwarding address, photos, invoices · *Keewano* on `lease`: `move_out{state: code, deposit_cents}`, `deposit_disposition{deadline_days: int, sent_on_day: int, deductions_cents, refund_cents, balance_owed_cents, on_time: flag}`, `deposit_dispute{outcome: resolved|refund_raised|court}` · *KPIs:* on-time rate, dispute rate.
- **A decision that history changes:** Often-disputed deduction categories go to PM review.
- **Rules and guardrails:** CA 21 days, TX 30, NY 14 VERIFIED (secondary) [31][32]; FL 15/30 partly verified; WA sources conflict; range 14–60 days [31][32]. The FTC alleged Invitation Homes "systematically withheld" deposits VERIFIED [27][28]. Balances placed with a collection agency fall under the FDCPA.
- **Products already doing it, and the gap:** Colleen sells former-resident collections VERIFIED [23]. Gap: deadline-driven gathering and approvals.
- **Build effort:** M · **Demo-ability:** 4

### 7. Owner onboarding
- **Trigger:** New management agreement.
- **Parties and who approves:** Owner, prior PM, tenants, utilities, HOA; the PM approves.
- **Calls and texts:** Parallel calls to the prior PM (ledgers, deposits), utilities and HOA; intro texts to tenants with the new pay link; checklist nudges to the owner.
- **Telo decides alone vs asks:** Alone: chase documents, introduce. Asks: money transfers, disputes with the prior PM.
- **Variables to track:** *Task facts:* documents, contacts; bank details only via the software's secure link · *Keewano:* `onboarding_item{item: agreement|w9|bank_link|insurance|hoa|keys|leases|ledgers|deposits, status: requested|received|blocked, days_open: int}` on `owner`; `takeover_snapshot{in_arrears: flag, balance_cents}` on `tenant_account` · *KPIs:* days to onboard, tenants on the new portal by the first due date.
- **A decision that history changes:** Usual blockers (deposits held by the prior PM) start first.
- **Rules and guardrails:** `in_arrears = true` applies debt-collector rules to that account, since it was obtained after default (per [1][2]).
- **Products already doing it, and the gap:** Owner portals. Gap: chasing third parties.
- **Build effort:** M · **Demo-ability:** 3

### 8. Owner approvals and reserve requests
- **Trigger:** Estimate over the owner's limit; plan or write-off outside policy; reserve below minimum.
- **Parties and who approves:** The owner, within the management agreement; the PM sets the envelope.
- **Calls and texts:** MMS of estimate and photos for YES/NO; if urgent, call the owner while the vendor holds (mid-call MCP); cold transfer to the PM on request.
- **Telo decides alone vs asks:** Alone: under the limits, and emergencies the agreement allows. Asks: everything above.
- **Variables to track:** *Task facts:* estimate, photos · *Keewano* on `owner`: `owner_approval{kind: repair|plan|writeoff|deduction|reserve|renewal, amount_cents, outcome: approved|declined|modified|no_response, response_seconds, channel: sms|voice}`, `reserve_request{amount_cents, reason: below_min|capex|vacancy, funded: flag, days_to_fund: int}` · *KPIs:* approval latency, work-order cycle time.
- **A decision that history changes:** The owner's fastest channel picks SMS or a call; routine approvals let Telo suggest the PM raise the limit.
- **Rules and guardrails:** Authority comes from the agreement; one owner's trust funds never pay another's bills.
- **Products already doing it, and the gap:** Owner portals take approvals; none gets one live while a vendor waits.
- **Build effort:** S · **Demo-ability:** 5

### 9. Owner check-ins, statements and distributions
- **Trigger:** Owner calls or texts; statement released; distribution below last month.
- **Parties and who approves:** Owner; the PM handles disputes.
- **Calls and texts:** Inbound voice and SMS; monthly SMS summary; cold transfer to the PM.
- **Telo decides alone vs asks:** Alone: read-only facts (rent status, work orders, the distribution and why it changed). Asks: adjustments, fee questions.
- **Variables to track:** *Task facts:* statement lines · *Keewano* on `owner`: `owner_inquiry{topic: distribution|statement|vacancy|repair|tenant|fees|sale, resolved_by: telo|pm, seconds}`, `distribution_sent{amount_cents, days_from_target: int, held: none|reserve|negative_balance|pending_bill}` · *KPIs:* inquiries resolved without the PM, owner churn.
- **A decision that history changes:** Rising inquiries or fee questions flag churn risk, so the PM calls first.
- **Rules and guardrails:** Verify the owner (caller ID plus PIN) before money facts; minimal tenant PII.
- **Products already doing it, and the gap:** Owner portals. Gap: phone answers that explain why.
- **Build effort:** S · **Demo-ability:** 4

### 10. Vendor invoices and payment status
- **Trigger:** Vendor asks "when do I get paid?"; invoice lacks a W-9 or COI; invoice over estimate.
- **Parties and who approves:** Vendor; the PM approves variances; the owner via #8.
- **Calls and texts:** Inbound status; outbound document requests (MMS); parallel call to the tenant to confirm the work.
- **Telo decides alone vs asks:** Alone: status, document requests. Asks: variances, disputes, rush pay.
- **Variables to track:** *Task facts:* invoice, documents · *Keewano* on `vendor`: `vendor_invoice{trade: plumbing|hvac|electrical|turn|landscaping|other, amount_cents, variance_cents, docs_missing: int, days_to_pay: int}`, `work_verified{by: tenant|photo|pm, outcome: ok|redo}` · *KPIs:* days payable, redo rate.
- **A decision that history changes:** Vendors who overrun estimates or miss promised dates need pre-approval.
- **Rules and guardrails:** COI and W-9 before payment.
- **Products already doing it, and the gap:** PM-software payables. Gap: chasing by phone.
- **Build effort:** S · **Demo-ability:** 3

## Build first
1. **Late rent, then a promise, then follow-up (#2, #3).** The biggest money lever; it reuses `commitment_*` events, `transitionTask` and scheduled callbacks. Demo: a tenant texts "can I pay Friday?"; Telo checks kept and broken promises, asks the PM mid-thread about splitting the payment, confirms by SMS and checks back Friday.
2. **Owner approval while the vendor waits (#8).** A small build: let `ask_customer` reach a named approver (the owner), not only the PM.
3. **Rental-assistance status calls (#4).** Shows phone menus, hold and parallel calls. Collection-law risk is low because Telo calls agencies, not debtors, and no product does this.

Runner-up: deposit deadlines (#6).

## Keep human or avoid
- **Notices to pay or quit, eviction filings, terminations.** Form and service rules vary by state, and errors restart cases. HUD's notice rule was finalized in 2024 and revoked in 2026 VERIFIED [25][26]. Telo only flags that a notice is due.
- **Accounts where the PM is a debt collector:** arrears at takeover, debts of non-clients, placed debts. These go to an agency or attorney.
- **Card or bank numbers:** never by voice or text; send links.
- **Itemizations, settlements, write-offs, waivers:** a human signs them.
- **Threats** of eviction or credit reporting, and any talk of the debt with anyone but the tenant.
- **New or hidden fees.** FTC settlements with Invitation Homes ($48M, Sept 2024) and Greystar ($24M, Dec 2025) targeted undisclosed mandatory fees. The FTC chairman directed staff toward a rule on rental fees VERIFIED [27][28][29][30].
- **Fair housing.** Treat tenants the same regardless of protected class or voucher; keep hardship codes out of Keewano.

## Sources
1. https://volo.abi.org/node/1167 (De Dios v. International Realty, 9th Cir. 2011)
2. https://law.justia.com/cases/federal/district-courts/FSupp2/67/1052/2375444 (Alexander v. Omega Mgmt.)
3. https://huntonak.com/privacy-and-information-security-law/fcc-issues-declaratory-ruling-that-tcpa-applies-to-ai-generated-voice-calls
4. https://www.commlawblog.com/2024/02/articles/fcc/fcc-clarifies-that-ai-generated-voices-are-subject-to-tcpa/
5. https://www.burr.com/telephone-consumer-protection-act/the-fcc-delays-effective-date-of-tcpa-revoke-all-rule-until-january-31-2027
6. https://gryphon.ai/regulatory-report-january-2026/
7. https://mslawgroup.com/delayed-again-fcc-pushes-back-tcpas-revoke-all-rule-to-january-31-2027/
8. https://www.mass.gov/doc/940-cmr-7-debt-collection-regulations/download
9. https://www.alston.com/en/insights/publications/2019/03/what-counts-as-an-attempt-to-contact-debtor
10. https://resources.hemlane.com/late-fee-laws-by-state
11. https://rentredi.com/blog/late-fees-by-state/
12. https://texastenant.org/while-you-are-renting/late-fees
13. https://dfpi.ca.gov/wp-content/uploads/sites/337/2024/02/P.-OLaughlin-1.12.24.pdf
14. https://sjud.senate.ca.gov/sites/sjud.senate.ca.gov/files/sb_1324_durazo_sjud_analysis.pdf
15. https://caanet.org/caa-stops-bill-that-treated-back-rent-like-unpaid-credit-card-debt/
16. https://www.severson.com/?p=24180
17. https://www.appfolio.com/our-software/management-growth
18. https://www.appfolio.com/partners/axela (HOA owner delinquency, not tenant rent)
19. https://www.myaifrontdesk.com/multifamily/appfolio-delinquency-followup-automation
20. https://www.myaifrontdesk.com/multifamily/buildium-rent-collection-automation
21. https://ustechautomations.com/resources/blog/automated-rent-collection-comparison-2026
22. https://www.businesswire.com/news/home/20230720933440/en/Colleen-AI-Announces-3.5-Million-in-Series-Seed-Funding-Led-by-Wilshire-Lane-Capital
23. https://inman.com/2023/12/21/colleens-ai-property-management-solution-automates-rent-collection
24. https://startupim.com/company/colleen-ai
25. https://www.govinfo.gov/content/pkg/FR-2024-12-13/html/2024-28861.htm
26. https://www.govinfo.gov/content/pkg/FR-2026-02-26/pdf/2026-03921.pdf
27. https://fortune.com/2024/09/25/invitation-homes-ftc-settlement-hidden-fees
28. https://www.cbsnews.com/amp/colorado/news/invitation-homes-deceived-renters-on-fees-ftc-says
29. https://www.insideprivacy.com/consumer-protection/greystars-24-million-settlement-signals-ftc-crackdown-on-hidden-rental-fee/
30. https://www.azag.gov/press-release/attorney-general-mayes-announces-settlements-greystar-over-hidden-rental-charges-and
31. https://resources.tellusapp.com/tenants/security-deposits/security-deposit-return-timelines-by-state
32. https://ipropertymanagement.com/laws/how-long-does-a-landlord-have-to-return-a-security-deposit
