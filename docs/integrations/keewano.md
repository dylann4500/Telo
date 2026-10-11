# KeewanoDB: integration reference for Telo

Researched 2026-10-10 (the day before the hackathon). Read-only research: no sign-up, no credentials, no downloaded code run. The npm tarballs were unpacked, and only their README and `.d.ts` files (plus a few constants grepped from the JS) were read.

**Labels.** Every fact is tagged **VERIFIED** (an official source, linked) or **INFERRED** (my reasoning, or a press or third-party claim, which is named as such). Official sources are Keewano's docs, site, OpenAPI spec, npm packages and GitHub, the event's own Partiful page, and Dial's docs.

---

## 0. The short version

* **Official developer docs are public.** The news-only premise was wrong. Keewano publishes GitBook docs at `docs.keewano.com`, with a machine-readable `llms.txt` and a 236 KB `llms-full.txt`. It also publishes an OpenAPI spec for REST ingestion and MIT-licensed SDKs on npm and GitHub. VERIFIED [K-llms] [K-swagger] [K-gh]
* **The docs include a page written for this hackathon:** "SpeedHacks Quickstart", with setup, a free-plan unlock, the judging criteria and a backfill script. VERIFIED [K-speed]
* **Write path (fully specified):** `POST https://api.keewano.com/event/ingress/v1/json/in`, sent with a `k-token` header holding an SDK-type project key. One batch covers exactly one entity (a UUID). Each event has a numeric type id, an optional unix-seconds timestamp and one typed value. Retries are idempotent per `(dataSessionId, batch)`, and events become queryable about 5 minutes after ingestion. VERIFIED [K-swagger] [K-connect] [K-speed]
* **Read paths:**
  * SQL over the Postgres wire protocol at `pgsql.keewano.com:27543`.
  * Lua scripts that run inside the database and walk each entity's ordered events.
  * A remote MCP server at `https://api.keewano.com/mcp`, which takes a personal access token in the `k-token` header.
  * Keewano Ask, a natural-language analyst inside the web app.

  VERIFIED [K-sql] [K-lua] [K-mcp] [K-ask]
* **Not public:**
  * the MCP tool names and their input/output schemas
  * any programmatic way to run Lua except (probably) through MCP
  * any API to delete or redact data that has already been ingested

  The TypeScript SDK docs say outright that the SDK "exposes no call that deletes data already delivered". VERIFIED [K-privacy-sdk]
* **Entity model:**
  * No first-class entity types. An entity is just a UUID, sent as `installId` and/or `userId`, so one batch belongs to one entity.
  * To put one event on several timelines (user, business, relationship), you send it once per entity (fan-out).
  * Every distinct entity id counts toward the plan's MAU limit.

  The single-entity batch is VERIFIED [K-swagger] [K-speed] [K-pricing]. Fan-out is INFERRED.
* **Hackathon:** "SpeedHacks: The Official speedrun Hackathon #SFTechWeek", **Sunday Oct 11, 2026, 9am–9pm, San Francisco**. The partners are Alike, Darwin, **Dial**, **Keewano** and Sparta, and each partner awards a $1K "Best Use" prize. VERIFIED [E-partiful]

---

## 1. Sources

| Key | What | URL |
|---|---|---|
| K-llms | Docs index and full-text dump for agents | https://docs.keewano.com/llms.txt · https://docs.keewano.com/llms-full.txt |
| K-what | What is Keewano | https://docs.keewano.com/getting-started/readme |
| K-connect | Connecting to Keewano (ingestion, event model) | https://docs.keewano.com/getting-started/connecting-to-keewano |
| K-speed | **SpeedHacks Quickstart** | https://docs.keewano.com/getting-started/speedhacks-quickstart |
| K-swagger | REST Ingestion API, OpenAPI 3.0, v1.0.2-217 (spec embedded in the Swagger UI) | https://api.keewano.com/event/ingress/v1/json/swagger |
| K-sql | SQL Guide | https://docs.keewano.com/sql-query-studio/guide |
| K-sqlref | SQL Reference | https://docs.keewano.com/sql-query-studio/reference |
| K-lua | Lua Guide | https://docs.keewano.com/lua-scripting/guide |
| K-luaref | Lua Reference | https://docs.keewano.com/lua-scripting/reference |
| K-mcp | MCP for Agents | https://docs.keewano.com/analytics/mcp-for-agents |
| K-ask | Keewano Ask | https://docs.keewano.com/analytics/keewano-ask |
| K-tables | Data Tables | https://docs.keewano.com/analytics/data-tables |
| K-sdks | Choosing an SDK | https://docs.keewano.com/sdks/choosing-an-sdk |
| K-codegen | Custom Events Codegen | https://docs.keewano.com/sdks/custom-events-codegen |
| K-node | Node.js SDK (docs page and repo guide) | https://docs.keewano.com/sdks/nodejs · https://github.com/Keewano/TypeScript-SDK/blob/main/docs/nodejs.md |
| K-npm | `@keewano/node-sdk@1.3.0-207`, `@keewano/core@1.3.0-207` (README and `.d.ts` read; published 2026-10-08) | https://www.npmjs.com/package/@keewano/node-sdk · https://www.npmjs.com/package/@keewano/core |
| K-custom-sdk | TS SDK custom events | https://github.com/Keewano/TypeScript-SDK/blob/main/docs/custom-events.md |
| K-privacy-sdk | TS SDK privacy | https://github.com/Keewano/TypeScript-SDK/blob/main/docs/privacy.md |
| K-skill | Keewano's official Claude Code skill (data-modeling guidance) | https://github.com/Keewano/Keewano-UnitySDK-ClaudeCode-Skill |
| K-gh | GitHub org (7 public repos) | https://github.com/Keewano |
| K-home | Homepage | https://www.keewano.com |
| K-pricing | Pricing and FAQ | https://www.keewano.com/pricing |
| K-mcp-site | MCP marketing page | https://www.keewano.com/mcp-for-agents |
| K-cloud | DB Cloud page | https://www.keewano.com/db-cloud |
| K-usecases | Use cases ("Agent Memory and Context") | https://www.keewano.com/use-cases |
| K-pp | Privacy policy (updated 1/11/2025) | https://www.keewano.com/privacy-policy |
| K-tos | Terms (updated Aug 14, 2026) | https://www.keewano.com/terms-and-conditions |
| E-partiful | SpeedHacks event page | https://partiful.com/e/tthQk11QYKKZJRKvLGBQ |
| E-hsq | HackerSquad listing | https://hackersquad.io/events/speedhacks-oct11 |
| D-ctx | Dial Context MCP docs | https://docs.getdial.ai/documentation/platform/context-mcp |
| P-vb | Press: VentureBeat, Sep 15 2026 | https://venturebeat.com/data/every-user-device-and-agent-gets-its-own-table-in-keewanodb-and-queries-never-join-across-them |
| P-bf | Press: Blocks & Files, Sep 21 2026 | https://www.blocksandfiles.com/ai-ml/2026/09/21/keewanodb-stores-events-for-agent-analysis/5297780 |

Raw copies of everything above are in `research/raw/` next to this file (§13).

---

## 2. The hackathon

### 2.1 Event (SpeedHacks)

* **Name:** "SpeedHacks: The Official speedrun Hackathon #SFTechWeek". It is the closing hackathon of SF Hack Week. VERIFIED [E-partiful]
* **When:**
  * Partiful lists **Sunday, Oct 11, 9:00am–9:00pm**, a 12-hour build day. VERIFIED [E-partiful]
  * HackerSquad also lists Sunday Oct 11, with location "TBA". VERIFIED [E-hsq]
  * The year isn't printed on the page. INFERRED that it is 2026, since Oct 11 2026 is a Sunday and Keewano's docs carry a 2026 SpeedHacks page.
