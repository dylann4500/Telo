# Dial (getdial.ai) integration reference for Telo

Researched 2026-10-10 against: `@getdial/sdk@0.41.1` (published 2026-10-07), `@getdial/chat-sdk-adapter@0.2.0`, the OpenAPI 3.1 spec at `https://docs.getdial.ai/openapi.json`, every page listed in `https://docs.getdial.ai/llms.txt` (fetched as `.md`), the pricing page, and the `GetDial-AI/playbooks` repo. Nothing was signed up for and no package code was executed.

Labels:
- **VERIFIED**: seen in official docs, the OpenAPI spec, or the published SDK source and type definitions. Source keys like `[S3]` and `[P2]` are listed at the end.
- **INFERRED**: my reading or a design suggestion that no official source states outright.

Local mirrors, for re-checking without the network:
- SDK source: `/private/tmp/claude-501/-Users-dylan-Documents-GitHub-math-hw-grift/be69224c-03b1-403e-8990-9913a903bdd1/scratchpad/pkgs/sdk/extracted/package/`
- Chat adapter: `.../scratchpad/pkgs/adapter/extracted/package/`
- Every docs page as Markdown: `.../scratchpad/docs/pages/`
- OpenAPI spec: `.../scratchpad/docs/docs.getdial.ai_openapi.json`

---

## 0. TL;DR for Telo

| Need | Dial answer | Status |
|---|---|---|
| Outbound AI call with per-call context | `dial.makeCall({ to, fromNumberId, outboundInstruction, language?, voiceGender?, transferTo?, maxCallDurationSeconds?, idempotencyKey? })` → `POST /api/v1/calls`. The only per-call context is the system prompt. There is no metadata or custom-data field. | VERIFIED [P1][P2][S2][S6] |
| Transcript and outcome | `call.ended` webhook gives the terminal `status`. `call.transcribed` follows, then `dial.getCall(id)` returns `transcript` (flat string) and `transcriptTurns[]` (`speaker` `agent`/`user`/`transfer_target`, `text`, `startMs`, `endMs`). There is no built-in summary, structured extraction, or voicemail flag. | VERIFIED [S4][S6] |
| Inbound calls to our number | Answered automatically by the managed AI using the number's `inboundInstruction`, which is snapshotted when the call is answered. There is no per-call hook that lets us inject context at call start. | VERIFIED [S7][S6] |
| Mid-call tools on our server | **Context MCP**: register an HTTPS MCP server. Its tools become callable by the managed agent on every account call. Dial adds `X-Dial-Direction`, `X-Dial-User-Number` and `X-Dial-Agent-Number` headers, but **no call id**. | VERIFIED [S11] |
| Messaging | One endpoint, `sendMessage` → `POST /api/v1/messages`. Channels: `sms` (standard number), `imessage` with automatic RCS/SMS fallback (iMessage number), `whatsapp` (beta, on iMessage lines only). | VERIFIED [S9][P2] |
| Webhooks | One account-level subscription: `POST /api/v1/webhooks {targetUrl, eventTypes:["*"]}`. Headers: `X-Dial-Signature: t=<unix>,v1=<hex>`, `X-Dial-Event-ID`, `X-Dial-Event-Type`. Signature is HMAC-SHA256(secret, `${t}.${rawBody}`), allow 5 minutes. At-least-once delivery, up to 6 attempts, 10 s timeout per attempt. SDK helper: `verifyDialSignature(secret, header, rawBody)`. | VERIFIED [S3][P3][P6] |
| Live dashboard | `call.status_changed` events (Queued → Ringing → In-Progress → Terminated) via webhook, the SDK stream (`newEventsConnection`, built on PubNub), or REST long-poll. Managed calls have **no live transcript partials**. | VERIFIED [S4][S15] |

### Hackathon blockers, in order of severity

1. **Outbound SMS to US phones from a standard number is blocked by carriers until the number passes 10DLC registration.** Registration costs $25 per number, one time, and approval usually takes 3–5 business days. Inbound SMS and voice in both directions are unaffected. VERIFIED [S8][S2 `PhoneNumberTenDlc`][S4 message-status-changed example]. The workarounds:
   - **iMessage number:** 10DLC never applies and messages are free, but the number costs **$250/month**, PAYG only, with the first month charged up front. VERIFIED [S19][S2].
   - **WhatsApp:** beta, enabled per account, and only rides on an iMessage line. VERIFIED [S23].
   - **Recipients outside the US:** not blocked; priced by tier. VERIFIED [S8].
   - **Voice-only fallback:** the agent calls the user for approvals and status. INFERRED.
   - **Ask Dial staff** for an event coupon or a pre-approved number. The coupon mechanism exists. VERIFIED [S1].
2. **Free-account limits.** Until the first top-up, every call is hard-capped at **5 minutes** and at most **2 calls** can be live at once, inbound and outbound combined. An explicit `maxCallDurationSeconds` above 300 returns `400`. Gym-cancellation hold queues will be cut off. Any top-up lifts both limits permanently, but the $5 signup credit does not count. VERIFIED [S16][S17][S20].
3. **The webhook `targetUrl` must be public HTTPS**, not loopback or a private address. Local development needs a tunnel or a deploy. VERIFIED [S3].
4. **Self-Hosted mode needs human approval and applies to the whole account**, inbound and outbound together. It switches off Context MCP and the agent's built-in tools, and DTMF is unavailable in it. Not recommended for the hackathon. VERIFIED [S12][S5].
5. **Next.js bundling risk.** At module load, the SDK does `readFileSync(join(__dirname, "..", "package.json"))` (CommonJS build). Add `serverExternalPackages: ["@getdial/sdk"]` to `next.config.ts`. The code is VERIFIED [P1 dist/client.js]; the breakage under Turbopack is INFERRED. See section 9.

---

## A. Auth and client setup

- Every request authenticates with a `sk_live_…` API key sent as `Authorization: Bearer sk_live_...`. A missing or invalid key returns `401`. There are no test keys and no API sandbox. VERIFIED [S1][S2]. The absence of a sandbox is INFERRED; see section H.
- **Base URL.** The OpenAPI `servers` entry is `https://api.getdial.ai`, and all paths start with `/api/v1/...`. The SDK uses `DEFAULT_BASE_URL = "https://api.getdial.ai"` plus `/api/v1/...`. VERIFIED [S2][P1].
  - Some doc pages show `https://api.getdial.ai/v1/...`, and the site's llms.txt says the base is `https://api.getdial.ai/v1`. That is probably an alias. Use `/api/v1` as the SDK and spec do. INFERRED.
  - Older SDK and CLI versions defaulted to `https://getdial.ai`, which serves the same API. VERIFIED [S1].
- **SDK constructor:** `new DialClient({ apiKey: string; baseUrl?: string; userAgent?: string })`. `userAgent` is prepended to `@getdial/sdk/<version>`. VERIFIED [P2 `DialConfig`][P1].
- **Environment variable conventions** are used by the adapter and CLI, not read by the core SDK: `DIAL_API_KEY`, `DIAL_FROM_NUMBER_ID`, `DIAL_WEBHOOK_SECRET`, `DIAL_API_URL`. VERIFIED [P6][S24]. The core SDK does not read the environment; you pass `apiKey` yourself. VERIFIED [P1].
- **Getting a key.** The CLI flow is `dial auth login <email>` → `dial auth verify-otp --code` → `dial auth register-number <your mobile>` → `dial auth verify-otp --number --code`. The last step prints the key once and saves it to `~/.local/share/dial/auth.json`. VERIFIED [S1][S20].
  - A new account needs a verified email **and** a verified phone number.
  - One phone number can create only one Dial account, ever. VERIFIED [S18 Aug 9].
  - Signups can be paused; an event coupon (`--coupon <code>`) bypasses the pause. VERIFIED [S1].
  - The key can also be minted in the dashboard. VERIFIED [S24].
  - Signup creates the account's first number. VERIFIED [S20][quickstart].
- **SDK runtime facts:**
  - CommonJS build; depends on `pubnub ^11` and `zod ^4`; uses `node:crypto` and `node:fs`. Run it on the Node runtime, which is Next 16's default. VERIFIED [P1 package.json, tsconfig].
  - Every method makes a **single attempt** with no retries. On a non-2xx response it throws `Error("Dial API error <status>: <JSON body>")`, so you must parse the message to branch on `status` or `code`. VERIFIED [P1][S16].
  - Error bodies look like `{ "error": string | {fieldErrors…}, "code"?: "call_limit_reached" | "calling_disabled" | "unsupported_region" | "insufficient_credit" | "rate_limited" | "idempotency_conflict" | … }`. VERIFIED [S16][S6].

## B. Numbers

