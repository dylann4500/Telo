# Demo script

About seven minutes. Telo is the AI that works the phones for a small rental property manager. A tenant reports a broken AC. Telo calls the HVAC companies Keewano ranks first, gets the owner's OK while a vendor holds, books the tenant's window with the entry notice, follows up until it's fixed, schedules its own callbacks when a vendor says "call us back in three days", and answers a judge's question from Keewano with live SQL.

## The cast

| Who | Played by | In the portfolio |
|---|---|---|
| Property manager (Telo works for them) | The presenter | Dylan, Bayside Property Management (`TELO_USER_PHONE`) |
| Tenant | Teammate 1 | Maria Gomez, 1418 Alder St, Unit B (`ten_alder_b`) |
| Owner | Teammate 2 | Priya Shah, approval limit $500 (`own_shah`) |
| HVAC vendor A | Teammate 3 | Summit Mechanical (`ven_summit`) |
| HVAC vendor B | Teammate 4 | Rapid Air Heating & Cooling (`ven_rapidair`) |

With three phones, one teammate answers for every vendor (Summit, then Rapid Air, then Handy Hank): two vendors on the same phone are called one at a time. The owner's approval is then the dashboard's **Priya (owner)** button.

The seeded portfolio (`src/server/portfolio/data.ts`) has two owners, three properties, eight units with their appliances, eight tenancies, eight vendors, a warranty company and a utility. Its numbers are fictional 555-01xx numbers; point the cast at real phones with `TELO_PORTFOLIO_PHONES`.

## Before you present

- [ ] `.env.local` has the Claude, Dial and Keewano keys and `TELO_USER_PHONE` (the presenter), plus the cast's phones:
      `TELO_PORTFOLIO_PHONES={"ten_alder_b":"+1…","own_shah":"+1…","ven_summit":"+1…","ven_rapidair":"+1…"}`
      Each role needs its own phone: a text from the manager's own number is read as the manager.
