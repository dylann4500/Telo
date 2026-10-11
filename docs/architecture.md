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
- A text that fails to deliver and needs you (question, approval, result) is retried as a phone call.

## Authority

Each task gets an authority envelope from `understand-task`: `allowed` (routine call work plus what you asked for), `askFirst` (unexpected fees, contracts, retention offers you didn't pre-decide, anything materially different, spending over a stated limit) and `never`. The call brief (`agent/call-instructions.ts`) renders it with fixed guardrails that aren't model output:
- identify as an AI calling for you
- never share passwords, PINs, security answers, card or Social Security numbers
- never claim anything not in the brief
- defer anything in `askFirst` with "I'll confirm and call back", getting a reference number first

## Memory model

- **Task context:** facts in `tasks.facts`, each tagged with where it came from (`user`, `call`, `memory`, `profile`) and whether it's sensitive. Sensitive values are masked in the dashboard and in events, and redacted when the task ends. Passwords and PINs are never stored: a message containing one is masked and you get a warning.
- **Preferences:** `users.preferences`, saved only when you state a lasting preference.
- **Interaction history:** the `events` table, which is both the local timeline and the Keewano outbox.

### Event taxonomy

`task.created`, `task.info_requested`, `task.info_received`, `task.plan_generated`, `memory.retrieved`, `call.started`, `call.connected`, `call.completed`, `call.failed`, `call.transcript_processed`, `business.fact_discovered`, `offer.received`, `offer.accepted`, `offer.declined`, `commitment.received`, `commitment.fulfilled`, `commitment.broken`, `confirmation.received`, `approval.requested`, `approval.granted`, `approval.denied`, `followup.required`, `task.completed`, `task.failed`, `task.cancelled`, `message.sent`, `preference.saved`.

### Keewano mapping

Only events with a `typed` slice reach Keewano. `memory/keewano.ts` holds the catalog (custom event ids 2000+, append-only; the hash changes with the list).

- **Entities** (UUID v5 under a secret namespace):
  - `rel:<user>:<business>`: the main memory
  - `org:<business>`: cross-user business behaviour; never carries confirmation codes
  - `task:<id>`
  - `user:<id>`
- **One batch per entity.** Each batch starts with `entity_kind`, then context, then the anchor, all stamped with the event's second. For example, a promise becomes `confirmation_number("A1832")`, `commitment_amount_cents(2000)`, `commitment_received("account_credit")`.
- **Idempotency:** `dataSessionId = uuidv5(eventId | entity)` with `batch: 1`, so a retry can't double-count.
- **Spacing:** events from one call are recorded one second apart, so context columns can't collide.
- **Reads:** for one entity, one `SELECT event_datetime, <column> FROM events WHERE user_id = '<uuid>'` per column over the Postgres wire protocol. Rows are regrouped by second into events, then merged with the last 15 minutes of Telo's own writes, which Keewano can't show yet.
- **Questions nobody prepared for:** `memory/keewano-ask.ts` has Claude write one read-only SELECT over the catalog columns. The statement is checked (SELECT only, no semicolons or write keywords), run, and the rows are answered from. The SQL is logged as a `memory.retrieved` event.

## Providers

`getLLM()`, `getVoice()` and `getMemory()` choose the live or simulated implementation from the environment. All three simulations go through the same pipeline as the real services, so tests and offline demos exercise the production code paths.