**SDK methods.** All VERIFIED [P1]:
- `listNumbers()` → `GET /api/v1/numbers` → `PhoneNumber[]`
- `purchaseNumber(params)` → `POST /api/v1/numbers`
- `setNumberProperties(numberId, params)` → `PATCH /api/v1/numbers/{id}`
- `setInboundInstruction` is deprecated and wraps `setNumberProperties`.

**REST-only endpoints** with no SDK method. VERIFIED [S2]:
- `GET /api/v1/numbers/{id}`
- `DELETE /api/v1/numbers/{id}` (release the number)
- `GET`/`POST /api/v1/numbers/{id}/10dlc`
- `GET /api/v1/10dlc/brands`
- `POST /api/v1/numbers/{id}/whatsapp`

**Provisioning:**
- `purchaseNumber` takes `inboundInstruction` (required in the SDK type, optional over REST), `explicitProgrammaticConsent` (**required**: a human-readable consent attestation, otherwise `400`), `inboundVoiceGender?`, `inboundLanguage?`, `areaCode?`, `includeImessage?` and `callingEnabled?`. VERIFIED [P2][S2].
- Only US numbers can be provisioned. Provisioning is not idempotent. VERIFIED [S2][S8].
- PAYG is charged the first ownership month immediately; `402` if the balance can't cover it. VERIFIED [S2].

**Capabilities** (`capabilities`): `["sms","call"]` for a standard number, or `["sms","call","imessage"]` for an iMessage number. `"whatsapp"` is added only once a WhatsApp registration is `ready`. RCS is not a provisionable capability: it is the automatic fallback rail on iMessage numbers, and it can appear as the inbound `channel`. VERIFIED [P2][S2][S9].

**iMessage numbers:**
- PAYG only; `403` on a subscription account. VERIFIED [S8][S2].
- **$250/month.** VERIFIED [S19].
- Setup is asynchronous. The REST call returns `202` with `setupStatus: "provisioning"`. `sms` and `imessage` settle immediately; `call` takes a few minutes while caller ID is verified. Wait for the `number.status_changed` event. VERIFIED [S2][S4 number-status-changed][S20].

**Inbound instruction.** This is the system prompt the AI uses on calls *into* the number.
- Set it at purchase, or later with `setNumberProperties(id, { inboundInstruction })`.
- Changes apply to the next inbound call; calls in progress are unaffected.
- The call record keeps a snapshot taken when the call was answered (`call.instruction`). VERIFIED [S8][S2][S6].

