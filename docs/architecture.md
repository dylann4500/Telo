# How Telo works

Developer notes for the pieces that aren't obvious from the code. Start with the README for the overview.

## Task lifecycle

| State | Means | Leaves by |
|---|---|---|
| `new` | Request received, not yet understood | `understand`: → `needs_info` (something only you know is missing) or `planning` |
| `needs_info` | Waiting for your answer | Your reply (`provide_info`) → back to `new`, re-understood with the new facts |
| `planning` | Querying memory, writing the call plan | `plan` → `ready` (one `calls` row per leg, status `planned`) |
| `ready` | A planned call is next | `dial`: claims the task (→ `calling`), then claims the call row (`planned` → `queued`) and places it |
| `calling` | A call is live | The call finishing (`finishedAt` set once, after the transcript) → `reviewing` when no other leg is live |
| `reviewing` | Reading calls, deciding | `review` → `completed`, `failed`, `needs_approval`, `ready` (next leg or retry), `planning` (callback) |
| `needs_approval` | A decision only you can make | Your decision → `reviewing` with `followUp.userDecision` set |

The legal moves are in `src/server/domain/state-machine.ts`. Every transition is `UPDATE … WHERE status IN (allowed sources)` with a version bump (`tasks/repo.ts`), so whoever loses a race gets `null` and backs off. Within one process, `advance()` also serializes steps per task.

**Why the call can't be placed twice:** the task must win `ready → calling`, then the call row must win `planned → queued`, and Dial's `makeCall` gets `Idempotency-Key: telo:<callId>`. A step that throws is retried by the background loop with backoff. After three failures the task fails, and you're told.

## Work orders (property management)

A maintenance task carries `tasks.context` (`kind: "maintenance"`): its unit, property, owner, tenancy and asset ids, the triage result, the vendors in ranked order, and a `stage` that runs `triage → dispatching → booked → checking → closed`. `maintenance.ts` owns the steps that differ from a plain call task; the orchestrator calls into it:

| Orchestrator step | For a work order |
|---|---|
| `understand` | `triage`: Claude's `triage-maintenance`, the emergency script, `wo.opened`, then Keewano ranks vendors and reads the asset's repairs (`portfolio/insights.ts`). Targets are the top two vendors; the authority envelope comes from the owner's approval limit. |
| `plan` | Same planner; the legs always run in parallel. |
| `ask_customer` (mid-call) | A decision goes to the owner by text (`question.context.party`), not the manager; `approval.requested` and `approval.granted` carry the response time, channel and `approval_while_holding`. |
| `review` | `afterCalls`: `quote.received` per vendor, then the next step from this round's calls. The newest booking within the limit (or approved by the owner) is booked. A vendor who asked to be called back ("try us in three days") is called then, and again each time they ask. When nobody picks up, the next vendor in Keewano's ranking is called now, or the same one is retried later. An urgent job doesn't wait more than a day on a callback while another vendor is untried. Otherwise the manager gets the comparison. |
| `wakeTask` | `wake`: "on the way?" to the vendor and "fixed?" to the tenant (stage `checking`). The tenant's "Y" runs `closeWorkOrder`: vendor outcome, promise kept, access, asset repaired, `wo.completed` with manager touches. "Nobody came" runs `vendorNoShow`: a `no_show` outcome and a broken arrival promise on the vendor's stream, then the next vendor is called. A booking that falls through is `voided`, so it's never booked from again. |

**Routing by phone number** (`portfolio/index.ts` `partyByPhone`): the manager's number is the user, as before. A tenant's text or call opens or updates their work order, an owner's text answers their open question (or is forwarded to the manager), and a vendor's text is forwarded. Messages to and from them are stored in the manager's thread with `messages.party`, which the dashboard labels.

