# Demo script

About five minutes. What it shows: you hand off a phone task by text or call, Telo makes a real call, gets what it needs from you while the business waits, and remembers what businesses said last time.

## Before you present

- [ ] `.env.local` has the Claude, Dial and Keewano keys, `TELO_USER_PHONE` (the presenter's phone) and `DEMO_TARGET_PHONE` (the teammate playing the businesses). Google too, if you show email or the calendar.
- [ ] `npm run tunnel`, then `npm run dial:setup`, then restart `npm run dev`. The chips in the dashboard header say **live**. `dial:setup` also re-registers Telo's mid-call tools; Dial only reads the tool list then.
- [ ] Dial credit: check the balance in Dial's dashboard. A call costs about $0.22 a minute.
- [ ] **At least 30 minutes before going on:** Demo controls → **Load last week's Comcast call**. Keewano documents ~5 minutes before new events are queryable, but it took 15–20 on a fresh project.
- [ ] `npm run keewano:check` shows the Comcast commitment.
- [ ] The presenter's phone is linked: text `LINK <code>` (shown in the dashboard) to Telo's number, or set `TELO_USER_PHONE`.
- [ ] Updates on **Text + call** (the toggle under Telo's name in the thread). Until the number's 10DLC registration clears, Telo's SMS replies to US phones are blocked, so Telo phones you for anything that needs you; every message also shows in the dashboard thread.
- [ ] Use business names Telo hasn't called before (it remembers, and would answer from history).
- [ ] The teammate has the scripts below and a quiet room (Dial's agent stops talking at any background noise).

## 1. Memory (the headline)

Presenter texts Telo: **"My bill is wrong again. Can you call them and figure it out?"**

- Telo replies that it's on it. It found Comcast from your history, without being told.
- On the task page, **How Telo handled it** shows the steps: understood, checked past calls (the live Keewano query, rows and milliseconds), planned, called. "What Telo remembered" shows the October 2 promise: a $20 credit, A1832.
- The teammate's phone rings. Telo says: "On October 2, a representative confirmed a $20 service credit under confirmation A1832, but it was never applied."
- Teammate (Comcast): "You're right, it was never applied. I've applied it now. New confirmation C7714."
- Telo reports the result. Inside the call step: **An earlier promise was broken**, saved to Keewano.

## 2. Help while they wait

Presenter texts (or calls Telo and says): **"Ask Westbay Telecom to remove the new $15 equipment fee on my bill."**

- If Telo asks whose name the account is under, answer "mine".
- Teammate (Westbay): "Westbay billing. I'll need the account number first."
- Telo: "Let me check with Dylan, one moment." The presenter's phone buzzes (a text, and a call with Text + call on), and the dashboard's live call card shows **Westbay Telecom is waiting on the line** with a timer. Meanwhile Telo keeps the rep company: "Thanks for bearing with me…"
- Answer in the live card (or by text, or on Telo's call): **"4471-0098"**. Telo reads it out on the same call.
- Teammate: "Found it. That fee was a mistake, I've removed it. Confirmation W B 7781: W as in water, B as in boy."
- Telo finishes with one call. On the task page, the call step shows **Asked you while they waited** and **You answered**.

## 3. Judgment

Presenter texts: **"Cancel my gym membership at Equinox."**

- Telo asks for the email on the account. Reply with any email.
- Teammate (Equinox): "Before I cancel, we can do $18 a month instead of $65."
- Telo doesn't accept on its own. It asks you while the rep waits: "They offered $18/month instead of cancelling. Accept, or keep cancelling?" Tap **Keep cancelling** (or reply).
- Telo tells the rep. Teammate: "Done. Ends November 8, confirmation 18392."
- (If nobody answers within 90 seconds, Telo says it'll confirm and call back, asks you, then calls back with your answer.)

## 4. Ask it anything

Presenter texts: **"what's going on with everything?"**, then the judge's own question, e.g. **"how many times has a business broken a promise to me?"**

That one is answered from Keewano with live SQL. The dashboard's **Asked Keewano** card shows the question, the answer, and the SQL Claude wrote, with rows and milliseconds.

## 5. Calendar (if Google is connected)

Presenter texts: **"Book me a consultation at Lakeshore Orthodontics next week."** Telo picks a free time from your calendar. When the teammate offers a time you're busy, Telo checks your calendar on the call, turns it down, and asks for one of your free times. The booking lands on your calendar.

## 6. Voice (if time allows)

The presenter calls Telo's number: "Hey, how's the gym thing going?" Dial's agent calls Telo's `get_status` tool and answers.

## Without live services

Every scene also runs on the simulated stack (no keys): the teammate's lines are scripted, and transcripts stream live in the dashboard. Scene 2 is scripted for "Westbay Telecom" (add it with `TELO_DIRECTORY=[{"name":"Westbay Telecom"}]`; the `telo-sim` profile in `.claude/launch.json` does): answer in the live card when it appears.