**Other per-number settings** (all `PATCH`). VERIFIED [P2][S8]:
- `inboundLanguage` (BCP-47; `null` means auto-detect from the caller's country prefix plus en-US)
- `inboundVoiceGender` (`male`/`female`/`null`)
- `nickname` (at most 100 characters)
- `maxCallDurationSeconds` (cap for inbound and outbound on this number)
- `callingEnabled` (`false` stops voice both ways; messaging continues)
- `forwardTo` (E.164, rings that phone instead of the AI; `null` turns it off)
- Display identity: `channel` + `name` + `avatar`, or `firstName`/`lastName`/`whatsappName`/`whatsappAvatar`

**Per-number webhook configuration: none.** Webhook subscriptions are account-level and have no number field. Filter in your handler on `data.phoneNumberId` (call and message status events) or on `data.to` / `data.from`. VERIFIED [S2 `CreateWebhookRequest`, `WebhookSubscription`].

**`PhoneNumber` fields** (from the SDK type):
- `id`, `number`, `nickname`, `country`, `capabilities`, `whatsapp?`
- `setupStatus` (`provisioning`/`ready`/`failed`), `setupError`
- `callingEnabled`, `forwardTo`
- `inboundInstruction`, `inboundVoiceGender`, `inboundLanguage`, `maxCallDurationSeconds`
- `firstName`, `lastName`, `avatarUrl`, `whatsappName`, `whatsappAvatarUrl`
- `replaces?`, `replacedBy?`, `replacedAt?`
- `accountId`, `createdAt`

VERIFIED [P2]. REST also returns `tenDlc: { status: not_registered|in_review|with_carrier|approved|rejected, kind, submittedAt, reviewedAt, reason } | null`, which is **not in the SDK type**. VERIFIED [S2].

**Can a number place a call right now?** Only when `capabilities` includes `"call"`, `setupStatus === "ready"`, **and** `callingEnabled === true`. VERIFIED [P2][S8].

## C. Outbound calls

**Create.** `makeCall(params: MakeCallParams): Promise<Call>` sends `POST /api/v1/calls`. VERIFIED [P1][P2][S2][S6].

| Param | Notes |
|---|---|
| `to` (required) | E.164. |
| `outboundInstruction` (required) | The system prompt for this call. This is the **only** per-call context channel. |
| `fromNumber` or `fromNumberId` (exactly one) | `fromNumber` accepts an id, one of your E.164 numbers, or a nickname. Both or neither returns `400`. |
| `language?` | BCP-47. If omitted, the language is detected from the destination's country prefix and the agent also handles en-US. |
| `voiceGender?` | `male`/`female`; default female. |
| `transferTo?` | E.164. The agent rides out hold music and IVR, then **cold-transfers** once a real human answers. Must differ from `to` and from the from-number. Stamps `transferredAt`. |
| `maxCallDurationSeconds?` | Must be 60–3600, or `400`. Per-call beats number, which beats account. Free accounts are capped at 300 (an explicit higher value returns `400`). About 40 s before the cap, Dial tells the agent to wrap up. |
| `idempotencyKey?` | Sent as the `Idempotency-Key` header (max 255 characters, account-scoped). A replay returns the original call with `200` instead of `201`. If the original is still processing, the replay waits, then returns `409 idempotency_conflict`. A non-2xx response guarantees no live call. |

- **Not available:** first message, specific voice or model, custom metadata/variables, webhook-per-call, recording flags, or answering-machine options. The request schema has exactly the 8 body fields above plus the header. VERIFIED [S2].
- **Errors.** VERIFIED [S6][S5][S16]:
  - `402 insufficient_credit`
  - `403 unsupported_region` (some numbers can only call US numbers)
  - `409 calling_disabled`
  - `429 call_limit_reached`: free-account concurrency, or "some numbers carry one call at a time"
  - `400`: an iMessage number still provisioning
- **General context.** Dial prepends a small "general context" to every prompt: the current date and time on the other side of the call (from that number's country) and the agent's voice gender. Your instruction takes precedence. VERIFIED [S7 how-it-works][S13 call_connected example].

**The `Call` object.** All VERIFIED [P2][S2]:
- `id`, `phoneNumberId`, `from`, `to`, `direction` (`inbound`/`outbound`)
- `duration` (seconds)
- `transcript: string | null`
- `transcriptTurns: TranscriptTurn[] | null`. Published as all turns or none; `null` if any turn could not be timed.
- `instruction` (the prompt the call actually ran with)
- `queuedAt`, `startedRingingAt`, `callStartedAt`, `cancelRequestedAt`, `terminatedAt`. These are in the SDK type but not the OpenAPI `Call`.
- `terminationType`
- `failureReason`. Today only `self_hosted_*` values.
- `transferTo`, `transferredAt`
- `status: { state, terminationType, cancelRequested, cancelPending, label }`
- `createdAt`
- `voiceRuntime: "managed" | "self-hosted-audio"`. REST only, not in the SDK type.

**Status lifecycle.** VERIFIED [S6][S4]:
- `state`: `Queued` → `Ringing` → `In-Progress` → `Terminated`, plus `Unknown` (rare). It only moves forward, but states can be skipped. A failed outbound call can jump from `Queued` straight to `Terminated`, and some inbound calls are first seen at `In-Progress`.
- `terminationType` (set only when `Terminated`): `completed`, `busy`, `no-answer`, `failed`, `canceled`.
- `label` is for display, for example `Completed (Cancelled)`. Use `state` and `terminationType` for logic.

**Get and list.** VERIFIED [P1][S2][S17]:
- `getCall(callId)` → `GET /api/v1/calls/{id}`
- `listCalls({ numberId?, contact?, direction?, since? })` → `GET /api/v1/calls`. Newest first, at most 100.
- There is no pagination cursor for calls.

**Hang up or cancel.** `stopCall(callId)` → `POST /api/v1/calls/{id}/stop`. VERIFIED [P1][S2]:
- `Queued`/`Ringing`: canceled, not charged, ends as `terminationType: "canceled"`.
- `In-Progress`: hung up, ends `completed` with label `Completed (Cancelled)`.
- The response comes back immediately with `cancelPending: true`; wait for `call.ended` (which carries `canceled: true`).
- Stopping a call that has already ended returns `400`.
- Requesting a stop emits no event of its own.

**Transcript.** VERIFIED [S6][S4 call-transcribed]:
- `TranscriptTurn = { speaker: "agent" | "user" | "transfer_target"; text: string; startMs: number; endMs: number }`. Offsets are approximate and measured in audio time.
- The `transcript` is ready a few seconds after `call.ended`, signalled by `call.transcribed`, which is a thin event carrying only `callId`.
- `call.transcribed` is never sent for canceled, no-answer, or failed calls.
- The format of the flat `transcript` string (whether it has speaker labels) is **undocumented**, so parse `transcriptTurns` instead. INFERRED.
- Pressed DTMF digits never appear in the transcript. VERIFIED [S5].

**Recordings.** There is no recording field or endpoint in the API. VERIFIED [S2: absent from `Call`]. The Self-Hosted page says audio-mode calls produce "no transcripts, recordings, and call summaries", which suggests managed calls have recordings and summaries somewhere, probably only in the dashboard. INFERRED; listed as an open question.

**Built-in summary or structured extraction:** none in the API. VERIFIED (absent from spec). Do it yourself with your own LLM over `transcriptTurns`, or have the agent call an MCP `record_outcome` tool during the call. INFERRED.

**Voicemail detection:** not documented anywhere. No flag, event, or termination type. VERIFIED absent [S2][S4]; Dial's own voicemail blog post only discusses the industry. A call that reaches voicemail will most likely end `completed`, so classify it from the transcript, and tell the agent in the prompt what to do on voicemail. INFERRED.

**IVR and DTMF.** The managed agent presses keypad digits by itself. Nothing needs enabling: tell it the *goal*, for example "choose billing", rather than which key. Managed agent only; neither self-hosted protocol can send digits. VERIFIED [S5].

**Hold handling.** Documented for `transferTo` only: the agent "rides out hold music and IVR menus" until a human answers, then transfers. VERIFIED [S5][S6]. Without `transferTo`, the docs don't say how long the agent waits on hold or whether it stays quiet. INFERRED, open question. In practice the duration cap (5 minutes on free accounts) is what ends long holds.

**Telo feature for free:** "wait on hold for me and patch me in when a human answers" is simply `makeCall({ ..., transferTo: user.phone })`. The handoff appears as `transferredAt`, and the transferred human's speech is tagged `transfer_target`. VERIFIED [S5][S6].

## D. Live status and streaming

**Event catalog.** The same JSON envelope is used on every surface. VERIFIED [S4]:
- `message.received`
- `message.status_changed`
- `call.status_changed`
- `call.ended`
- `call.transcribed`
- `number.status_changed`
- `webhook.ping` (webhook only)

**Delivery surfaces.** VERIFIED [S15][S4][P5][S17][S3]:
1. **SDK stream.** `const conn = await dial.newEventsConnection(); for await (const e of conn) {...}; await conn.close()`.
   - Internally it calls `POST /api/v1/listen/subscribe`, which returns `{subscribeKey, channel, token, ttlSeconds}`, then subscribes to PubNub channel `account-<accountId>`. The token is re-minted at 80% of its TTL.
   - It is **presence-based**: events are replayed only if you reconnect within about 2 minutes. Not durable.
   - It needs a long-lived process, so it does not fit serverless route handlers.
2. **REST long-poll.** `POST /api/v1/events/wait {eventType, filters?, regexFilters?, timeout: 1–60}` returns `{event}` or `408`.
3. **Webhooks.** At-least-once delivery (section E). This is the right choice for a deployed Next.js app.

**`call.status_changed`.** One event per state the call actually enters, at most 4 per call, and the last is always `Terminated`. VERIFIED [S4]. `data` contains:
- `callId`, `direction`, `from`, `to`, `phoneNumberId`
- `status: { state, label }`
- `previousState`
- `terminationType` (when `Terminated`)
- `failureReason`

**Live transcript partials for managed calls: none.** No event carries partial transcripts, and the transcript appears only after the call. VERIFIED (absent from the event catalog [S4]). The marketing phrase "real-time transcription" is not exposed as an API. Live transcripts exist only in Self-Hosted LLM mode, as `transcript_update` frames over our own WebSocket. VERIFIED [S13].

**Richer live status is DIY.**
- Instruct the agent to call an MCP tool such as `report_progress(stage)` at milestones ("in IVR", "on hold", "talking to rep", "got confirmation #"). INFERRED; it depends on the agent following instructions.
- Push those updates to the dashboard yourself, through the DB and then SSE or polling.

## E. Webhooks

**Registration.** VERIFIED [S3][S2]:
- Dashboard: `https://getdial.ai/dashboard/webhooks`
- API: `POST /api/v1/webhooks { targetUrl, eventTypes }`
  - `targetUrl` must be HTTPS and must not point at a private, loopback, or link-local host.
  - `eventTypes` is `["*"]` or an explicit list.
- Related endpoints:
  - `GET /api/v1/webhooks` → `{ webhooks: WebhookSubscription[] }`
  - `GET /api/v1/webhooks/{id}`
  - `DELETE /api/v1/webhooks/{id}`
  - `GET /api/v1/webhooks/{id}/secret` → `{ secret }`
  - `POST /api/v1/webhooks/{id}/ping` → `202 { eventId }`
- `WebhookSubscription = { id, targetUrl, eventTypes, secretMasked, lastPingSucceededAt, createdAt }`.
- The secret has a `whsec_` prefix. The docs say the full secret appears in the create response "once", but the schema shows only `secretMasked`, so read it from `/secret` to be safe. INFERRED.
- The SDK has **no webhook methods**; use `fetch`. VERIFIED [P1].
- **Use `["*"]`.** The OpenAPI enum for explicit types lists only `message.received`, `call.status_changed`, `call.ended` and `call.transcribed`. The docs say `message.status_changed` and `number.status_changed` are also delivered by webhook, and `"*"` covers them. VERIFIED [S2][S18 Aug 20][S4 number-status-changed].

**Delivery request.** VERIFIED [S3]:
- `POST targetUrl`
- Headers: `Content-Type: application/json`, `X-Dial-Event-Type: <type>`, `X-Dial-Event-ID: <stable id>`, `X-Dial-Signature: t=<unix-seconds>,v1=<hex>`
- The body is the event envelope; its top-level `id` equals `X-Dial-Event-ID`.

**Envelope.** VERIFIED [S4]:

```json
{ "id": "evt_…", "object": "event", "type": "call.ended", "version": 1,
  "createdAt": "2026-05-28T14:35:21.108Z",
  "relatedObject": { "id": "call_…", "type": "call", "url": "/api/v1/calls/call_…" },
  "data": { /* per type */ } }
```

- `version` is per event type. Every type is `1` except `number.status_changed`, which is `2`. Branch on (`type`, `version`).
- `relatedObject.type` is `"call"`, `"message"` (url `null`, because messages have no get-by-id endpoint) or `"phone_number"`, and is `null` for `webhook.ping`.
- Ignore unknown fields.

**Payloads (`data`).** VERIFIED [S4 per-event pages]:

| Type | `data` fields |
|---|---|
| `message.received` | `messageId`, `from` (sender), `to` (our number; `null` for group messages), `groupId`, `channel` (`sms`/`imessage`/`rcs`/`whatsapp`/`unknown`), `body`, `media[] {id,url,contentType,originalUrl}`, `replyToId`, `reaction`, `source` (`external` = real carrier, `internal` = dashboard or test injection; ignore `internal`) |
| `message.status_changed` | Outbound only. `messageId`, `phoneNumberId`, `from`, `to`, `channel`, `changed` (`delivery`/`read`), `deliveryState` (`pending`/`delivered`/`undelivered`/`failed`/`unconfirmed`), `readState` (`unread`/`read`/`unsupported`), `deliveryError` (plain language). Fires at most once per axis per message; no event on send. |
| `call.status_changed` | `callId`, `direction`, `from`, `to`, `phoneNumberId`, `status {state,label}`, `previousState`, `terminationType`, `failureReason` |
| `call.ended` | `callId`, `from`, `to`, `direction`, `durationSeconds` (`null` if never connected), `status` (`completed`/`busy`/`no-answer`/`failed`/`canceled`), `canceled` (bool; `true` even when status is `completed` after a stop), `failureReason`, `transcriptAvailable`. Exactly one per call. |
| `call.transcribed` | `callId` only. Fires once, after `call.ended`, only for calls that produced a transcript. Then call `getCall`. |
| `number.status_changed` (v2) | `phoneNumberId`, `number`, `status` (`unsettled`/`ready`/`degraded`), `previousStatus`, `changed[]`, `capabilities {sms?,call?,imessage?,whatsapp?: {status, previousStatus?, error?, retryAvailableAt?}}` |
| `webhook.ping` | `{}`. Sent only when you fire it; bypasses the `eventTypes` filter. |

**Signature verification.** VERIFIED [S3][P3][P6]:
- Header format: `X-Dial-Signature: t=<unix_seconds>,v1=<lowercase hex>`.
- `expected = HMAC_SHA256(key = webhook secret string exactly as issued, "whsec_…" included, message = `${t}.${rawBody}`)`, hex digest. Compare in constant time.
  - The secret is used verbatim: the official adapter passes `DIAL_WEBHOOK_SECRET` straight to `createHmac`, and it is not base64-decoded. VERIFIED [P6].
- Reject when `|now - t| > 300 s`. The docs, adapter and SDK default all use 5 minutes.
- `rawBody` must be the exact bytes received, never a re-serialized object.
- SDK helper: `verifyDialSignature(secret: string, header: string, data: string, opts?: { now?: number; toleranceSeconds?: number }): boolean`.
  - It is documented for both the webhook raw body and the self-hosted `call_id`.
  - It never throws; it returns `false` on a malformed header, a stale or future timestamp, or a mismatch.
  - It requires `v1` to match `/^[0-9a-f]+$/`.
  - VERIFIED [P3 src/self-hosted.ts lines 118–148].
- Dial does not document whether the timestamp is re-signed on each retry. It must be, because retries go past 5 minutes. INFERRED, open question.
- Dial does not document secret rotation or multiple `v1` values. Open question.

**Retries.** VERIFIED [S3]:
- Any 2xx counts as success.
- A non-2xx status, connection error, or **10 s timeout** is retried with exponential backoff, up to **6 attempts** total (1 + 5 retries).
- The exact backoff schedule is not given.
- So: respond fast and do slow work after responding (Next `after()`).

**Idempotency.** Deduplicate on `X-Dial-Event-ID`, which is the same as envelope `id`. Ids are stable per event. For `message.status_changed` the id is stable per (message, axis, state), so a repeated carrier callback collapses onto one id. VERIFIED [S3][S4].

**Ordering** is not documented. Expect `call.status_changed(Terminated)` and `call.ended` at the same moment, `call.transcribed` later, and possible reordering on retries. Make handlers order-tolerant: upsert the call row by `callId`. INFERRED.

**The CLI listen daemon uses a different scheme.** Its local URL targets are signed as `HMAC-SHA256(secret, body)` in plain hex, with no `t=`, and retried only once. Irrelevant if you use real webhooks, but don't mix the two verifiers. VERIFIED [S25].

## F. Messaging

**Send.** `sendMessage(params: SendMessageParams): Promise<Message>` → `POST /api/v1/messages`. VERIFIED [P1][P2][S9].
- Destination: exactly one of `to` (E.164) or `groupId`.
- From: exactly one of `fromNumber` (id, E.164 or nickname) or `fromNumberId`.
- `body?`
- `channel?: "sms" | "imessage" | "whatsapp"`
- `media?: (url | {path} | {data, contentType, filename?})[]`. Standard numbers: at most 10 items, 5 MB each. iMessage and WhatsApp: 1 item.
- `forceAudioFile?`
- **Not idempotent and has no key**: a retry sends a duplicate. On an ambiguous failure, check `listMessages` before resending. VERIFIED [S9][S16].
- Text limits on standard numbers: 1530 characters of plain GSM text, but **670** if any character falls outside GSM (emoji, curly quotes, em dashes). Longer bodies return `400 "Content size exceeds carrier limit."`. VERIFIED [S9].

**Reply or react.** `replyToMessage(messageId, { body } | { reaction })` → `POST /api/v1/messages/{id}/reply`. A threaded reply needs iMessage, RCS, or WhatsApp; a reply to an SMS-delivered message returns `400`, so send a new message instead. VERIFIED [P1][S18 Sep 4].

**Typing indicator.** `startTyping({ toNumber, fromNumber, channel? })`, `stopTyping(...)`, or `typing(...)` (an `await using` session). iMessage and WhatsApp only; SMS silently ignores it. VERIFIED [P1].

**History.** `listMessages({ numberId?, groupId?, contact?, direction?, since?, search? })` returns at most 100, newest first. There is no get-by-id endpoint for messages. VERIFIED [P1][S4].

**How the channel is chosen.** The number decides; `channel` matters only on a line that carries two rails. VERIFIED [S9][S23]:
- **Standard number:** SMS/MMS. `channel: "imessage"` returns `400`.
- **iMessage number:** iMessage with **automatic RCS/SMS fallback**.
  - Outbound `channel` reports `unknown`.
  - Delivery is `unconfirmed` until a read receipt arrives.
  - Messaging is billed at $0.
  - Limits: 50 *new* conversations per number per day, plus a limit on messages to a recipient who has never replied, which lifts as soon as they reply. So have the user text first. VERIFIED [S8][S17].
- **WhatsApp** (`channel: "whatsapp"`): beta and enabled per account (`404` until granted). Only on iMessage lines.
  - Sends one message at a time; a text send waits about 200–250 ms per character showing "typing…" (capped at about 30 s).
  - Rate limits apply, including 3 unanswered messages per conversation. VERIFIED [S23][S17][S18].
  - `skills.md` mentions a cheaper `["sms","whatsapp"]` line with no calls, but the OpenAPI `capabilities` enum doesn't include `whatsapp`. Conflict; open question.

**Inbound payload:** see `message.received` in section E. Inbound media `url`s are public and need no auth. VERIFIED [S4].

**Delivery status:**
- The `message.status_changed` webhook, or the `deliveryState`/`readState`/`readAt`/`deliveryError` fields on `Message`.
- The legacy `status` field means: `sent`=`pending`, `unknown`=`unconfirmed`.
- SMS never reports reads (`readState: "unsupported"`).
- VERIFIED [S10][S4].

**10DLC, the hackathon blocker.** VERIFIED [S8][S2]:
- US carriers **block** outbound SMS and MMS from an unregistered 10-digit number to US numbers. The message does not arrive, and the status event shows `deliveryState: "failed"` with an A2P/10DLC `deliveryError` (the docs example shows exactly this).
- Fix: `POST /api/v1/numbers/{id}/10dlc`, either sole proprietor or business.
- It costs **$25 per number, one time**, and the decision usually lands **3–5 business days** after filing. Sole proprietors must reply YES to a verification text within 24 hours.
- **Not affected:** inbound SMS, voice in both directions, and SMS to non-US numbers. iMessage numbers never need it.
- Subscription accounts can only send SMS to US numbers at all.
- The pricing page softens this to "register your number for high-volume US SMS". The API docs are explicit, so plan around the block.

## G. Inbound calls, dynamic context, mid-call tools, Self-Hosted

**Default behavior.** VERIFIED [S7][S2]:
- An inbound call is auto-answered by the managed agent using the number's `inboundInstruction`, snapshotted at answer time.
- Language: `inboundLanguage`, or auto-detected from the caller's country prefix.
- The call emits `call.status_changed` events, then `call.ended`, then `call.transcribed`.
- `callingEnabled: false` means the caller is never answered and no events are sent.
- `forwardTo` rings another phone instead of the AI.
- Free accounts decline an inbound call that would exceed 2 concurrent calls.

**Per-call dynamic context at call start: not supported.**
- No webhook asks us for an instruction or variables, and `inboundInstruction` has no templating. VERIFIED absent [S2][S7].
- The docs don't say whether the managed agent even knows the caller's number. The documented "general context" covers only time and voice gender. INFERRED that it does not.
- Options, best first:
  1. **Context MCP lookup (recommended).** Set an `inboundInstruction` such as "First call the `get_status` tool, then read the result to the caller…". Our MCP server identifies the caller from the `X-Dial-User-Number` header and returns that person's task status. The headers are VERIFIED [S11]; whether the agent reliably calls the tool is INFERRED.
  2. **Single-user demo hack.** On every task-state change, `setNumberProperties(id, { inboundInstruction: basePrompt + latestStatusText })`. Applies from the next call. Works for one user only and puts user data in a shared prompt. INFERRED.
  3. **Rewrite on `call.status_changed` Ringing.** Racy and not recommended: the snapshot is taken at answer, the AI answers immediately, and some inbound calls are first seen at `In-Progress`. INFERRED.
  4. **Self-Hosted LLM mode.** `call_connected` gives us `call_id`/`from`/`to`, and we generate every turn. See the caveats below.

**Mid-call tools on our server: Context MCP.** VERIFIED [S11][S2]:
- Register with `POST /api/v1/context-mcps { name, url, headers?, queryParams?, timeoutMs? }`. `url` must be HTTPS (http only for localhost in development). `timeoutMs` defaults to 120000 and is described as a "connection timeout".
- The response is `{ contextMcp: {id,name,url,authMode,status,toolCount,…}, authorizationUrl? }`.
- `authMode` is detected by probing the server:
  - `none`: wired immediately.
  - `static`: the fixed headers you supplied, such as our own bearer secret. **Use this to authenticate Dial.**
  - `oauth`: OAuth 2.1 with Dynamic Client Registration; Dial manages token refresh.
- Registration fails with `400` if the server is unreachable or returns 5xx during the probe.
- Dial fetches the tool list when the connection succeeds. The tools are then callable by the managed agent on **all of the account's calls**, inbound and outbound alike. There is no per-number or per-direction scoping.
- On every MCP request during a call, Dial adds:
  - `X-Dial-Direction: inbound|outbound`
  - `X-Dial-User-Number`: the other party (the caller on inbound, the callee on outbound)
  - `X-Dial-Agent-Number`: our Dial number
  - These may be absent or template-literal during tool discovery.
- **There is no call id header.** Correlate with (`X-Dial-Agent-Number`, `X-Dial-User-Number`, direction) → the active call in our DB. INFERRED.
- Dial explicitly warns that our server must **authorize per call** using these headers. Otherwise anyone who reaches the agent gets everything the connection's scopes allow.
- Telo uses (INFERRED design):
  - Inbound: `get_status`, keyed on the caller's number.
  - Outbound: `get_task_details`, `report_progress(stage, note)`, `record_outcome({...})`, `request_user_approval(question)`.
  - Enforce by direction on the server.
- Open questions: whether a long `request_user_approval` call (waiting on a user's reply) is acceptable mid-call, and what the business hears meanwhile. A safer flow: the agent says "I'll confirm with the customer and call back", ends the call, then we place a follow-up call after approval.
- Context MCP is **inert while Self-Hosted mode is on**. VERIFIED [S12].

**Self-Hosted mode, for the decision on the user-facing inbound line.** VERIFIED [S12][S13][S14][P3][P4][G1]:
- **Scope:** account-wide. "While Self-Hosted is on, it drives **all** of your account's calls, inbound and outbound."
  - Turning it on for the status line would also put the business calls on our own LLM.
  - That loses Context MCP, the built-in tools, and DTMF/IVR navigation (the self-hosted LLM protocol has no tools).
  - The only way around this is a second Dial account, and each account needs its own never-used verified phone number.
- **Access** is approved per account by a human: `POST /api/v1/self-hosted {action:"request_access", useCase, companyUrl?}`. `access` moves through `none`/`pending`/`granted`/`denied`; `save` and `activate` return `403` until granted.
- **Configuration:** `POST /api/v1/self-hosted` with `{action:"save"|"activate", config:{type:"llm", wsUrl:"wss://…"}}` or `{action:"disable"}`.
  - The signing secret (`shs_…`) comes from `GET /api/v1/self-hosted/secret?mode=llm`.
  - The config also exposes a `urlKey` ("unguessable per-account path segment"); its role in the path is unclear.
- **Price:** $0.13/min self-hosted versus $0.22/min managed. VERIFIED [S19].
- **LLM protocol** (JSON frames, `snake_case`):
  - Dial opens one WebSocket per call to `wss://<your-url>/<call_id>`, signed with `X-Dial-Signature` = HMAC-SHA256(secret, `${t}.${call_id}`). Verify with `verifyDialSignature(secret, header, callId)`.
  - **Dial → us:**
    - `call_connected {call_id, direction, from, to, instruction, language}`: sent on every connect and reconnect. `instruction` is our prompt plus the general context.
    - `transcript_update {transcript:[{role:"agent"|"user", content}]}`: informational.
    - `response_required {response_id, transcript}`: we must answer.
    - `reminder_required {response_id, transcript}`: the user went quiet; a nudge is optional.
    - `ping_pong {timestamp}`: about every 2 s; echo it within about 5 s or Dial reconnects.
  - **Us → Dial:**
    - `response {response_id, content, content_complete, end_call?}`: streamable. A newer `response_required` supersedes the one in flight.
    - `interrupt {content, content_complete, end_call?}`: speak immediately.
    - `ping_pong`.
  - No tools, no word timing, no metadata channel. Resume by `call_id`; the latest `response_required` carries the full transcript.
  - SDK zod schemas: `parseDialMessage`, `serializeServerMessage`, `DialServerMessageSchema`, `ServerDialMessageSchema`. Reference server: `GetDial-AI/playbooks/self-hosted/openai-node/server.ts`.
- **Audio protocol** (the alternative): `media` frames in both directions (base64; `mulaw_8000`, `alaw_8000`, `l16_8000`, `l16_16000` or `l16_24000`), plus `dtmf` (inbound digits only), `mark`/`clear`, `duration_warning`, `end_call`/`call_ended`, and `ping_pong`. Audio-mode calls produce no transcript.
- **Verdict:** keep the managed agent plus Context MCP for the hackathon. Self-Hosted is a bigger build, needs approval, and degrades the outbound business calls. INFERRED.

## H. Pricing, limits, test mode, regions, MCP, CLI

**Pricing.** VERIFIED [S19][S20][S8]:
- PAYG only for self-serve: **$3/month per number**, **$250/month per iMessage number** (iMessage messages are $0).
- Calls are **$0.22/min managed** and **$0.13/min self-hosted**. The pricing page doesn't split inbound and outbound.
- US SMS is $0.02 per segment; international SMS runs from $0.02 to $1.00 across 7 tiers.
- 10DLC is a one-time $25 per number.
- Accounts start with **$5 of credit and no card required**.
- At a balance of $0 or below, spend returns `402` and inbound calls are declined.
- Enterprise pricing is custom.

**Free-account guardrails** apply until the first top-up or subscription; the welcome credit does not lift them. VERIFIED [S16]:
- 5 min per call and 2 concurrent calls.
- Read the live values from `GET /api/v1/account` → `limits: { maxCallDurationSeconds, maxConcurrentCalls } | null`. There is no SDK method for this.
- Budget: $5 minus about $3 for the number leaves roughly $2, about 9 managed minutes. **Top up before the demo.** Adding credit is a dashboard payment step the user must do themselves. INFERRED.

**Other limits.** VERIFIED [S17]:
- Event waits: 1–60 s.
- History lists: at most 100.
- E.164 is required everywhere.
- Lookups (`lookupNumber`) are rate-limited per account and return `Retry-After`.
- Emergency numbers are blocked. VERIFIED [S20].

**Test or sandbox mode:** none for the API. All keys are `sk_live_`.
- The "sandbox mode" in the CLI docs is a keyless container mode, not a test environment. VERIFIED [S22].
- Dashboard test tools and `/api/v1/test/*` helpers inject synthetic inbound SMS marked `source: "internal"`. Those endpoints are not in the public OpenAPI spec. VERIFIED [S4], details unknown.
- Use `webhook.ping` to test the endpoint. VERIFIED [S3].

**Regions:**
- Numbers are US only. VERIFIED [S2].
- Some numbers can only call US destinations (`403 unsupported_region`); some regions can be enabled on request. VERIFIED [S16].

**MCP for coding agents, not for our app.** VERIFIED [S21]:
- Remote: `https://getdial.ai/mcp` (Streamable HTTP, OAuth 2.1).
- Local: `npx -y @getdial/cli mcp` (stdio).
- Tools: `list_numbers`, `purchase_number`, `set_number_properties`, `send_message`, `list_messages`, `list_groups`, `list_contacts`, `lookup_number`, `start_typing`, `stop_typing`, `place_call`, `list_calls`, `get_call`, `stop_call`, `wait_for_event`, `get_account_status`.
- A docs MCP is at `https://docs.getdial.ai/_mcp/server`.

**CLI.** `npm i -g @getdial/cli` (Node 22+). Every command takes `--json`. VERIFIED [S22]. Useful commands:
- `dial doctor`
- `dial number list|purchase|set`
- `dial message`
- `dial call --to … --outbound-instruction … [--voice-gender] [--idempotency-key]`
- `dial call get|stop <id>`
- `dial wait-for <type> -f field=value`
- `dial billing`

**Other integrations:** a Python SDK (`dial-sdk`), `@getdial/ai-sdk` (Vercel AI SDK tools), LangChain, CrewAI, AutoGen, Zapier, and `@getdial/chat-sdk-adapter`. VERIFIED [S-overview][S24].

---

## Discrepancies found, so nobody trips on them

1. **Path prefix.** Doc examples use `api.getdial.ai/v1/...`; the OpenAPI spec and SDK use `api.getdial.ai/api/v1/...`. Use the latter.
2. **Call idempotency.** "Place a voice call" says there is no idempotency key. The REST reference, SDK (`idempotencyKey`), CLI (`--idempotency-key`) and Errors page all support `Idempotency-Key`. That capability page is stale.
3. **Voice.** "Place a voice call" says the voice is preset per number and not settable per call. REST, SDK and CLI all have per-call `voiceGender`.
4. **`inboundInstruction` on purchase:** required in the SDK type, optional over REST.
5. **SDK types lag the API:**
   - Missing: `Call.voiceRuntime`, `PhoneNumber.tenDlc`, `whatsapp.autoRetryScheduled`.
   - `MessageReceivedData` lacks `groupId`/`replyToId`/`reaction` and `channel: "whatsapp"`, and types `to` as non-null.
   - `EventEnvelope.version` is typed as the literal `1`, but `number.status_changed` is `2` with `relatedObject.type: "phone_number"`.
   - There is no `webhook.ping` type.
   - Parse defensively.
6. **Webhook `eventTypes` enum** omits `message.status_changed` and `number.status_changed`, though the docs say both are delivered. Use `["*"]`.
7. **Stale "coming soon" note.** The "Open an event stream" description says webhooks are "coming soon". They exist.
8. **README still lists `setInboundInstruction`,** which is deprecated in favor of `setNumberProperties`.
9. **Chat adapter README** says to point "that number's webhook subscription". Subscriptions are account-level.
10. **Pricing page** frames 10DLC as for "high-volume US SMS"; the API docs say unregistered numbers are blocked to US recipients.

---

## Snippets (TypeScript, Next.js 16 App Router, Node runtime)

These are written against `@getdial/sdk@0.41.1` types. App-specific helpers such as `db.*` and `recordInboundEvent` are placeholders for your own code.

**How these were checked (2026-10-10):**
- Every `ts` block below was extracted and compiled with `tsc 5.9.3` (`strict`, `noEmit`) against the published `@getdial/sdk@0.41.1` `dist/*.d.ts` and the Telo repo's `next@16.4.0` types (`after`, `NextConfig.serverExternalPackages`). Exit code was 0.
- A negative test (a missing `outboundInstruction`, a bad `voiceGender`, and wrong types on `verifyDialSignature` and `call.ended`) produced the expected type errors, which confirms the real SDK types were in force.
- The dependency-free verifier in snippet 6 was unit-tested with self-generated signatures. Valid, wrong secret, tampered body, stale timestamp, missing header, malformed header, and spaces after the comma all behaved as expected.
- No Dial package code was executed.
- Type-check workspace: `.../scratchpad/typecheck/`.

### 0. `next.config.ts`: keep the SDK out of the server bundle

```ts
// next.config.ts (merge into the existing config)
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ...existing options (cacheComponents, turbopack, ...)
  // @getdial/sdk is CommonJS and, at import time, reads its own package.json via
  // readFileSync(join(__dirname, "..", "package.json")) [P1 dist/client.js]; bundling can break
  // that path. Externalizing makes Node `require` it from node_modules as published.
  serverExternalPackages: ["@getdial/sdk"],
};

export default nextConfig;
```

### 1. Client and error helper

```ts
// src/lib/dial/client.ts (server-only module; never import from client components)
import { DialClient } from "@getdial/sdk";

const apiKey = process.env.DIAL_API_KEY;
if (!apiKey) throw new Error("DIAL_API_KEY is not set");

export const dial = new DialClient({
  apiKey,                        // sk_live_...
  userAgent: "telo/0.1.0",   // optional; prepended to "@getdial/sdk/0.41.1"
  // baseUrl defaults to "https://api.getdial.ai"
});

/** The Telo line. A phone-number id ("fromNumberId"), or use fromNumber with E.164 or a nickname. */
export const TELO_NUMBER_ID = process.env.DIAL_FROM_NUMBER_ID!;

export const DIAL_API = "https://api.getdial.ai/api/v1";
export const dialHeaders = () => ({
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
});

/** The SDK throws Error("Dial API error <status>: <json>") (no retries). Recover status + code. */
export function parseDialError(err: unknown): { status: number; code?: string; error?: unknown } | null {
  if (!(err instanceof Error)) return null;
  const m = /^Dial API error (\d+): ([\s\S]*)$/.exec(err.message);
  if (!m) return null;
  let body: { code?: string; error?: unknown } = {};
  try { body = JSON.parse(m[2]); } catch { /* body was not JSON */ }
  return { status: Number(m[1]), code: body.code, error: body.error };
}

/** Free-account guardrails (null once the account has paid). No SDK method exists for /account. */
export async function getAccountLimits(): Promise<{ maxCallDurationSeconds: number; maxConcurrentCalls: number } | null> {
  const res = await fetch(`${DIAL_API}/account`, { headers: dialHeaders() });
  if (!res.ok) throw new Error(`Dial /account ${res.status}`);
  const account = (await res.json()) as { limits: { maxCallDurationSeconds: number; maxConcurrentCalls: number } | null };
  return account.limits;
}
```

### 2. Outbound call with an instruction

```ts
// src/lib/dial/calls.ts
import type { Call } from "@getdial/sdk";
import { dial, TELO_NUMBER_ID, getAccountLimits } from "./client";

export async function placeBusinessCall(opts: {
  taskId: string;
  attempt: number;              // bump on deliberate re-calls; reuse on retries of the same attempt
  businessPhone: string;        // E.164
  instruction: string;          // the full system prompt for this call
  transferToUser?: string;      // E.164: wait for a human, then cold-transfer to the user
  desiredMaxSeconds?: number;   // 60–3600
}): Promise<Call> {
  const limits = await getAccountLimits();
  const cap = limits?.maxCallDurationSeconds;          // 300 on a free account
  const maxCallDurationSeconds = opts.desiredMaxSeconds
    ? Math.min(opts.desiredMaxSeconds, cap ?? 3600)    // explicit value above the free cap returns 400
    : undefined;

  const call = await dial.makeCall({
    to: opts.businessPhone,
    fromNumberId: TELO_NUMBER_ID,
    outboundInstruction: opts.instruction,
    language: "en-US",
    voiceGender: "female",
    ...(opts.transferToUser ? { transferTo: opts.transferToUser } : {}),
    ...(maxCallDurationSeconds ? { maxCallDurationSeconds } : {}),
    idempotencyKey: `telo:${opts.taskId}:${opts.attempt}`, // sent as Idempotency-Key (<= 255 chars)
  });
  // call.status.state is "Queued" here (201; 200 means this key was already used).
  // Calls carry NO metadata: persist call.id -> taskId immediately; webhooks only carry callId.
  // Errors to expect: 402 insufficient_credit, 403 unsupported_region,
  // 409 calling_disabled | idempotency_conflict, 429 call_limit_reached.
  return call;
}

// Example instruction (INFERRED prompt design; the agent handles IVR/DTMF itself [S5]):
export const gymCancelInstruction = (p: { gym: string; member: string; memberId: string; zip: string }) => `
You are Telo, an AI assistant phoning ${p.gym} on behalf of their member ${p.member}.
Goal: cancel ${p.member}'s membership (member ID ${p.memberId}).
- If an automated phone menu answers, listen to every option and choose membership, cancellations, or a representative.
- If you are put on hold, wait quietly; do not hang up.
- If asked, say you are an AI assistant calling for the member. You may share only: full name, member ID, ZIP ${p.zip}.
- Do not accept fees, retention offers, or payments. If they require the member's approval, say you will confirm with the member and call back, then end the call politely.
- If you reach voicemail, do not leave a message; hang up.
- Before ending, ask for a confirmation or reference number and the effective cancellation date, and repeat them back.`.trim();
```

### 3. Fetch a call and its transcript

```ts
// src/lib/dial/calls.ts (continued)
// The SDK index does not export `TranscriptTurn` by name; derive it from `Call`.
type TranscriptTurn = NonNullable<Call["transcriptTurns"]>[number]; // { speaker, text, startMs, endMs }

export async function getCallResult(callId: string) {
  const call = await dial.getCall(callId);
  return {
    state: call.status.state,                         // "Queued" | "Ringing" | "In-Progress" | "Terminated" | "Unknown"
    outcome: call.status.terminationType,             // "completed" | "busy" | "no-answer" | "failed" | "canceled" | null
    label: call.status.label,                         // display only
    durationSec: call.duration,
    transferredAt: call.transferredAt,
    failureReason: call.failureReason,
    instructionUsed: call.instruction,
    transcriptText: call.transcript,                  // flat string; format undocumented
    turns: call.transcriptTurns ?? [],                // [{ speaker: "agent"|"user"|"transfer_target", text, startMs, endMs }]
  };
}

export const formatTurns = (turns: TranscriptTurn[]) =>
  turns.map((t) => `${t.speaker}: ${t.text}`).join("\n");
```

Note: `src/index.ts` exports `Call`, `CallStatus`, `CallState`, `TerminationType`, `Message`, `DialEvent` and the event types, but not `TranscriptTurn`. VERIFIED [P index.ts].

### 4. Send a message

```ts
// src/lib/dial/messages.ts
import type { Message } from "@getdial/sdk";
import { dial, TELO_NUMBER_ID } from "./client";

/** Not idempotent: never blind-retry. Delivery arrives later as message.status_changed. */
export async function textUser(userPhone: string, body: string): Promise<Message> {
  return dial.sendMessage({
    to: userPhone,                    // E.164
    fromNumberId: TELO_NUMBER_ID,
    body,                             // standard numbers: <= 670 chars if any non-GSM character (emoji, curly quotes)
    // channel: "sms" | "imessage" | "whatsapp"  // only needed on a line with two rails
  });
  // result.deliveryState: "pending" for SMS; "unconfirmed" for iMessage/WhatsApp.
  // US recipient + standard number without approved 10DLC → later deliveryState "failed".
}

/** Threaded reply works on iMessage/RCS/WhatsApp; an SMS-delivered target returns 400. Send a new message instead. */
export const replyTo = (messageId: string, body: string) => dial.replyToMessage(messageId, { body });
```

### 5. Update the number's inbound instruction (the status line)

```ts
// src/lib/dial/numbers.ts
import { dial, TELO_NUMBER_ID } from "./client";

export async function configureStatusLine() {
  const n = await dial.setNumberProperties(TELO_NUMBER_ID, {
    inboundInstruction:
      "You are Telo's status line. At the start of the call, call the get_status tool and " +
      "tell the caller, briefly and naturally, the status of their tasks. Answer follow-up questions " +
      "only from what get_status returned. If the tool returns nothing, say you could not find any tasks for this number.",
    inboundLanguage: "en-US",       // null → detect from the caller's country prefix
    inboundVoiceGender: "female",
    nickname: "Telo",
  });
  // Takes effect on the NEXT inbound call; the call record keeps a snapshot (call.instruction).
  return n;
}

/** Single-user demo alternative (no MCP): bake the latest status into the prompt on every change. */
export async function setStatusPromptForDemo(statusText: string) {
  await dial.setNumberProperties(TELO_NUMBER_ID, {
    inboundInstruction: `You are Telo's status line for Dylan. Current task status:\n${statusText}\nTell the caller this briefly.`,
  });
}
```

### 6. Verify and parse a webhook in a Next.js route handler (raw body)

```ts
// src/app/api/dial/webhook/route.ts
import { after } from "next/server";
import { verifyDialSignature, type Call, type DialEvent } from "@getdial/sdk";
import { dial } from "@/lib/dial/client";