* **Where:**
  * San Francisco. VERIFIED [E-partiful]
  * The venue shows only as "PTET". The full address needs phone verification on Partiful, and RSVPs are closed. VERIFIED [E-partiful]
* **Theme:** "Give people their time back": remove a meaningful bottleneck in how people work, learn, or get services. VERIFIED [E-partiful]
  * INFERRED: Telo (an agent that sits on hold for you) fits the theme squarely.
* **Partners:** Alike, Darwin, **Dial**, **Keewano**, Sparta. VERIFIED [E-partiful]
  * Press reports that Keewano's seed round included a16z speedrun. INFERRED, from press [P-bf].
* **Prizes:**
  * Each speedrun company gives a "Best Use" prize of **$1K**. VERIFIED [E-partiful]
  * The grand prize is a guaranteed interview with the speedrun + Alpha investment team. VERIFIED [E-partiful]
  * Finalists demo live to speedrun investors and portfolio companies. VERIFIED [E-partiful]
  * Judges are speedrun founders. The Partiful page lists 22 names. VERIFIED [E-partiful]
* **Teams:** bring one (mention it when you apply) or form one on site. VERIFIED [E-partiful]
* **What's provided:** no Devpost, Discord or starter-kit link appears on the event page. VERIFIED [E-partiful]
* **Keewano channel:** Keewano's quickstart says the "Keewano channel on the event's chat" is still "(TBD)". VERIFIED [K-speed]

### 2.2 Keewano "Best Use" criteria, from their SpeedHacks Quickstart

All items in this section are VERIFIED [K-speed].

* **Qualifies:** "ingests meaningful event data into Keewano and builds an agent or application that uses that data to reason, answer questions, give valuable insight, or power a meaningful part of the experience."
* **Test:** "if you can take Keewano out and the project still works the same, it doesn't qualify."
* **The judge looks for:**
  1. Keewano is **load-bearing**: events go in during the hackathon, and the answers change what the product says or does.
  2. **It works live**: the demo runs at least one live Keewano query.
  3. **A real bottleneck removed**, with a bonus for measuring the before and after *in Keewano itself*.
  4. **It handles the unexpected**: the judge may ask one unprepared question, and your agent answers it from Keewano.
* **Scores low:**
  * storage nobody queries
  * a dashboard as the end product
  * an agent whose decisions don't depend on the query
* **Suggested patterns:**
  * "App that decides on live data": "Before acting, the app asks about this entity's history". This is exactly Telo's pre-call memory.
  * "Self-improving loop", where the agent records its own actions and outcomes.
  * Both fit Telo. INFERRED.
* **Before-demo checklist:**
  * events reached Keewano during SpeedHacks
  * events are small and typed, with no logs, transcripts or raw text
  * at least one live query runs during the demo
  * the answer changes what the agent does
  * **your Keewano project name is on your submission**
* **People on site:**
  * Vitaly Bukhovsky (Co-Founder & CPO, **Keewano prize judge**)
  * Karen Teboulle (VP Growth)

### 2.3 Hackathon setup and free-plan unlock

All items in this section are VERIFIED [K-speed].

1. Sign up at keewano.com ("Sign Up Free"; the link goes to `auth.keewano.com/login/register`) and create a project.
2. In the app's chat (bottom-left, above Settings), send **`#SpeedHacks`**. Keewano then enables "full event access for your account: no limits, MCP access and team seats".
   * This matters because the Free plan otherwise caps **MCP at 25 tool calls/day** [K-pricing] (§7).
3. Create an event-sending key: **Settings → Project → API Keys**.
4. Create a personal access token for MCP and SQL: **Settings → Personal → Security**.
5. Connect an agent:
   ```bash
   claude mcp add --scope user --transport http keewano https://api.keewano.com/mcp --header "k-token: $KEEWANO_PAT"
   ```
6. Allow about 5 minutes for new events to become queryable. Then ask: "How many users and events does my project have, and which event types does it record?"

### 2.4 Dial, the other sponsor we use

* Dial's docs index is at `https://docs.getdial.ai/llms.txt`, and it has its own docs MCP server. VERIFIED [D-ctx]
* **Context MCP:** Dial can attach an external MCP server to its voice agent, so the agent can call that server's tools *during* a call. VERIFIED [D-ctx]
  * It supports `static` header auth, which is how Keewano MCP authenticates (`k-token`). VERIFIED [D-ctx]
  * Dial warns that the connection runs as one identity. Anyone on the line could reach everything that identity's scopes allow. VERIFIED [D-ctx]
  * Dial adds the headers `X-Dial-Direction`, `X-Dial-User-Number` and `X-Dial-Agent-Number` to each request during a call. VERIFIED [D-ctx]
* **Recommendation (INFERRED): do NOT attach Keewano's MCP directly to the voice agent.**
  * A business rep on the call could steer the agent into reading the whole project.
  * Instead, inject a pre-computed brief into the call plan before dialing.
  * If mid-call lookups are needed, put a small Telo MCP in front of Keewano and scope its queries using `X-Dial-User-Number`.

---

## 3. Product and mental model

* **Entity:** "something whose history you want to understand". The docs' examples are a user, account, device, transaction, machine and AI agent. VERIFIED [K-what]
  * The SpeedHacks page adds "a person, a customer, an agent session, a call or a device". VERIFIED [K-speed]
  * "In most products the entity is a user or an install … you will see `user_id` in SQL and `process_user` in Lua." VERIFIED [K-what]
* **Storage:** events attach to an entity in order, and Keewano "keeps that history together and in order". VERIFIED [K-what]
* **Event model:** "An event is a name plus one typed value, attached to an entity." It reads as `Name(value)`. VERIFIED [K-speed]
* **Step functions:** every event "carries the latest value of every event before it".
  * So context is sent as its own event *before* the event it qualifies, for example `PaymentMethod("card")` then `OrderPlaced(1999)`. VERIFIED [K-speed]
  * In SQL, each event type is a column whose value "holds forward until the next occurrence". VERIFIED [K-sql]
* **Interfaces:** Keewano Ask, Data Tables, SQL and Lua all read the same event history, and MCP exposes it to your own agents. VERIFIED [K-what]
* **Performance claim:** "scan a quarter-billion events in under half a second" in internal benchmarks. VERIFIED that Keewano makes this claim [K-what]; it is not independently checked.
* **Agent memory is an official use case:** the use-cases page lists "Agent Memory and Context: Give agents the relevant context for the current task while keeping the complete event record available underneath", as well as "Customer and Account Timelines". VERIFIED [K-usecases]
* **Hosting:**
  * Official pages describe a managed KeewanoDB Cloud but don't name the cloud provider. VERIFIED [K-cloud]
  * "Fully managed on Google Cloud", with other clouds and self-managed deployment planned for early 2027. INFERRED, from press [P-vb].
* **KeewanoDB Local:**
  * The homepage advertises it ("Try Free"), but the button links to `#` and `/db-local` returns **404** today. VERIFIED (fetched 2026-10-10) [K-home]
  * INFERRED: there is no local engine we can run, so our local stand-in (§11) is needed.
* **Company:** founded in Tel Aviv in 2024, with a $12M seed led by Hetz Ventures. INFERRED, from press [P-vb] [P-bf].

