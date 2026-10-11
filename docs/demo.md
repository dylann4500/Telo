# Demo script

About four minutes. What it shows: you hand off a phone task by text, Telo makes a real call, pauses only for a real decision, and remembers what businesses said last time.

## Before you present

- [ ] `.env.local` has the Claude, Dial and Keewano keys, `TELO_USER_PHONE` (the presenter's phone) and `DEMO_TARGET_PHONE` (the teammate playing the businesses).
- [ ] `npm run tunnel`, then `npm run dial:setup`, then restart `npm run dev`. All three chips in the dashboard header say **live**.
- [ ] Dial credit is topped up, so calls aren't capped at 5 minutes.
- [ ] **At least 30 minutes before going on:** Demo controls → **Load last week's Comcast call**. Keewano documents ~5 minutes before new events are queryable, but it took 15–20 on a fresh project.
- [ ] `npm run keewano:check` shows the Comcast commitment.
- [ ] The presenter's phone is linked: text `LINK <code>` (shown in the dashboard) to Telo's number.
- [ ] Texting replies: until the number's 10DLC registration clears, Telo's SMS replies to US phones are blocked. Telo phones you instead for anything that needs you (questions, approvals, results), and every reply shows in the dashboard thread. For status, call Telo.
- [ ] The teammate has the scripts below. They answer as the business.

## 1. Memory (the headline)

Presenter texts Telo: **"My bill is wrong again. Can you call them and figure it out?"**

- Telo replies that it's on it. It found Comcast from your history, without being told.
- On the task page, "What Telo remembered" shows the live Keewano query and the October 2 promise: a $20 credit, A1832.
- The teammate's phone rings. Telo says: "On October 2, a representative confirmed a $20 service credit under confirmation A1832, but it was never applied."
- Teammate (Comcast): "You're right, it was never applied. I've applied it now. New confirmation C7714."
- Telo texts the result. The timeline shows **Promise broken** recorded to Keewano.

## 2. Judgment

Presenter texts: **"Cancel my gym membership at Equinox."**

- Telo asks for the email on the account. Reply with any email.
- Teammate (Equinox): "Before I cancel, we can do $18 a month instead of $65."
- Telo doesn't accept. It says it'll confirm with Dylan and call back, then texts: "They offered $18/month instead of cancelling. Accept, or keep cancelling?"
- Presenter replies **"keep cancelling"**. Telo calls back.
- Teammate: "Done. Ends November 8, confirmation 18392."

## 3. Ask it anything

Presenter texts: **"what's going on with everything?"**, then the judge's own question, e.g. **"how many times has a business broken a promise to me?"**

That one is answered from Keewano with live SQL. The query appears in the server log, and in the dashboard as a "Checked history" event.

## 4. Voice (if time allows)

The presenter calls Telo's number: "Hey, how's the gym thing going?" Dial's agent calls Telo's `get_status` tool and answers.

## Without live services

Every scene also runs on the simulated stack (no keys): the teammate's lines are scripted, and transcripts stream live in the dashboard.