type WebhookPing = {
  id: string; object: "event"; type: "webhook.ping"; version: number;
  createdAt: string; relatedObject: null; data: Record<string, never>;
};
// The SDK's DialEvent lags the docs (no "whatsapp" channel or groupId on message.received;
// number.status_changed is version 2). Read fields defensively.
type DialWebhookEvent = DialEvent | WebhookPing;

export async function POST(req: Request): Promise<Response> {
  const rawBody = await req.text();                                // exact bytes; verify BEFORE JSON.parse
  const signature = req.headers.get("x-dial-signature") ?? "";     // "t=<unix>,v1=<hex>"
  const secret = process.env.DIAL_WEBHOOK_SECRET;                  // "whsec_…", used verbatim as the HMAC key

  // HMAC-SHA256(secret, `${t}.${rawBody}`), constant-time compare, |now - t| <= 300 s. Never throws.
  if (!secret || !verifyDialSignature(secret, signature, rawBody, { toleranceSeconds: 300 })) {
    return new Response("invalid signature", { status: 401 });
  }

  let event: DialWebhookEvent;
  try {
    event = JSON.parse(rawBody) as DialWebhookEvent;
  } catch {
    return new Response("invalid JSON", { status: 400 });
  }
  if (!event || typeof event.type !== "string") return new Response("missing type", { status: 400 });

  const eventId = req.headers.get("x-dial-event-id") ?? event.id;  // stable per event; same as envelope id

  // At-least-once delivery (up to 6 attempts). Inbox pattern: INSERT ... ON CONFLICT (event_id) DO NOTHING.
  const isNew = await recordInboundEvent(eventId, event);          // your code; false on duplicate
  if (!isNew) return new Response("duplicate", { status: 200 });

  // Dial gives each attempt 10 s; acknowledge now, process after the response.
  // If processing throws, the row stays unprocessed; have a sweeper re-run unprocessed rows.
  after(() => processDialEvent(eventId, event));
  return new Response("ok", { status: 200 });
}

