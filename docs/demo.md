# Demo script

About five minutes. Telo is the AI that works the phones for a small rental property manager. A tenant reports a broken AC. Telo calls two HVAC companies at once, chosen by what Keewano remembers. It gets the owner's OK by text while a vendor holds, books the tenant's window with the entry notice, follows up until it's fixed, and answers a judge's question from Keewano with live SQL.

## The cast

| Who | Played by | In the portfolio |
|---|---|---|
| Property manager (Telo works for them) | The presenter | Dylan, Bayside Property Management (`TELO_USER_PHONE`) |
| Tenant | Teammate 1 | Maria Gomez, 1418 Alder St, Unit B (`ten_alder_b`) |
| Owner | Teammate 2 | Priya Shah, approval limit $500 (`own_shah`) |
| HVAC vendor A | Teammate 3 | Summit Mechanical (`ven_summit`) |
| HVAC vendor B | Teammate 4 | Rapid Air Heating & Cooling (`ven_rapidair`) |

The seeded portfolio (`src/server/portfolio/data.ts`) has two owners, three properties, eight units with their appliances, eight tenancies, eight vendors, a warranty company and a utility. Its numbers are fictional 555-01xx numbers; point the cast at real phones with `TELO_PORTFOLIO_PHONES`.

## Before you present

- [ ] `.env.local` has the Claude, Dial and Keewano keys and `TELO_USER_PHONE` (the presenter), plus the cast's phones:
      `TELO_PORTFOLIO_PHONES={"ten_alder_b":"+1…","own_shah":"+1…","ven_summit":"+1…","ven_rapidair":"+1…"}`
      Each role needs its own phone: a text from the manager's own number is read as the manager.
- [ ] `npm run tunnel`, then `npm run dial:setup`, then restart `npm run dev`. The header chips say **live**.
- [ ] Dial credit topped up. Two vendor calls run at once, and a free account allows only two. A call costs about $0.22 a minute.
- [ ] The portfolio's history is in Keewano at least 30 minutes before going on: `npm run seed:portfolio` (safe to run twice). It was loaded at 12:46 PM on demo day and checked queryable by 1:05.
- [ ] Updates on **Text + call** in the thread header. Until the number's 10DLC registration clears, Telo's texts to US phones may be blocked, so test texting to each cast phone first. Every message also shows on the dashboard.
- [ ] A quiet room for the vendor teammates (Dial's agent stops talking at background noise).

## 1. A tenant texts (7 PM)

Maria texts Telo's number: **"The AC is out again. It's blowing warm air and it's 85 in here."** She attaches two photos (the thermostat and the outdoor unit).

- Telo replies to Maria that it's lining up a vendor. With no photos, it asks for them.
- The manager gets one text: the new work order, and why Telo is calling whom.

## 2. Memory picks who to call

On the work order's page, **What Telo remembered** shows the decision and the live Keewano queries behind it, with rows and milliseconds:

- This is Unit B's **third AC failure since June** ($550 in repairs; the AC is 15 years old). So Telo also asks for a **replacement price**.
- **CoolBreeze HVAC**, the usual vendor, **no-showed twice**. So Telo calls Summit Mechanical and Rapid Air instead.

## 3. Two calls at once

Both vendors' phones ring together. Telo opens: "I'm an AI assistant calling for Dylan at Bayside Property Management; this call is recorded."

- **Summit (Dana):** "Earliest is Thursday, 9 to 11. The diagnostic is $180, plus our $79 trip fee."
- **Rapid Air (Luis):** "We can do tonight between 8 and 9. It's likely the capacitor and contactor: $650, all in."

## 4. The owner approves while the vendor holds

$650 is over Priya's $500 limit. Telo tells Luis "One moment, I'm checking with the owner," and Priya gets a text:
"Rapid Air … can fix Unit B's AC tonight between 8 and 9 for $650. It's the third failure since June. Approve it, and do you want a replacement quote too?"

- Priya replies: **"Yes, approve it. And get a replacement quote too."**
- Telo tells Luis on the same call. Luis: "You're booked tonight between 8 and 9. Marco will bring a replacement quote. Confirmation RA2231."
- The dashboard's live card shows the question and a timer while Luis waits. The manager can also answer there.

## 5. Booked: the window, the notice, a polite no

- **Maria** gets the window and the **entry notice**. It's under 24 hours away, so Telo asks her to reply YES (California needs 24 hours' written notice unless the tenant agrees). She replies **"Yes."**
- **Summit** gets a polite "we've booked another company this time."
- **Priya** and **the manager** each get one booking update.

## 6. Follow-up closes the loop

Thirty minutes into the window, Telo texts Rapid Air "is your tech on the way?" and Maria "did they fix it? Reply Y or N". On stage, press **Check now** on the work order to skip the wait.

- Maria replies **"Y"**. Telo marks Rapid Air's arrival promise **kept** and closes the work order: fixed on the first visit, confirmed by the tenant, and **zero manager touches**. Seeded jobs from before Telo averaged 6.6 touches and 2.6 days to fix.

## 7. A judge asks anything

The presenter texts Telo the judge's own question. These are answered from Keewano with live SQL, and the dashboard's **Asked Keewano** card shows the SQL Claude wrote:

| Question | Answer from the seeded history |
|---|---|
| "Which vendor no-shows most?" | CoolBreeze HVAC, 2 no-shows |
| "What does a water-heater replacement usually cost us?" | About $1,788, between $1,725 and $1,850 |
| "Which unit cost the most in repairs this year?" | 22 Linden Ct, about $3,030 |
| "How long do owners take to approve?" | Priya about 4 minutes (by text); Marcus about 25 (by phone) |
| "How many trips were wasted because nobody let the vendor in?" | 2 |

## Backup scene: an emergency

A tenant texts **"I smell gas in the kitchen."** Telo texts back the safety instructions first ("leave the home now and call 911 from outside, then the gas company"), pages the manager, records the emergency, and calls no vendor. Telo never calls 911 itself.

## Without live services

Everything above runs on the simulated stack (no keys): the `telo-sim` profile in `.claude/launch.json`, or `npm run dev` without keys. Summit's and Rapid Air's lines are scripted. In the dashboard's **Demo controls**:

1. **Load the portfolio's history**
2. **Maria (tenant): AC is out, 2 photos**
3. When Rapid Air is waiting on the line: **Priya (owner): yes, and get a replacement quote** (or answer in the live card)
4. **Maria: YES to entry**
5. **Check now** on the work order's page, then **Maria: Y, it's fixed**

Without Keewano keys, the same decisions come from Telo's local copy of the events, and the page says so.

## What's honest to say

- The history before today is seeded, and it's labeled as seeded on slides. Everything Telo does during the demo is recorded live, on the same streams.
- Tenants report by text today, photos included. Calls from tenants are next on the list.