---

## 4. Ingestion

### 4.1 Credentials (two kinds, not interchangeable)

| Credential | Used for | Where it's created | Notes |
|---|---|---|---|
| **Project API key**, type **SDK** | Writing: `POST /json/in`, `POST`/`GET /json/custom`, and every SDK | Settings → (Project →) API Keys | Sent as the `k-token` header. The event routes also accept a `?k-token=` query parameter, and the header wins if both are sent. The project is derived from the key, so you never send a project id. VERIFIED [K-connect] [K-swagger] |
| Project API key, type **Server** | Only `POST /json/cost` (ad spend, which we don't need) | same | A key of the wrong type gets a **403**. VERIFIED [K-connect] |
| **Personal access token** `kwpat-…` | Reading: SQL (as the Postgres password) and MCP (`k-token` header) | Settings → Personal → Security (`https://app.keewano.com/settings/personal/security`) | "One writes, one reads." VERIFIED [K-connect] [K-mcp] |

* The device SDK pages describe the project key as "a JWT issued in the Keewano console". VERIFIED [K-sdks] (Android, iOS and Python pages)

### 4.2 REST endpoint and schema (OpenAPI: "Keewano REST Ingestion API" v1.0.2-217)

```
POST https://api.keewano.com/event/ingress/v1/json/in
k-token: <SDK-type project key>
Content-Type: application/json

{
  "dataSessionId": "a1e9c7d2-4f83-4b6e-9c1a-2d7f5b0e8a34",   // UUID (required)
  "batch": 1,                                                  // sequence number (required)
  "customEventsHash": 987654321,                               // 0 if no custom events (required)
  "installId": "f3b8d61c-9a2e-4d70-8c15-6b4e2a9f0d71",         // UUID; optional if userId sent
  "userId": "7c2a5e40-1b93-4e88-a6d2-9f0c3b5d8e12",            // UUID or UINT64-as-string; optional if installId sent
  "sdkVersion": "server/1.0",                                  // optional free text
  "testUserName": "qa",                                        // optional; flags QA traffic
  "events": [                                                  // non-empty (required)
    { "eventTypeId": 2000, "timestamp": 1751932900, "data": 42, "dataType": "uint" }
  ]
}
→ 202 { "received": 1, "accepted": 1 }
```

Everything in this subsection is VERIFIED [K-swagger] [K-connect] unless marked otherwise.

* **Identity:** one batch belongs to **one** user or install.
  * Without `installId`, the `userId` stands in as the install id.
  * A request is rejected with **400** if it has neither id, a non-UUID `installId`, or a `userId` of `0` or the nil UUID.
* **Event fields:** `eventTypeId` (required), `timestamp` (unix **seconds**; when omitted or `null`, the server stamps receipt time), `data` (shape depends on type), and `dataType` (required for custom events).
* **Response codes:**
  * 202: accepted
  * 400: malformed
  * 401: missing key
  * 403: invalid key
* **Partial acceptance:**
  * `accepted` is lower than `received` when individual events were malformed. Those events are dropped; the rest of the batch is kept.
  * `accepted: 0` means the batch was a **duplicate or out of sequence**.
* **Body size:** the SDK guards the raw JSON body at **100 KB** (`REST_MAX_BODY_BYTES = 100 * 1024`) and treats the server's **413** as fatal. VERIFIED from the `@keewano/core` source [K-npm]
  * The SDK also treats 400, 401 and 403 as fatal and retries every other status. VERIFIED [K-npm]
* **Freshness:**
  * Ingestion is asynchronous: a 202 means "accepted, not yet queryable". VERIFIED [K-swagger]
  * The hackathon guidance is "**about 5 minutes** to become queryable". VERIFIED [K-speed]
  * Marketing elsewhere says answers come "in seconds, including about events you started sending minutes ago". VERIFIED [K-speed]
* **Rate limits:** none documented. The Terms allow throttling or suspension for "excessive requests". VERIFIED [K-tos] The `#SpeedHacks` unlock removes plan limits [K-speed]; whether it removes request-rate limits is unknown.

### 4.3 Custom event types (all Telo events will be custom)

Everything in this subsection is VERIFIED [K-swagger] [K-connect] [K-speed].

* Built-in catalog ids are `< 2000`. Custom ids are `>= 2000`; the DTO says `2000–65535`.
* **Register before use:**
  ```
  POST /event/ingress/v1/json/custom
  { "customEventsHash": N, "eventTypes": [{ "eventTypeId": 2000, "name": "...", "dataType": "..." }] }
  ```
  * `N` is any **non-zero** integer you choose; `0` means "no custom events".
* **Registration responses:**
  * 200 `already_registered`: re-sending the same map is safe.
  * 202 `registered`, or `in_progress` (another registration of this hash is running; re-send to confirm).
  * **409**: a *different* map is already registered under this hash.
* **Checking a map:** `GET /json/custom?customEventsHash=N` returns 200 when the map is registered and 204 when it isn't.
* **A hash's map is fixed once registered.** To add, rename or retype an event, register the whole new list under a **new hash**.
  * Keewano's guidance: "The list is append-only: a registered event's type can't change."
* Every batch containing custom events must carry the matching `customEventsHash`, and each custom event must carry its `dataType`. Otherwise the whole batch is rejected.
* **Custom `dataType`s:** `none`, `string`, `uint`, `bool`, `timestamp`, `ushortvec2`, `price_usd_cent`. The types `float`, `ubyte` and compound payloads are reserved for built-in events.
* **Value limits:**
  * Strings are capped at **256 characters**. VERIFIED [K-speed]; the SDK truncates at `MAX_STRING_LENGTH = 256` [K-npm].
  * In the SDK, numeric custom values are range-checked rather than clamped: `uint` and `price_usd_cent` must be 0…4,294,967,295. VERIFIED [K-custom-sdk]
* **Hash in Keewano's example:** their Python sample uses `zlib.crc32(json.dumps(list, sort_keys=True)) or 1`. VERIFIED [K-speed]
* **Codegen (`@keewano/codegen`) is a different numbering:** it assigns ids as `2500 + position` and hashes the gzip map with FNV-1a. It's only needed with the SDKs; with REST we choose our own ids and hash. VERIFIED [K-codegen] [K-npm]

### 4.4 Idempotency, batching, ordering

* **Idempotent per `(dataSessionId, batch)`:** "re-sending the same `batch` number is safe and will not double-count." VERIFIED [K-swagger]
  * A duplicate comes back as `202 {accepted: 0}` and must not be retried. VERIFIED [K-npm] (`RestIngestReceipt` docs)
* **Keewano's own sample** posts each batch with a fresh `dataSessionId: uuid4()` and `batch: 1`. VERIFIED [K-speed]
  * INFERRED (recommended): derive `dataSessionId` deterministically from our event's idempotency key, as `uuidv5(key + entity)`, and always send `batch: 1`. A retry then reuses the same pair and can't double-count.
* **"Out-of-sequence" batches are dropped** (`accepted: 0`). VERIFIED [K-swagger]
  * INFERRED: batch numbers must increase within a data session. Using one session per logical write sidesteps this.
* **Ordering:**
  * "Send events in chronological order — the batch's time window comes from its first and last event". VERIFIED [K-connect]
  * "Send each entity's events in time order". VERIFIED [K-speed]
  * Keewano's Claude Code skill says "Per-event timestamps + server-side ordering handle out-of-order delivery". VERIFIED [K-skill]
  * INFERRED: late batches are probably sorted into place. That needs confirming, as does whether events with the same timestamp keep their array order (timestamps are whole seconds).
* **Backfill:** "The REST API accepts a timestamp on every event, so a small script can backfill weeks of realistic history in minutes … The SDKs always stamp the current time, so backfill through REST." VERIFIED [K-speed]

### 4.5 SDKs (and why Telo should call REST directly)

* **Packages:**
  * Node.js: `@keewano/node-sdk`
  * Web: `@keewano/web-sdk`
  * React Native / Expo: `@keewano/react-native-sdk`, `@keewano/react-native-expo-sdk`
  * Python: `keewano-sdk`
  * Android, iOS, Unity

  Source for all of them is at github.com/Keewano. The TypeScript SDK and codegen are MIT-licensed; the Unity, Android, iOS and Python SDKs are Apache-2.0. The TypeScript SDKs share `@keewano/core`, and the current version is `1.3.0-207`, published 2026-10-08. VERIFIED [K-sdks] [K-npm] [K-gh]
* **The Node SDK is a server relay:**
  * Every call names the end user (`userId`: a UUID string or a 64-bit `bigint`), and the user's id becomes the install id. VERIFIED [K-npm] [K-node]
  * Default flush: after 30 s of user silence (`userIdleMs`), when the oldest event is 30 s old (`flushIntervalMs`), or when the batch reaches 50 KB. `reportUserBatch` seals immediately. VERIFIED [K-node]
  * It needs `dataDir` (no default) or `persistent: false`. VERIFIED [K-node]
  * It uses the **binary** protocol, with the default base `https://api.keewano.com/event/ingress/v1/data`. VERIFIED [K-npm]
  * The public `report*` API has **no timestamp parameter**: `ReportCustomEventArgs` takes only `{name|id, value}`, so events are stamped with the current time. VERIFIED [K-npm] [K-speed]
  * Custom events need a codegen-generated `customEventSet`. VERIFIED [K-custom-sdk]
* **Recommendation (INFERRED): call the JSON REST API from a ~100-line TypeScript client instead.** That gives us:
  * explicit timestamps (needed to backfill realistic history and to stamp events when the call actually happened)
  * deterministic idempotency
  * no disk queue to manage on Vercel
  * no codegen step

---

## 5. Entity model

* **One batch maps to one entity id.** There is no "entity type" field. VERIFIED [K-swagger] [K-speed]
* **Entity ids must be UUIDs.** For string ids, Keewano says to derive the UUID with **UUID v5** (`uuid5(NAMESPACE_URL, "machine-7")`), which always maps the same string to the same UUID. Over REST, send it as `installId`. VERIFIED [K-speed]
* **Can one event belong to several entities?** No: the batch carries one identity. VERIFIED [K-swagger]
  * To show an event on several timelines, send it once per entity. INFERRED
* **Multiple entity kinds:** the docs show only the one id space, read as `user_id` in SQL and `user.id` in Lua. VERIFIED [K-sql] [K-luaref]
  * INFERRED: model kinds by deriving ids from namespaced keys (`rel:<user>:<org>`), and send an `entity_kind("relationship")` string event first in each batch.
  * Because columns hold forward, `WHERE entity_kind = 'relationship'` then selects whole streams of that kind. The step-function behaviour is VERIFIED [K-sql]; this use of it is INFERRED.
* **Billing counts every distinct id:** "Any entity that generated at least one event in the billing cycle … We count distinct identifiers that you send us." VERIFIED [K-pricing]
  * INFERRED: fan-out multiplies the MAU count. It's harmless at hackathon scale, especially with the unlock.
* **userId vs installId:**
  * The SDKs use `userId` to recognise one person across installs. VERIFIED [K-sdks]
  * INFERRED (safest): send `installId` and `userId` set to the **same** entity UUID, so `user_id` in SQL is unambiguous. Confirm on site which value SQL `user_id` and Lua `user.id` show.

---

## 6. Reading and querying

### 6.1 SQL over the Postgres wire protocol (the documented programmatic read path)

* **Connection:**
  * host `pgsql.keewano.com`, port **27543**
  * user: your Keewano login email
  * password: the PAT (`kwpat-…`)
  * database: the **project UUID** (Settings → Details → Project ID)
  * **TLS required** (`sslmode=require`)

  Any Postgres client works (psql, JDBC/ODBC, BI tools), so INFERRED: the Node `pg` package works too. VERIFIED [K-sql]
* **Limits:** 16 KB per statement, **50 MB per result**, about **2 minutes per query**. Repeated failed logins are throttled. VERIFIED [K-sql]
* **Model:**
  * There is one read-only table, `events`, with one row per event occurrence. VERIFIED [K-sql]
  * **Every event type is its own column**, named exactly like the event (quote names that aren't plain lowercase). VERIFIED [K-sql] [K-speed]
  * Columns are **step functions**, so `WHERE` selects *stretches* of each timeline, and `AND`/`OR`/`NOT` act as interval intersection, union and complement. VERIFIED [K-sql]
  * Four columns always exist: `user_id` (text), `event_datetime`, `user_registration_time`, `user_last_activity_time`. VERIFIED [K-sql]
  * There is **no generic "event_name" column**. VERIFIED [K-sql] (the column list)
* **What isn't supported, and the replacements:**
  * No JOINs, CTEs, window functions, UNION, writes, string building or `generate_series`.
  * Use `FROM (SELECT …) alias` subqueries, `occurrence(col)` ordinals, and `count(col)` in `WHERE` as a per-entity gate (combined with `AND` only).
  * `FILTER (WHERE …)` samples values at specific *instants*, such as "the amount in effect when the commitment was made". VERIFIED [K-sql] [K-sqlref]
* **Capacities:** 16 selected columns, 16 aggregates, 16 distinct event columns, 8 `GROUP BY` columns, and 64 values in `LIKE`/`IN` together. Exceeding any is an explicit error, never silent truncation. VERIFIED [K-sqlref]
* **Text comparison:** comparisons are **case-insensitive**, and a literal that matches no label returns nothing rather than an error. VERIFIED [K-sqlref]
  * INFERRED: a wrong-format entity id would silently return zero rows.
* **Bare-column projection:** "Selecting bare columns with no aggregate and no GROUP BY emits one row per occurrence of the driving columns". VERIFIED [K-sqlref]
  * INFERRED: how this behaves with several event columns in one SELECT needs testing. Until then, one query per event type is the safe way to build a timeline.
* **Telo SQL sketches.** These are INFERRED and untested, built from the semantics above. Names follow the catalog in §10.2.
  ```sql
  -- commitments on one user×business relationship timeline, oldest first
  SELECT event_datetime AS t, commitment_received AS kind
  FROM events
  WHERE user_id = '<relationship-uuid>'
  ORDER BY t;

  -- amount in effect at each commitment instant (works because context is sent before the anchor)
  SELECT max(commitment_amount_cents) FILTER (WHERE commitment_received IS NOT NULL) AS cents
  FROM events WHERE user_id = '<relationship-uuid>';

  -- relationships with a commitment but no fulfillment (cohort gate)
  SELECT count(DISTINCT user_id) AS open_rels
  FROM events
  WHERE count(commitment_received) >= 1 AND count(commitment_fulfilled) = 0;

  -- typical hold time per business (population query: something only Keewano answers)
  SELECT user_id AS org, avg(hold_seconds) AS avg_hold, count(hold_seconds) AS calls
  FROM events WHERE entity_kind = 'org' GROUP BY user_id ORDER BY calls DESC LIMIT 20;
  ```

### 6.2 Lua (the native per-entity, in-order interface)

* **Script contract:** four fixed globals.
  * `partial`: a bounded accumulator for each group of users.
  * `process_user(user, events)`: called once per entity, with `events` in time order and **0-based** (`events.count`, `events[i].id`, `.data`, `.timestamp`).
  * `reduce(partials)`: merges the groups.
  * `output`: becomes the JSON result.

  VERIFIED [K-lua] [K-luaref]
* **Finders** are native scans and often more than 10× faster than a Lua loop: `find_next/prev`, `find_next_data`, `find_next_with_ids` (up to 8 ids), and `find_next_gap_in_time` (session splitting). VERIFIED [K-luaref]
* **Chains** read multi-field records laid out as an anchor event followed by detail events (`kdb.chain{…}`). VERIFIED [K-lua]
* **Names and values:**
  * Resolvers turn names into ids at upload: `kdb.resolve_event_id("...")`, `kdb.resolve_event_data("...")`.
  * Output markers turn them back into text, in `reduce` only: `kdb.event_name(id)`, `kdb.event_data_text(id, data)`.
  * `params` passes inputs (max 1 MiB). VERIFIED [K-luaref]
* **Limits:**
  * 64 MiB per script in map, 128 MiB in reduce
  * about **200 µs per user × user count** in map, 60 s in reduce
  * 16 KiB of script
  * sandboxed: no `io`, `os`, `string`/`table` libraries, `pcall`, `tostring` or `math.random`

  VERIFIED [K-luaref]
* **How to run Lua:**
  * The SpeedHacks page says the MCP agent has "SQL queries, Lua script queries and a few other tools". VERIFIED [K-speed]
  * A REST or Postgres route for Lua is **not documented**, so must be asked on site.
* **Lua timeline sketch for one entity.** UNTESTED and INFERRED; check the param-handling rules on site.
  ```lua
  partial = {}; partial.n = 0; partial.rows = {}
  output = {}
  local target = params.entity_id            -- relationship UUID string
  local since  = params.since or 0           -- unix seconds

  function process_user(user, events)
    if user.id ~= target then return end      -- only one entity contributes rows (bounded)
    local i = 0
    while i < events.count do
      local ev = events[i]
      if ev.timestamp >= since then
        partial.n = partial.n + 1
        partial.rows[partial.n] = { id = ev.id, data = ev.data, ts = ev.timestamp }
      end
      i = i + 1
    end
  end

  function reduce(partials)
    output.events = {}
    local k = 0
    for _, p in ipairs(partials) do
      for j = 1, p.n do
        local r = p.rows[j]; k = k + 1
        output.events[k] = { event = kdb.event_name(r.id), value = kdb.event_data_text(r.id, r.data), ts = r.ts }
      end
    end
  end
  ```

### 6.3 MCP for agents

* **Connection:**
  * URL `https://api.keewano.com/mcp`
  * transport: **Streamable HTTP**
  * auth: header **`k-token: <PAT>`**

  Configs for Claude Code (`claude mcp add … --header "k-token: …"`), Claude Desktop (an `mcp-remote` bridge) and generic clients are documented. VERIFIED [K-mcp]
* **Behaviour without credentials:**
  * Unauthenticated GET or POST `initialize` returns **401** `{"statusCode":401,"message":"Missing API key"}`. VERIFIED (probed 2026-10-10, no credentials sent)
  * `/.well-known/oauth-*` returns 404. VERIFIED, same probe
  * INFERRED: auth is static-header only, with no OAuth.
* **Tools:**
  * Keewano's description: "Let your agent ask in plain English over MCP; it picks the right tool and writes the query. Under the hood it has SQL queries, Lua script queries and a few other tools." VERIFIED [K-speed]
  * The marketing page lists six tool groups: Events and Entities (timelines, event retrieval…), Reports and Charts, Similarity and Patterns, Outcomes and Contributing Factors, Monitoring and Actions, and Semantics and Definitions. **No tool names or schemas are published.** VERIFIED [K-mcp-site]
* **Plan cap:** the Free plan allows **25 tool calls/day**; the `#SpeedHacks` unlock gives "MCP access" with no limits. VERIFIED [K-pricing] [K-speed]
* INFERRED: if an LLM vendor's hosted MCP connector only accepts OAuth or bearer tokens, run the MCP client inside our server instead (MCP TypeScript SDK, Streamable HTTP transport with custom headers) and hand the tools to the model ourselves.

### 6.4 Keewano Ask and Data Tables (inside the web app)

* **Keewano Ask:** plain-language questions answered with a chart, "Key findings", follow-ups and streamed reasoning. Answers are scoped to the project and can be shared to Slack. VERIFIED [K-ask]
  * No public API for Ask is documented. Paid plans bundle "agent credits" for the web, Slack and Signal agents; Free gets 500 one-time. VERIFIED [K-pricing]
* **Data Tables:**
  * include **Sequence count** ("how often a defined sequence of events occurred, within a window") and **Absence count** ("how often an expected event did not occur within a period") measures
  * allow at most 32 metrics, and 5 breakdowns and segments combined

  VERIFIED [K-tables]
  * INFERRED: Absence count is a natural fit for "credit promised but never applied".

---

## 7. Limits and pricing

* **Free plan:**
  * $0, "not a trial", no card required
  * up to **3M events/month** and **10,000 MAU** (any entity with at least one event in the cycle)
  * **2 seats**, **6-month retention**
  * **MCP: 25 tool calls/day**, 500 agent credits (one-time)
  * SQL Query Studio and custom events included

  VERIFIED [K-pricing]
  * Blocks & Files reported a 27,000 MAU free limit. INFERRED that the article is out of date; the official pricing page says 10,000.
* **Going over Free limits:** the project goes **read-only**: data and queries keep working, but ingestion pauses until you upgrade. VERIFIED [K-pricing]
* **Paid plans** (monthly; −30% annually), all with unlimited events and unlimited MCP tool calls. VERIFIED [K-pricing]

  | Plan | Price from | MAU | Retention |
  |---|---|---|---|
  | Starter | $213/mo | 100K | 12 months |
  | Growth | $856/mo | 500K | 24 months |
  | Scale | $3,570/mo | 1M | 36 months |
* **The `#SpeedHacks` unlock:** "no limits, MCP access and team seats". VERIFIED [K-speed]
* **Query and script limits:** see §6.1 (SQL) and §6.2 (Lua). VERIFIED
* **Payload limits:** strings ≤ 256 chars; REST body ≤ 100 KB. VERIFIED [K-speed] [K-npm]

---

## 8. Privacy, redaction and deletion

* **No deletion or redaction API exists in the docs or the OpenAPI spec.**
  * SQL is read-only: "`INSERT` / `UPDATE` / `DELETE` / DDL: The engine only reads". VERIFIED [K-sql]
  * The TS SDK: "The SDK exposes no call that deletes data already delivered; handle that erasure outside it." VERIFIED [K-privacy-sdk]
  * Consent withdrawal only deletes batches still queued *on the device*. VERIFIED [K-privacy-sdk]
* **Privacy policy:**
  * Keewano acts as a **processor** for customer end-user data. End users must contact the Keewano customer (us).
  * Our own rights requests go to **privacy@keewano.com**.
  * "Once no longer required, data is deleted or anonymized."
  * No timelines are given.

  VERIFIED [K-pp]
* **Terms:**
  * Cancelling the account (by email to contact@keewano.com from the account email) deletes content "immediately", with no recovery. VERIFIED [K-tos]
  * The Terms place no explicit restriction on sending PII. VERIFIED [K-tos]
* **Keewano's own data guidance:**
  * "Events, not logs … Turn text into a category before sending, and keep raw text elsewhere under an id." VERIFIED [K-speed]
  * The example table explicitly says to send `IntentDetected("reschedule")`, **not the call transcript**. VERIFIED [K-speed]
* **What Telo must do (INFERRED):**
  1. Never send names, phone numbers, account or card numbers, addresses, transcripts or other free text. Send categories, cents, seconds and flags only.
  2. Keep sensitive details in our own store, keyed by our event id, so we can delete them.
  3. Derive entity UUIDs with a **secret UUID v5 namespace** (an environment variable). Phone numbers are low-entropy, so a public namespace would let anyone brute-force `uuidv5(phone)` back to the number. Deleting our own key mapping then leaves the Keewano stream pseudonymous.
  4. For a full erasure request, email privacy@keewano.com, or use a throwaway project per demo and delete it.
  5. Treat business-issued confirmation codes (for example "A1832") as low-sensitivity labels that may be sent. Make this a per-fact policy flag, so it can be switched off.

---

## 9. Keewano's data-modeling guidance

These come from the SpeedHacks page, the SQL guide and Keewano's official Claude Code skill. All are VERIFIED [K-speed] [K-sql] [K-skill].

* **Entity:** "whoever the story is about". For string ids, use UUID v5 of the string.
* **Event shape:** `Name(value)`, one typed value per event type, and the value type is fixed forever.
* **More than one detail:** "Send the context first, as its own event … then [the anchor]". Every later event carries the latest value of the earlier ones.
* **Events, not logs:**
  * "If you'd grep it, it's a log; if you'd count it, it's an event."
  * Turn text into categories.
  * Strings are at most 256 characters.
* **From the skill:**
  * "events are small and parameter-light; the backend reconstructs context from the temporal sequence … **The history is the context.**"
  * "Don't pre-aggregate."
  * "State is derived, not sent. Send deltas, not snapshots."
  * Each discrete action is its own event.
* **Naming:**
  * action names, a consistent vocabulary and one casing convention
  * "No concatenated strings at runtime": a unique string per value bloats the backend and fragments aggregation
  * keep strings stable, and put the variable part in the typed value
* **Scopes:**
  * Bracket activities with an opener and closer, matched by the same id, so they can be measured.
  * "Outcome = which closer fires."
  * Don't add attempt or visit counters; the backend counts repeats.
  * Custom scopes and record families can be configured by Keewano ("ask your Keewano contact").
* **SQL-friendly names:** event names become column names, so names that aren't plain lowercase need double quotes in SQL, and dotted names confuse BI tools. Hence the **snake_case** names in §10.2.
* **Test traffic:** use separate dev and prod projects; mark QA users (`testUserName`).

---

## 10. Telo mapping (proposal)

Everything in this section is INFERRED: it is my design, built on the verified facts above.

### 10.1 Entities and ids

| Kind | Key (input to UUID v5 with the secret namespace) | Purpose | Recommended? |
|---|---|---|---|
| `relationship` | `rel:<userId>:<orgId>` | **Primary memory.** Everything that happened between this user and this business, in order. The pre-call brief reads this stream. | Yes |
| `org` | `org:<orgId>` (`orgId` = our normalized business id, not a raw phone number) | Cross-user business behaviour: hold times, offers it makes, how often its commitments get broken. Gets categories and amounts only, never per-user confirmation codes. | Yes |
| `task` | `task:<taskId>` | Task lifecycle and outcome; the "self-improving loop" metrics. | Yes |
| `user` | `user:<userId>` | Approvals and messages across businesses. | Optional |
| `call` | `call:<dialCallId>` | Per-call sequence. Calls are better modelled as **scopes** inside the relationship and task streams (`call_started` … `call_ended`), which avoids fan-out and extra MAU. | Optional |

Send `installId = userId = uuidv5(key, TELO_NS)`, and start every batch with `entity_kind(<kind>)`.

### 10.2 Custom event catalog (register once; append-only; hash = FNV-1a/CRC32 of the list, never 0)

| id | name | dataType | Telo source and value |
|---|---|---|---|
| 2000 | `entity_kind` | string | first event of every batch: `user`, `task`, `org`, `call` or `relationship` |
| 2001 | `task_created` | string | `task.created` → task kind (`cancel_membership`, `dispute_bill`, `get_quote` …) |
| 2002 | `task_completed` | string | `task.completed` → outcome (`resolved`, `partial`, `failed`, `abandoned`) |
| 2003 | `memory_brief_used` | bool | context before `call_started`: did the call plan include a Keewano brief? (the before/after metric) |
| 2004 | `call_started` | string | `call.started` → purpose (task kind) |
| 2005 | `hold_seconds` | uint | context for `call_ended` |
| 2006 | `call_duration_seconds` | uint | context for `call_ended` |
| 2007 | `call_ended` | string | `call.completed` / `call.failed` → outcome (`resolved`, `callback_scheduled`, `escalated`, `refused`, `no_answer`, `voicemail`, `dropped`) |
| 2008 | `offer_amount_cents` | price_usd_cent | context for `offer_received` |
| 2009 | `offer_received` | string | `offer.received` → offer kind (`retention_discount`, `quote`, `fee_waiver`, `payment_plan`) |
| 2010 | `offer_accepted` | string | `offer.accepted` → offer kind |
| 2011 | `offer_declined` | string | `offer.declined` → offer kind |
| 2012 | `confirmation_number` | string | context: a business-issued code such as `A1832` (policy-gated, relationship stream only) |
| 2013 | `commitment_amount_cents` | price_usd_cent | context for `commitment_received` |
| 2014 | `commitment_due_at` | timestamp | context for `commitment_received` |
| 2015 | `commitment_received` | string | `commitment.received` → kind (`account_credit`, `refund`, `callback`, `cancellation`, `fee_waiver`) |
| 2016 | `commitment_fulfilled` | string | `commitment.fulfilled` → kind |
| 2017 | `commitment_broken` | string | `commitment.broken` → kind |
| 2018 | `confirmation_received` | string | `confirmation.received` → what it confirms (`cancellation`, `dispute`, `credit`, `appointment`) |
| 2019 | `approval_amount_cents` | price_usd_cent | context for `approval_requested` |
| 2020 | `approval_requested` | string | `approval.requested` → kind (`accept_offer`, `pay_fee`, `share_info`) |
| 2021 | `approval_granted` | string | `approval.granted` → kind |
| 2022 | `approval_denied` | string | `approval.denied` → kind |
| 2023 | `message_sent` | string | `message.sent` → channel (`sms`, `email`, `in_app`) |

**Example.** "On Oct 2 a rep promised a $20 credit under confirmation A1832, due Oct 9" becomes one batch for the relationship entity. All events share the call's timestamp, with context first and the anchor last:
`entity_kind("relationship")`, `confirmation_number("A1832")`, `commitment_amount_cents(2000)`, `commitment_due_at(1791504000)`, `commitment_received("account_credit")`.

The same domain event also goes to the `org` entity, minus `confirmation_number`, and to the `task` entity.

### 10.3 Pre-call memory flow

1. **Before dialing business O for user U**, call `memory.timeline({ entity: rel(U,O), since: now − 180d })`. This is a live Keewano query, which is what the judge wants to see.
2. **Cover the ~5-minute ingestion lag.** The Keewano adapter keeps a short-lived local write-through cache (for example, the last 15 minutes) and merges and dedupes it with Keewano's rows.
   * Keep the cache short, so Keewano stays load-bearing.
   * Population questions ("does this business usually honour credits?", typical hold time) come only from Keewano.
3. **Build the brief deterministically:**
   * open commitments (received with no later fulfilled or broken)
   * last offers
   * confirmation codes
   * last call outcome
   * the org's typical hold time, from the org stream
4. **Inject the brief** into the Dial call plan, as at most 5 lines in the system prompt. Record `memory_brief_used(true)`.
5. **"Ask anything" path:** an LLM with the Keewano MCP tools in operator mode, for the judge's unexpected question. The trace of SQL or Lua queries is shown in the UI.
   * For user-facing asks, scope to the user's own entity UUIDs. Better still, run our parameterized query and give the LLM only the result, so one tenant can't read another's data.

### 10.4 Demo metric for the "bottleneck removed" bonus

Compare calls with and without `memory_brief_used`, both measured in Keewano:

* calls-to-resolution per task
* `hold_seconds`
* share of commitments later marked `commitment_broken` and then escalated

Backfill two weeks of realistic history through REST (Keewano's own suggestion [K-speed]), then send live events during the demo.

---

## 11. TypeScript adapter (local stand-in now, Keewano later)

Backend-neutral contract. `LocalEventMemory` implements it today, using SQLite or a JSON file with the same semantics. `KeewanoEventMemory` swaps in later, chosen by `MEMORY_BACKEND=local|keewano`. INFERRED design.

```ts
// src/memory/types.ts
export type EntityKind = 'user' | 'task' | 'org' | 'call' | 'relationship';

/** A timeline owner. `key` is our stable app id; adapters derive the Keewano UUID (v5, secret namespace). */
export interface EntityRef { kind: EntityKind; key: string }

export type TeloEventType =
  | 'task.created' | 'task.completed'
  | 'call.started' | 'call.completed' | 'call.failed'
  | 'offer.received' | 'offer.accepted' | 'offer.declined'
  | 'commitment.received' | 'commitment.fulfilled' | 'commitment.broken'
  | 'confirmation.received'
  | 'approval.requested' | 'approval.granted' | 'approval.denied'
  | 'message.sent';

/** Typed, low-cardinality facts. Maps 1:1 to catalog events (strings <= 256 chars; money in cents). */
export interface Facts {
  taskKind?: string; outcome?: string; purpose?: string; offerKind?: string;
  commitmentKind?: string; confirms?: string; approvalKind?: string; channel?: string;
  amountCents?: number; holdSeconds?: number; durationSeconds?: number;
  dueAt?: Date; confirmationNumber?: string; briefUsed?: boolean;
}

export interface RecordInput {
  type: TeloEventType;
  occurredAt: Date;                 // real event time; Keewano REST accepts explicit unix-seconds timestamps
  entities: EntityRef[];            // fan-out: one Keewano batch per entity
  idempotencyKey: string;           // e.g. `${callId}:commitment:0`; same key => no duplicates
  facts?: Facts;                    // safe to share; per-kind fact policy decides what each entity gets
  privateDetails?: Record<string, unknown>; // transcript snippets, rep name, etc. LOCAL ONLY
}

export interface RecordReceipt {
  idempotencyKey: string; entity: EntityRef;
  status: 'accepted' | 'duplicate' | 'partial' | 'queued' | 'rejected';
  detail?: string;
}

export interface TimelineEvent {
  entity: EntityRef; type: TeloEventType; occurredAt: Date; facts: Facts;
  idempotencyKey?: string;          // present when served from the local store/cache
  source: 'local' | 'keewano';
}

export interface TimelineQuery {
  entity: EntityRef;
  types?: TeloEventType[];
  since?: Date; until?: Date;
  last?: number;                    // keep the most recent N; result is always oldest-first
}

export interface AskInput { question: string; scope?: EntityRef[]; since?: Date }

export interface AskResult {
  answer: string;
  evidence: TimelineEvent[];        // events the answer cites
  trace: { via: 'sql' | 'lua' | 'mcp' | 'local'; request: string }[]; // show the live query in the demo
}

export interface EventMemory {
  record(events: RecordInput[]): Promise<RecordReceipt[]>;
  timeline(q: TimelineQuery): Promise<TimelineEvent[]>;
  ask(input: AskInput): Promise<AskResult>;
  /** Deletes local details/cache; Keewano has no deletion API, so remote erasure is a manual request. */
  forget(entity: EntityRef): Promise<{ deletedLocal: number; remote: 'unsupported' | 'requested' }>;
}
```

**How `KeewanoEventMemory` maps onto Keewano** (the verified mechanics are in §4–§6):

* **`record`** works in five steps.
  1. On startup, register the catalog: POST `/json/custom`, then poll GET until it returns 200. A 409 means we forgot to change the hash.
  2. For each `(event, entity)` pair, expand the facts into catalog events in context-first order, applying the per-kind fact policy.
  3. POST `/json/in` with:
     * `dataSessionId = uuidv5(idempotencyKey + '|' + entityUuid)`
     * `batch: 1`
     * `installId = userId = entityUuid`
     * `customEventsHash`
     * `sdkVersion: 'telo/0.1'`
  4. Handle the receipt:
     * `accepted === received` → `accepted`
     * `accepted === 0` → `duplicate` (do not retry)
     * otherwise → `partial`
     * 400/401/403/413 → `rejected`
     * everything else → retry with backoff (`queued`)
  5. Write the same rows to the local cache.
* **`timeline`:**
  * First, the local cache (read-your-writes).
  * Then Keewano: SQL over `pg` (one projection query per needed event column, `WHERE user_id = $entityUuid`), or the MCP Lua tool once its schema is known.
  * Merge and dedupe on `(entity, type, occurredAt, facts)`.
* **`ask`:** an LLM loop with Keewano MCP tools (`k-token: PAT`). The system prompt includes the catalog and the relevant entity UUIDs, and the trace returns the tool calls.
* **`LocalEventMemory`:**
  * Append-only rows `{entityKind, entityKey, seq, type, occurredAt, facts, idempotencyKey, privateDetails}`, unique on `(idempotencyKey, entityKey)`, ordered by `(occurredAt, seq)`.
  * `ask` hands the serialized timeline to the LLM, with no tools.

**Helpers** (Node, no dependencies):

```ts
import { createHash } from 'node:crypto';

/** RFC 4122 UUID v5. Use a SECRET namespace (env) so ids can't be brute-forced from phone numbers. */
export function uuidv5(name: string, namespace: string): string {
  const h = createHash('sha1').update(Buffer.from(namespace.replace(/-/g, ''), 'hex')).update(name, 'utf8').digest();
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** Non-zero uint32 hash naming one exact catalog list (Keewano: any non-zero integer). */
export function catalogHash(catalog: unknown): number {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(JSON.stringify(catalog))) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h || 1;
}

export const KEEWANO_INGEST = 'https://api.keewano.com/event/ingress/v1/json'; // /in, /custom
export type KDataType = 'none' | 'string' | 'uint' | 'bool' | 'timestamp' | 'ushortvec2' | 'price_usd_cent';
export interface KEvent { eventTypeId: number; timestamp: number; dataType: KDataType; data?: string | number | boolean | null }
export interface KBatch {
  dataSessionId: string; batch: number; customEventsHash: number;
  installId: string; userId?: string; sdkVersion?: string; events: KEvent[]; // events non-empty, chronological
}
```

**Environment variables:**

* `KEEWANO_API_KEY`: SDK-type project key, for writing.
* `KEEWANO_PAT`: `kwpat-…`, for SQL and MCP reads.
* `KEEWANO_PROJECT_ID`: the project UUID, used as the Postgres database name.
* `KEEWANO_PG_USER`: the login email.
* `TELO_ENTITY_NS`: the secret UUID namespace.

Use the Node runtime in Next.js route handlers, because `pg` needs TCP (INFERRED).

---

## 12. Gaps: what to get from Keewano on site (Vitaly Bukhovsky / Karen Teboulle)

1. **Turn on `#SpeedHacks` for our project**, and confirm there's no MCP daily cap and no MAU or event cap. What is the request-rate limit on `/json/in`?
2. **MCP tool list with input/output schemas:** the SQL tool, the Lua tool, any timeline/entity tool, and any "ask" tool that runs Keewano's own analyst. What does the result payload look like? Does `/mcp` also accept `Authorization: Bearer <PAT>`, for hosted connectors?
3. **Lua outside MCP:** can Lua run over the Postgres wire or a REST query endpoint? The site advertises "REST" answers, but none is documented. Can a string param be compared with `user.id` (see the §6.2 sketch)?
4. **Ids:** sending only `installId`, only `userId`, or both: what appears in SQL `user_id` and Lua `user.id`, and in what format and case? Is `WHERE user_id = '<uuid>'` supported and fast for single-entity reads?
5. **Freshness:** is "about 5 minutes" the typical or the worst-case delay before SQL or MCP can see events? Can we flush or force visibility for the demo?
6. **Ordering:**
   * Do events with the same timestamp keep their array order?
   * Are late batches with older timestamps sorted into place?
   * How far back may backfill go, and are future timestamps allowed (for example, `commitment_due_at` is a value, but what about event times)?
7. **Idempotency pattern:** is one `dataSessionId` per logical write with `batch: 1` fine? Does each data session count as a "session" anywhere in analytics?
8. **Custom events:**
   * How many types can we have, and what are the name rules (snake_case, length)?
   * After re-registering a superset under a new hash, can batches using old and new hashes be mixed?
   * Is a high-cardinality string (confirmation codes) acceptable?
9. **Multiple entity kinds in one project:** is the `entity_kind` marker the recommended approach, or should we use separate projects? Can they configure a **record family** (commitment = kind + amount + due date + confirmation) and a **scope** (`call_started`…`call_ended`) for us?
10. **Deletion:**
    * Is there any way to delete one entity's stream or specific events (GDPR erasure), and how fast?
    * Does deleting a project delete its data immediately?
    * How is raw event export done? The skill says "Raw event export is available".
11. **Import (bulk):** the docs still show placeholders ("[[ Parquet / CSV / JSON — confirm ]]") [K-connect], so ask whether a bulk path exists. It isn't needed if REST backfill is enough.

---

## 13. Appendix: raw material saved locally

All files are under `research/raw/` next to this file.

| File | Contents |
|---|---|
| `docs-llms.txt`, `docs-llms-full.txt` | Keewano docs index and full text |
| `ingress-openapi.json` | REST Ingestion OpenAPI, extracted from the Swagger UI init script |
| `ts-sdk-docs/*.md` | TypeScript SDK docs: nodejs, custom-events, privacy, data-format, codegen, event-types, configuration |
| `py-sdk-docs/` | Python SDK README and docs list |
| `skill-SKILL.md` | Keewano's official Claude Code skill |
| `pricing.txt`, `overview.txt`, `use-cases.txt`, `analytics.txt` | Marketing pages as text |
| `dial-context-mcp.md`, `dial-docs-llms.txt` | Dial docs |
| `gh-repos.json` | Keewano GitHub org repos |

The unpacked npm packages are in `scratchpad/pkgs/keewano-node-sdk/x/package` and `scratchpad/pkgs/keewano-core/x/package`; only their READMEs and `.d.ts` files were read.

### Searched and not found

| Where | Result |
|---|---|
| npm | `keewano`, `keewanodb`, `@keewano/sdk`, `@keewano/db`, `@keewano/mcp`, `keewano-mcp`: 404. The real packages are under `@keewano/*` (node-sdk, core, web-sdk, react-native-sdk, react-native-expo-sdk, codegen). |
| PyPI | Only `keewano-sdk` exists (`keewano`, `keewanodb`, `keewano-db` and `keewano-mcp` are 404). Docs mention `keewano-codegen`, but it isn't on PyPI yet. |
| Docker Hub | 0 results |
| Official MCP registry | 0 results |
| `developers.keewano.com`, `db.keewano.com` | No DNS |
| keewano.com `/docs`, `/developers`, `/api`, `/blog`, `/product`, `/db-local`, `/keewanodb` | 404 |
| `luma.com/keewano` | Only Zoom demos and office hours; no SpeedHacks listing |

[K-llms]: https://docs.keewano.com/llms-full.txt
[K-what]: https://docs.keewano.com/getting-started/readme
[K-connect]: https://docs.keewano.com/getting-started/connecting-to-keewano
[K-speed]: https://docs.keewano.com/getting-started/speedhacks-quickstart
[K-swagger]: https://api.keewano.com/event/ingress/v1/json/swagger
[K-sql]: https://docs.keewano.com/sql-query-studio/guide
[K-sqlref]: https://docs.keewano.com/sql-query-studio/reference
[K-lua]: https://docs.keewano.com/lua-scripting/guide
[K-luaref]: https://docs.keewano.com/lua-scripting/reference
[K-mcp]: https://docs.keewano.com/analytics/mcp-for-agents
[K-ask]: https://docs.keewano.com/analytics/keewano-ask
[K-tables]: https://docs.keewano.com/analytics/data-tables
[K-sdks]: https://docs.keewano.com/sdks/choosing-an-sdk
[K-codegen]: https://docs.keewano.com/sdks/custom-events-codegen
[K-node]: https://github.com/Keewano/TypeScript-SDK/blob/main/docs/nodejs.md
[K-npm]: https://www.npmjs.com/package/@keewano/core
[K-custom-sdk]: https://github.com/Keewano/TypeScript-SDK/blob/main/docs/custom-events.md
[K-privacy-sdk]: https://github.com/Keewano/TypeScript-SDK/blob/main/docs/privacy.md
[K-skill]: https://github.com/Keewano/Keewano-UnitySDK-ClaudeCode-Skill
[K-gh]: https://github.com/Keewano
[K-home]: https://www.keewano.com
[K-pricing]: https://www.keewano.com/pricing
[K-mcp-site]: https://www.keewano.com/mcp-for-agents
[K-cloud]: https://www.keewano.com/db-cloud
[K-usecases]: https://www.keewano.com/use-cases
[K-pp]: https://www.keewano.com/privacy-policy
[K-tos]: https://www.keewano.com/terms-and-conditions
[E-partiful]: https://partiful.com/e/tthQk11QYKKZJRKvLGBQ
[E-hsq]: https://hackersquad.io/events/speedhacks-oct11
[D-ctx]: https://docs.getdial.ai/documentation/platform/context-mcp
[P-vb]: https://venturebeat.com/data/every-user-device-and-agent-gets-its-own-table-in-keewanodb-and-queries-never-join-across-them
[P-bf]: https://www.blocksandfiles.com/ai-ml/2026/09/21/keewanodb-stores-events-for-agent-analysis/5297780