async function processDialEvent(eventId: string, event: DialWebhookEvent): Promise<void> {
  switch (event.type) {
    case "message.received": {
      const d = event.data;
      if (d.source === "internal") break;                          // dashboard test traffic
      await handleUserText({ from: d.from, body: d.body, messageId: d.messageId, channel: d.channel });
      break;
    }
    case "call.status_changed": {
      const d = event.data;                                        // Queued → Ringing → In-Progress → Terminated
      await upsertLiveCall(d.callId, { state: d.status.state, label: d.status.label, direction: d.direction,
        from: d.from, to: d.to, terminationType: d.terminationType });
      break;
    }
    case "call.ended": {
      const d = event.data;                                        // exactly once per call
      await upsertLiveCall(d.callId, { state: "Terminated", outcome: d.status, canceled: d.canceled,
        durationSeconds: d.durationSeconds, transcriptAvailable: d.transcriptAvailable });
      break;
    }
    case "call.transcribed": {
      const call = await dial.getCall(event.data.callId);          // thin event: fetch the record
      await analyzeCallAndNotify(call);                            // your LLM: outcome, conf #, approval needed?
      break;
    }
    case "message.status_changed": {
      const d = event.data;
      if (d.deliveryState === "failed" || d.deliveryState === "undelivered") {
        await flagUndelivered(d.messageId, d.deliveryError);       // e.g. A2P/10DLC rejection text
      }
      break;
    }
    case "number.status_changed":
    case "webhook.ping":
    default:
      break;                                                       // unknown future types: ignore, 200
  }
  await markEventProcessed(eventId);
}