Booking, follow-up and close events are keyed by the booked call, so a second booking on the same work order (after a no-show, or a repair that didn't hold) gets its own events. An email never settles a work order; the tenant's "fixed?" does.

**Phones:** the seeded portfolio's numbers are fictional (555-01xx); `TELO_PORTFOLIO_PHONES` maps party ids to real phones for a live demo, and Telo never texts a fictional number on a real line.

## Webhooks and events

- `POST /api/webhooks/dial` verifies `X-Dial-Signature` (HMAC-SHA256 over `${t}.${rawBody}`, 5-minute tolerance), stores the envelope in `webhook_receipts` keyed by `dial:<X-Dial-Event-ID>` (a redelivery is a no-op), returns 200, and processes in `after()`. Failed processing is retried by the background loop (up to 5 times).
- Dial events are normalized to provider-neutral `VoiceEvent`s (`voice/dial-webhook.ts`). The simulated line emits the same events, so `voice/ingest.ts` is the single place where calls change state.
- Call statuses only move forward. Inbound calls create their call row on first sight. An outbound status that beats our own write of the provider id waits briefly for it.
- `finishCall` claims a call once (`finishedAt IS NULL`) and hands it to the orchestrator (business calls) or the concierge (calls with you).
- Missed webhooks: the loop polls Dial for calls that have gone quiet, and finishes calls whose transcript never arrived.

## Talking to you

- `concierge.handleUserInput` is the single entry point for texts, dashboard messages, live voice-tool requests and call transcripts. One structured Claude call (`route-inbound`) turns the input into actions.
- `notify` stores every outbound message (the dashboard thread) and delivers it. Replies go back on the channel you used; proactive updates go to the task's channel, otherwise `TELO_USER_CHANNEL`. A dedupe key per milestone (`ack:<task>`, `q:<question>`, `done:<task>:<status>`) means a retried step never texts twice.
- **Live calls with you:** Dial's agent calls `ask_telo` on `/api/mcp` with what you said. The concierge runs inside an `AsyncLocalStorage` capture, so messages are returned for the agent to say instead of being texted. After 25 seconds the capture closes and anything later goes out as a normal update.
- **Text, or text and call** (`users.callUpdates`, the toggle in the thread header): with calls on, anything that needs you, reports a call, or finishes a task is texted and also rung through, in waking hours (any time a business is waiting on the line, or late if you've been talking to Telo). A text that fails is only marked failed.

## During a call

Dial's agent can call Telo's tools mid-call (`live-call.ts`, behind `/api/mcp`). Dial sends no call id, so each request is matched to a live call by the other party's number and the direction: the owner gets `get_status` and `ask_telo`; a business Telo called gets `report_progress`, `ask_customer`, `wait_for_customer` and `check_calendar`.

- `ask_customer` texts you (and rings you, with calls on) while the business holds; it refuses secrets and lines meant for the person on the phone. The question is stored with `context.live`.
- `wait_for_customer` waits up to 15 s per call and tells the agent what to say meanwhile, so the line is never silent; after 90 s it tells the agent to wrap up and call back.
- Your answer (a text, the dashboard's live card, or Telo's call) lands in the task's facts or `followUp` while the task stays `calling`; the waiting tool picks it up. A question still open when the call ends lapses, and the review asks the usual way.
- `check_calendar` answers free or busy for the offered time, with free windows nearby, never what your events are.
- The call lab (`npm run lab:calls`) plays these calls with Claude as Dial's agent; that's how the prompt and tool wording were tuned.

## Authority

Each task gets an authority envelope from `understand-task`: `allowed` (routine call work plus what you asked for), `askFirst` (unexpected fees, contracts, retention offers you didn't pre-decide, anything materially different, spending over a stated limit) and `never`. The call brief (`agent/call-instructions.ts`) renders it with fixed guardrails that aren't model output:
- identify as an AI calling for you
- never share passwords, PINs, security answers, card or Social Security numbers
- never claim anything not in the brief
- ask you about anything in `askFirst` while they wait (`ask_customer`); if you don't answer in time, defer with "I'll confirm and call back", getting a reference number first

## Memory model

- **Task context:** facts in `tasks.facts`, each tagged with where it came from (`user`, `call`, `memory`, `profile`) and whether it's sensitive. Sensitive values are masked in the dashboard and in events, and redacted when the task ends. Passwords and PINs are never stored: a message containing one is masked and you get a warning.
- **Preferences:** `users.preferences`, saved only when you state a lasting preference.
- **Interaction history:** the `events` table, which is both the local timeline and the Keewano outbox.

### Event taxonomy

`task.created`, `task.info_requested`, `task.info_received`, `task.plan_generated`, `memory.retrieved`, `call.started`, `call.connected`, `call.completed`, `call.failed`, `call.transcript_processed`, `business.fact_discovered`, `offer.received`, `offer.accepted`, `offer.declined`, `commitment.received`, `commitment.fulfilled`, `commitment.broken`, `confirmation.received`, `approval.requested`, `approval.granted`, `approval.denied`, `followup.required`, `task.completed`, `task.failed`, `task.cancelled`, `message.sent`, `preference.saved`, `email.received`, `calendar.event_created`, and the local-only `call.asked_user` and `calendar.checked`. The task page's "How Telo handled it" (`flow.ts`) folds these into one row per step.

Work orders add `wo.opened`, `wo.deflected`, `emergency.routed`, `quote.received`, `vendor.declined`, `vendor.booked`, `entry_notice.sent`, `access.outcome`, `vendor.outcome`, `wo.completed`, `callback.opened`, `asset.registered`, `asset.repaired` and `asset.decision` (research.md section 5.3), and reuse approvals, commitments and calls with extra context.

### Keewano mapping

Only events with a `typed` slice reach Keewano. `memory/keewano.ts` holds the catalog (custom event ids 2000+, append-only; the hash changes with the list).

- **Entities** (UUID v5 under a secret namespace):
  - `rel:<user>:<business>`: the main memory
  - `org:<business>`: cross-user business behaviour; never carries confirmation codes
  - `task:<id>`
  - `user:<id>`
- **Portfolio entities:** `pm`, `owner`, `property`, `unit`, `asset`, `vendor`, `tenancy`, `prospect`, `agency`. An event with `refs` (ids, never names) goes to the streams `PM_STREAMS` lists for its type; one without refs keeps the consumer routing above. Calls go to the party's stream by `call_party`; a promise to pay goes to the tenancy.
- **One batch per entity.** Each batch starts with `entity_kind`, then context, then the anchor, all stamped with the event's second. For example, a promise becomes `confirmation_number("A1832")`, `commitment_amount_cents(2000)`, `commitment_received("account_credit")`.
- **Idempotency:** `dataSessionId = uuidv5(eventId | entity)` with `batch: 1`, so a retry can't double-count.
- **Spacing:** events from one call are recorded one second apart, so context columns can't collide.
- **Reads:** for one entity, one `SELECT event_datetime, <column> FROM events WHERE user_id = '<uuid>'` per column over the Postgres wire protocol. Rows are regrouped by second into events, then merged with the last 60 minutes of Telo's own writes (`KEEWANO_CACHE_MINUTES`), which Keewano can't show yet.
- **Decisions:** vendor ranking runs four aggregate queries at once (visits and jobs, no-shows, late arrivals, first-visit fixes) with the condition in `WHERE`, because Keewano rejects `count(...) FILTER (WHERE ...)`. The asset's repairs are one `SELECT event_datetime, repair_cents` on its stream. Both fall back to the local events when Keewano can't answer, and say so in the trace.
- **Questions nobody prepared for:** `memory/keewano-ask.ts` has Claude write one read-only SELECT over the catalog columns. The statement is checked (SELECT only, no semicolons or write keywords), run, and the rows are answered from. The SQL is logged as a `memory.retrieved` event.

## Providers

`getLLM()`, `getVoice()` and `getMemory()` choose the live or simulated implementation from the environment. All three simulations go through the same pipeline as the real services, so tests and offline demos exercise the production code paths.
