# Brief: Telo for property managers

You're taking over Telo, a working hackathon app, and repurposing it from a consumer assistant into the AI that works the phones for small rental property managers. The team demos it today (SpeedHacks, October 11, 2026). **Building ends at 4:00 PM Pacific**, so build what the demo needs first and keep the app working at every commit. The timeline is in section 9 of the research doc. The hard deadline inside it: the portfolio and the P0 Keewano event catalog must be in place, and the seeded history loaded into Keewano, by about 1:45 PM, because new events take 15–20 minutes to become queryable.

## Read first

- `CLAUDE.md`, `README.md` and `docs/architecture.md`: how Telo works and the rules you must keep.
- `docs/integrations/dial.md` and `docs/integrations/keewano.md`: verified facts about the two sponsor APIs. Check them before you use an API.
- `docs/property-management/research.md`: start there, and research further where it's thin.
  - Section 4: the use cases, with priorities.
  - Section 5: **the variables to track**, normalized to Telo's Keewano model.
  - Section 7: the rules.
  - Section 9: the timeline and the demo.
- `docs/property-management/research/`: the full researched write-ups behind section 4, with sources.

## What Telo becomes

A property manager gives Telo one phone number. Tenants, prospects, vendors and owners call or text it. Telo does the calling and texting a property manager does all day. It takes a tenant's report, calls several vendors at once to compare availability, price and terms, and gets the owner's approval while the vendor holds. Then it schedules access with the tenant, follows up until the job is done, and remembers how every unit and vendor has behaved. The property manager supervises by text and call; the dashboard stays a mirror of that conversation.

Who's who:

- **Property manager:** Telo works for them. They set the rules, and get the updates and the questions.
- **Owners:** approve spending above their limit and get updates.
- **Tenants and prospects:** call and text in. Telo calls them about access, follow-ups and reminders.
- **Vendors and contractors:** Telo calls them for availability, quotes, terms and arrival times, and they call back.
- **Others Telo may call:** housing authorities, HOAs, utilities, home-warranty companies, insurers.

The target customer is a firm or owner-operator managing roughly 20–500 long-term rental units (scattered single-family homes and small buildings) without a dedicated maintenance coordinator. Short-term rentals come later, on the same engine.

## What wins today

- **Dial** judges depth and creativity. Use inbound and outbound calls, parallel calls, mid-call tools, texts with photos, phone menus and hold, and transfer to a person, where each one does real work.
- **Keewano** judges whether memory carries weight:
  - events go in during the event
  - the demo runs a live query
  - the answer changes what Telo does
  - Telo answers a judge's unplanned question from Keewano
  - ideally, a before-and-after metric is measured in Keewano itself
- **Investors** judge the business: a sharp customer, a real bottleneck removed, and a moat. Here the moat is the history of every unit and vendor across the portfolio.

## What to build, in order

**Must have for the demo**

1. **Parties and routing.** Replace the single user with:
   - a property manager
   - a seeded portfolio: owners, properties, units, tenants, vendors
   - routing by phone number, so every call and text lands on the right person, unit and task

   Seed enough that the demo runs without any property-management software.
2. **Maintenance with parallel vendor calls.**
   - Intake by call or text, with photos.
   - Triage. Emergencies go to 911 or the utility, and to the on-call person, first.
   - Calls to two or three vendors at once, comparing availability, price and terms.
   - Owner approval above the limit while the vendor holds.
   - An access window agreed with the tenant, with the notice the law requires.
   - A follow-up that confirms the fix and records whether the vendor kept their word.
3. **Memory that changes decisions.** Unit and vendor history in Keewano:
   - picks who to call first
   - switches from repair to replacement bids after repeat failures
   - answers portfolio questions such as "which vendor no-shows most?" and "which units cost the most this year?"

**Next, in this order**

4. **Rent.** Reminders, conversations with late payers, and payment plans tracked as promises. No legal notices and no pressure tactics.
5. **Turnovers.** When a tenant gives notice, schedule the move-out inspection and line up cleaners, painters and the rest in parallel to cut vacant days.
6. **Contractor bids for projects** (a roof, an HVAC replacement). Call several contractors, compare terms, warranties and start dates, and give the owner the comparison.
7. **Leasing.** Answer inquiries and book tours within fair-housing rules. Never make screening decisions.
8. **As time allows:** renewals, move-in coordination, vendor insurance certificates, owner check-ins, building-wide notices, home-warranty and insurance claims.

The research doc covers each of these, with the variables to track. Choose the scope that fits the time: depth on items 1–3 beats breadth. Keep the Gmail and Calendar integrations; they fit. Vendor quotes and invoices arrive by email, and showings and vendor windows belong on the manager's calendar. The seeded portfolio replaces the consumer demo history (the Comcast call).

## Rules you must keep

- **Everything in `CLAUDE.md`:**
  - task state changes only through `transitionTask`
  - only typed, low-cardinality values go to Keewano
  - never dial a number nobody gave Telo (`tests/safety.test.ts` guards this)
  - the simulated stack keeps working for every demo flow
  - the dashboard stays a mirror
- **Keewano's event catalog is append-only** (ids from 2000). Add events, and never renumber or reuse one.
- **Every call opens with a disclosure:** Telo is an AI assistant calling for the property manager, and the call is recorded.
- **No cold or marketing calls.** Telo calls tenants, vendors and owners only about their own business with the manager. Non-emergency calls happen 8 AM–8 PM in the recipient's time zone.
- **Spending follows each owner's approval limit,** and emergencies have their own cap. Telo never agrees to anything it isn't authorized for.
- **People keep these:** legal notices, evictions, screening decisions, and anything involving wire transfers or payment details.

## How to work

- Plan first, then build in thin end-to-end slices.
- Keep `npm test` and `npm run typecheck` passing, and add tests for new flows on the simulated stack.
- Add a simulated scenario for every demo flow, so the demo runs without keys, and keep the labs working.
- Research on your own where the doc is thin or you're unsure (state rules, sponsor APIs, how managers actually work), but don't stall on it.
- Update `README.md`, `docs/architecture.md` and `docs/demo.md` as you go; the demo script must match what the app does.
- Commit small and often.

## Done means

- The demo runs end to end, on the simulated stack and live:
  1. A tenant reports a problem by call or text, with a photo.
  2. Telo calls vendors in parallel.
  3. The owner approves mid-call.
  4. The tenant gets a window.
  5. A follow-up closes the loop.
  6. Keewano history changes a decision.
  7. A judge's question is answered with live SQL.
- A seeded portfolio has enough history for Keewano. It needs loading at least 30 minutes before presenting.
- Tests and typecheck pass, and the docs describe only what's real.