// --- your app code (placeholders) ---
declare function recordInboundEvent(id: string, e: unknown): Promise<boolean>;
declare function markEventProcessed(id: string): Promise<void>;
declare function handleUserText(m: { from: string; body: string; messageId: string; channel: string }): Promise<void>;
declare function upsertLiveCall(callId: string, patch: Record<string, unknown>): Promise<void>;
declare function analyzeCallAndNotify(call: Call): Promise<void>;
declare function flagUndelivered(messageId: string, reason: string | null): Promise<void>;
```

A dependency-free verifier, if you'd rather not import the SDK in this route. It is byte-equivalent to [P3] and [S3]:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyDialWebhook(secret: string, header: string | null, rawBody: string, toleranceSec = 300): boolean {
  if (!header) return false;
  let t: number | undefined; let v1: string | undefined;
  for (const part of header.split(",")) {
    const i = part.indexOf("="); if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === "t") t = Number(v); else if (k === "v1") v1 = v;
  }
  if (t === undefined || !Number.isFinite(t) || !v1 || !/^[0-9a-f]+$/.test(v1)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return expected.length === v1.length && timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(v1, "hex"));
}
```

### 7. One-off setup: register the webhook (REST; no SDK method)

```ts
// scripts/dial-setup.ts: run once with DIAL_API_KEY set (e.g. `npx tsx scripts/dial-setup.ts`)
const API = "https://api.getdial.ai/api/v1";
const headers = { Authorization: `Bearer ${process.env.DIAL_API_KEY}`, "Content-Type": "application/json" };

const created = await fetch(`${API}/webhooks`, {
  method: "POST", headers,
  body: JSON.stringify({ targetUrl: "https://<your-deploy>/api/dial/webhook", eventTypes: ["*"] }), // HTTPS, public
}).then((r) => r.json());
const webhookId: string = created.webhook.id;

const { secret } = await fetch(`${API}/webhooks/${webhookId}/secret`, { headers }).then((r) => r.json()); // "whsec_…"
console.log("Put this in DIAL_WEBHOOK_SECRET:", secret);

await fetch(`${API}/webhooks/${webhookId}/ping`, { method: "POST", headers }); // 202 { eventId } → webhook.ping
```