- [ ] `npm run tunnel`, then `npm run dial:setup`, then restart `npm run dev`. The header chips say **live**.
- [ ] Dial credit topped up. Two vendor calls run at once, and a free account allows only two. A call costs about $0.22 a minute.
- [ ] The portfolio's history is in Keewano at least 30 minutes before going on: `npm run seed:portfolio` (safe to run twice). It was loaded at 12:46 PM on demo day and checked queryable by 1:05.
- [ ] `npm run keewano:check` shows the HVAC ranking "from keewano" (CoolBreeze last, with 2 no-shows) and Unit B's two AC repairs.
- [ ] `TELO_PARTY_CALLS=1`: until the number's 10DLC registration clears, carriers reject Telo's texts to US phones, so Telo calls the tenant and owner for what needs their answer (the entry notice, "fixed?", the owner's approval, safety steps). Texts *to* Telo work. Every message also shows on the dashboard.
- [ ] Save +1 (712) 530-5671 as a contact named **Telo** on every cast phone. A phone on Do Not Disturb or silencing unknown callers sends Telo straight to voicemail (Telo tries once more a minute later).
- [ ] Updates on **Text + call** in the thread header, so Telo phones the presenter with the booking and the close.
- [ ] A quiet room for the vendor teammates (Dial's agent stops talking at background noise).

## 1. A tenant calls or texts (7 PM)

Maria calls Telo's number: **"The AC is out again. It's blowing warm air and it's 85 in here."** Telo answers with the disclosure ("the AI assistant for Bayside Property Management; this call is recorded"), asks what's wrong and how bad, and says it will text her. Or she texts the same thing with two photos (the thermostat and the outdoor unit).

- Telo texts Maria that it's lining up a vendor. With no photos yet, it asks for them, and she texts them back.
- The manager gets one text: the new work order, and why Telo is calling whom.
- The dashboard: the work order appears on the board under **New & calling**.

## 2. Memory picks who to call

On the work order's page, the **flowchart** shows each step as it happens (report, triage, Keewano, the calls side by side, owner approval, booking, entry notice, follow-up, close). **What Telo remembered** shows the decision and the live Keewano queries behind it, with rows and milliseconds:

- This is Unit B's **fourth AC failure since June** ($1,200 in repairs; the AC is 15 years old). So Telo also asks for a **replacement price**. Every rehearsal that closes adds a repair: Keewano keeps everything, so check the count before going on.
- **CoolBreeze HVAC**, the usual vendor, **no-showed twice**. So Telo calls Summit Mechanical and Rapid Air instead.

## 3. Two calls at once

Both vendors' phones ring together, and the dashboard's **On the phone now** strip shows both calls side by side with live transcripts. Telo opens: "I'm an AI assistant calling for Dylan at Bayside Property Management; this call is recorded."

- **Summit (Dana):** "Earliest is Thursday, 9 to 11. The diagnostic is $180, plus our $79 trip fee."
- **Rapid Air (Luis):** "We can do tonight between 8 and 9. It's likely the capacitor and contactor: $650, all in."

## 4. The owner approves while the vendor holds

$650 is over Priya's $500 limit. Telo tells Luis "One moment, I'm checking with the owner," and Priya gets a text:
"Rapid Air … can fix Unit B's AC tonight between 8 and 9 for $650. It's the third failure since June. Approve it, and do you want a replacement quote too?"

- Priya replies: **"Yes, approve it. And get a replacement quote too."**
- Telo tells Luis on the same call. Luis: "You're booked tonight between 8 and 9. Marco will bring a replacement quote. Confirmation RA2231."
- On the dashboard, the work order moves to **Waiting on someone**, and Rapid Air's live tile shows the question and a timer while Luis waits. The manager can also answer there.

## 5. Booked: the window, the notice, a polite no

- **Maria's phone rings**: Telo gives her the window and the **entry notice**. It's under 24 hours away, so Telo asks if it's OK for them to come in (California needs 24 hours' written notice unless the tenant agrees). She says **"Yes, that works for me."**
- **Summit** gets a polite "we've booked another company this time."
- **Priya** and **the manager** each get one booking update.

## 6. Follow-up closes the loop

Thirty minutes into the window, Telo asks Rapid Air "is your tech on the way?" and calls Maria: "did they fix it?" On stage, press **Check now** on the work order to skip the wait.

- Maria says **"Yes, it's fixed."** Telo marks Rapid Air's arrival promise **kept** and closes the work order: fixed on the first visit, confirmed by the tenant, and **zero manager touches**. The dashboard's **Manager touches per job** tile shows it: 6.6 for the seeded jobs from before Telo (2.6 days to fix), 0 with Telo.

## 7. A judge asks anything

The presenter calls Telo from their phone and asks the judge's own question; Telo answers out loud. These are answered from Keewano with live SQL (about a second), and the dashboard's **Asked Keewano** card shows the SQL Claude wrote:

| Question | Answer (checked live on demo day) |
|---|---|
| "Which vendor no-shows most?" | CoolBreeze HVAC, 2 no-shows |
| "How many times has the AC at Alder Street Unit B been repaired?" | Every repair on record, counting tonight's: 3 and $1,200 before the demo run, 4 and $1,850 after it. Telo adds its own newest writes until Keewano shows them, without counting anything twice |
| "What does a water-heater replacement usually cost us?" | About $1,788 (2 on record) |

Re-seeding on demo day stored some seeded events in Keewano a second and third time, so repair totals by unit, wasted trips, owner approval times and visit counts read high. Use the questions above unless the history is loaded once into a fresh Keewano project.

## 8. Telo follows up on its own

After the AC job closes, Maria texts **"The kitchen cabinet door is hanging off its hinge. Not urgent, whenever someone can come."** It's routine general work, so Telo calls Handy Hank's Home Repair (the only handyman).

- Hank: **"We're booked solid this week. Call us back in three days and I'll have openings."** The board shows the callback scheduled three days out, and Telo tells the manager it will call Hank then.
- Press **Check now** to jump to that day. Hank: **"Still slammed, sorry. Try us again in four days."** Telo schedules itself again ("the second time they've asked").
- Optional: **Check now** once more. Hank: **"Good news, we had a cancellation. You're booked for tomorrow at 2 PM. It's $120 plus our trip fee."** Booked, and Maria's phone rings with the entry notice.

An urgent job doesn't wait: when a vendor's callback is more than a day out, Telo calls the next vendor in Keewano's ranking now. When nobody answers, it calls the next one too, and a tenant saying "nobody came" puts a no-show on that vendor's record.

## Backup scene: an emergency

A tenant texts **"I smell gas in the kitchen."** Telo texts back the safety instructions first ("leave the home now and call 911 from outside, then the gas company"), pages the manager, records the emergency, and calls no vendor. Telo never calls 911 itself.

## Without live services

Everything above runs on the simulated stack (no keys): the `telo-sim` profile in `.claude/launch.json`, or `npm run dev` without keys. Summit's and Rapid Air's lines are scripted. In the dashboard's **Demo controls**:

1. **Load the portfolio's history**
2. **Maria calls: AC is out** (then **Maria (tenant): AC is out, 2 photos** sends the photos), or just the text with photos
3. When Rapid Air is waiting on the line: **Priya (owner): yes, and get a replacement quote** (or answer in the live card)
4. **Maria: YES to entry**
5. **Check now** on the work order's page, then **Maria: Y, it's fixed**

Without Keewano keys, the same decisions come from Telo's local copy of the events, and the page says so.

## What's honest to say

- The history before today is seeded, and it's labeled as seeded on slides. Everything Telo does during the demo is recorded live, on the same streams.
- Tenants report by phone or by text; photos come by text.
- The before-and-after numbers compare seeded history with Telo's own jobs, all from the same work-order events.