### 8. One-off setup: connect Telo's MCP server as a Context MCP (REST)

```ts
// The MCP server itself is your own Streamable-HTTP MCP endpoint (e.g. /api/mcp in the Next app).
// In each tool handler, read X-Dial-Direction / X-Dial-User-Number / X-Dial-Agent-Number from the request
// and authorize per call (Dial's explicit warning [S11]). There is no call id header.
const res = await fetch("https://api.getdial.ai/api/v1/context-mcps", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.DIAL_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "Telo",
    url: "https://<your-deploy>/api/mcp",
    headers: { Authorization: `Bearer ${process.env.TELO_MCP_TOKEN}` }, // authMode "static": how we know it's Dial
    timeoutMs: 120000,
  }),
}).then((r) => r.json());
// res.contextMcp.status === "connected" and res.contextMcp.toolCount > 0 when the probe succeeded.
```

### 9. Local development without a public URL

Webhooks need public HTTPS, so for local work use a tunnel. Alternatively, run a small long-lived Node script that consumes the SDK stream. Stream events are not signed and are presence-based, so use this only in development:

```ts
// scripts/dial-tail.ts
import { DialClient } from "@getdial/sdk";
const dial = new DialClient({ apiKey: process.env.DIAL_API_KEY! });
const conn = await dial.newEventsConnection();
try {
  for await (const e of conn) {
    console.log(e.type, JSON.stringify(e.data));
    // optionally forward to your local handler logic (bypassing signature checks in dev only)
  }
} finally {
  await conn.close();
}
```

---

## Suggested Telo wiring (INFERRED)

1. **User texts a task.** `message.received` → our agent loop. It asks only for missing info, replying with `sendMessage`. That only works for US users once SMS is unblocked; until then use the voice or web fallback.
2. **Place the business call.** `makeCall` with the task-specific `outboundInstruction` and `idempotencyKey = task:attempt`. Store `callId → task`. Optionally pass `transferTo: user.phone` for "patch me in when a human answers".
3. **Live dashboard.** `call.status_changed` → DB → our own SSE or polling. Fine-grained stages come from the agent calling the MCP tool `report_progress`.
4. **Outcome.** `call.ended` → `call.transcribed` → `getCall` → our LLM extracts the outcome (confirmation number, fees, next step), or reads the outcome recorded via the MCP `record_outcome` tool. Then message the user.
5. **Approval.** Default: the agent defers ("I'll confirm with the member and call back"), we ask the user, then place a follow-up call. Optional: the MCP `request_user_approval` tool with a bounded wait.
6. **User calls in for status.** The number's `inboundInstruction` tells the agent to call `get_status`. Our MCP server keys on `X-Dial-User-Number` (and checks `X-Dial-Direction: inbound`).

---

## Open questions only Dial staff or a logged-in dashboard can answer

1. Is there a **hackathon coupon or credit** (`--coupon` / `coupon` on `POST /v1/auth/signup`), and are new signups currently open?
2. **10DLC at a hackathon:**
   - Can Dial provide a pre-approved number, or a temporary exemption for outbound US SMS?
   - Is the onboarding number's `tenDlc.status` `not_registered`, meaning blocked?
   - Why is `tenDlc` `null` on non-PAYG accounts? Do subscription numbers send US SMS without registration?
3. Is the **$250/month iMessage number** prorated or trialable for an event? Can WhatsApp beta be enabled, including the "WhatsApp number without calls" (`["sms","whatsapp"]`) that `skills.md` mentions but the OpenAPI enum lacks? At what price?
4. **Context MCP details:**
   - Is there any **call id** in the MCP request? Only direction, user number and agent number are documented.
   - Is the tool list re-fetched per call or only at connect time?
   - Is `timeoutMs` a per-tool-call limit? What does the caller hear during a slow tool call?
   - Can tools be scoped per number or per direction?
   - Is Streamable HTTP the only supported transport?
5. Does the managed agent know the caller's or callee's number, and what exactly is in the "general context"? Is an **inbound per-call hook** (dynamic instruction or variables) on the roadmap?
6. **Agent behavior:**
   - Does the outbound agent speak first or wait for the callee? Can we set a first message?
   - What does it do at **voicemail**, and how is that reported?
   - How long will it wait **on hold** without `transferTo`? Is there an inactivity timeout?
   - Which "built-in agent tools" exist (end call, DTMF, transfer, others)?
7. **Recordings and call summaries:** do managed calls have them, are they accessible by API or only in the dashboard, and what is the retention?
8. What is the format of the flat `transcript` string?
9. **Webhooks:**
   - Is the signature re-computed with a fresh `t` on every retry?
   - What is the backoff schedule?
   - How is the secret rotated, and can a header carry multiple `v1` values?
   - Are deliveries ordered?
   - Can `message.status_changed` and `number.status_changed` be listed explicitly in `eventTypes`?
   - Does the create response include the full secret, and in which field?
10. **Concurrency:** which numbers "carry one call at a time"? After a top-up, can one standard number handle an outbound business call and an inbound user call at once?
11. **Billing:**
    - Is the onboarding number billed $3 from the $5 credit?
    - Inbound versus outbound per-minute rates?
    - Is MMS priced differently?
12. Are the `/api/v1/test/*` helpers (synthetic inbound SMS) available to customers?
13. **Self-Hosted:**
    - Can it be scoped to one number instead of the whole account?
    - How long does access approval take?
    - What does `urlKey` do in the WebSocket path?
14. Are any **live transcript** streams planned for managed calls? The marketing says "real-time transcription".
15. Is `@getdial/sdk` tested under bundlers (Next.js/Turbopack)? It reads `package.json` via `__dirname` at load time.

---

## Sources

Docs pages are fetched as `.md`, with local copies in `.../scratchpad/docs/pages/`.

| Key | Source |
|---|---|
| S1 | https://docs.getdial.ai/documentation/get-started/authentication.md |
| S2 | https://docs.getdial.ai/openapi.json (OpenAPI 3.1, server `https://api.getdial.ai`) |
| S3 | https://docs.getdial.ai/documentation/platform/webhooks.md (+ api-reference/rest-api/webhooks/*.md) |
| S4 | https://docs.getdial.ai/api-reference/events/overview.md (+ message-received, message-status-changed, call-status-changed, call-ended, call-transcribed, number-status-changed, webhook-ping .md) |
| S5 | https://docs.getdial.ai/documentation/capabilities/place-a-voice-call.md |
| S6 | https://docs.getdial.ai/api-reference/rest-api/calls/make-call.md (+ get-call, list-calls, stop-call) |
| S7 | https://docs.getdial.ai/documentation/capabilities/receive-a-voice-call.md ; https://docs.getdial.ai/documentation/reference/how-it-works.md |
| S8 | https://docs.getdial.ai/documentation/platform/manage-phone-numbers.md |
| S9 | https://docs.getdial.ai/api-reference/rest-api/messages/send-message.md |
| S10 | https://docs.getdial.ai/documentation/capabilities/send-an-sms.md |
| S11 | https://docs.getdial.ai/documentation/platform/context-mcp.md (+ api-reference/rest-api/context-mcp/create-context-mcp.md) |
| S12 | https://docs.getdial.ai/documentation/platform/self-hosted.md |
| S13 | https://docs.getdial.ai/api-reference/self-hosted-protocol/overview.md (+ call-connected, transcript-update, response-required, reminder-required, response, interrupt, ping-pong) |
| S14 | https://docs.getdial.ai/api-reference/self-hosted-audio-protocol/overview.md (+ ending-calls, dtmf, media) |
| S15 | https://docs.getdial.ai/documentation/platform/stream-account-events.md (+ rest-api/events/subscribe-to-events.md, wait-for-event.md) |
| S16 | https://docs.getdial.ai/documentation/reference/errors.md |
| S17 | https://docs.getdial.ai/documentation/reference/usage-and-limits.md |
| S18 | https://docs.getdial.ai/documentation/changelog/changelog.md |
| S19 | https://getdial.ai/pricing (table and FAQ JSON-LD) |
| S20 | https://getdial.ai/skills.md |
| S21 | https://docs.getdial.ai/integrations/tools/mcp.md |
| S22 | https://docs.getdial.ai/documentation/cli/commands.md |
| S23 | https://docs.getdial.ai/documentation/capabilities/whats-app-lines.md |
| S24 | https://docs.getdial.ai/integrations/agent-clients/vercel-chat-sdk.md |
| S25 | https://docs.getdial.ai/integrations/methods/local-url-target.md |
| S-overview | https://docs.getdial.ai/documentation/sdks/overview.md ; https://docs.getdial.ai/documentation/sdks/node.md |
| P1 | `@getdial/sdk@0.41.1` `src/client.ts`, `dist/client.js`, `package.json`, `tsconfig.json` |
| P2 | `@getdial/sdk@0.41.1` `src/types.ts` (= `dist/types.d.ts`) |
| P3 | `@getdial/sdk@0.41.1` `src/self-hosted.ts` (`verifyDialSignature`, LLM protocol zod schemas) |
| P4 | `@getdial/sdk@0.41.1` `src/self-hosted-audio.ts` |
| P5 | `@getdial/sdk@0.41.1` `src/events.ts` (PubNub `EventsConnection`) |
| P index.ts | `@getdial/sdk@0.41.1` `src/index.ts` (export list) |
| P6 | `@getdial/chat-sdk-adapter@0.2.0` `dist/index.js` (signing, webhook routing), `dist/index.d.ts`, `README.md` |
| G1 | https://github.com/GetDial-AI/playbooks: `self-hosted/openai-node/server.ts`, `sms-and-voice/node-express/dial-service.ts` |
| N1 | Telo repo (`next@16.4.0`): `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverExternalPackages.md`, `.../04-functions/after.md`, `.../02-route-segment-config/runtime.md` |
