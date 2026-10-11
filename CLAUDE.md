# Telo

Telo is a hackathon app (SpeedHacks, Oct 11 2026): the AI that works the phones for small rental property managers. Tenants call or text it, it calls vendors in parallel, gets the owner's OK while a vendor holds, books the tenant's window with the entry notice and follows up, on Dial voice calls, Claude reasoning and Keewano event memory. Read README.md first; developer notes are in docs/architecture.md; the product brief and research are in docs/property-management/; sponsor API facts are in docs/integrations/.

- Next.js 16.4 with Cache Components on. Read node_modules/next/dist/docs/ before using an API you haven't checked (see AGENTS.md).
- Run with `npm run dev` (port 3210). Test with `npm test` (vitest; end-to-end on the simulated stack). Typecheck with `npm run typecheck`. After `npm run build`, delete `.next` before `npm run dev`: the production output sends the dev server into a page-reload loop.
- With no keys, everything runs on simulations: the rule-based stand-in in `src/server/agent/mock-llm.ts`, the simulated phone line in `src/server/voice/mock.ts` with scripts in `mock-scenarios.ts`, and the local memory provider. Keep the demo scenarios working on it.
- Every task state change goes through `transitionTask` (compare-and-swap). Never update `tasks.status` directly.
- Only typed, low-cardinality values go to Keewano (no names, transcripts or free text). It has no delete API.
- Never dial a number nobody gave Telo. `tests/safety.test.ts` guards this.
- Changing the DB schema: edit `src/server/db/schema.ts`, then run `npm run db:generate`. Migrations apply on startup.
- The product is the text and call conversation. The dashboard is the manager's board for many jobs at once: keep it calm and scannable (a board by stage, live calls side by side, a flowchart per work order), never a wall of events.
- Work orders live in `src/server/maintenance.ts` and `src/server/portfolio/`. Their Keewano events carry `refs` (ids only) that pick the unit, vendor, owner, tenancy, asset and firm streams; the catalog is append-only (ids from 2026), and every new column needs a line in `COLUMN_NOTES`. Keewano rejects `count(...) FILTER (WHERE ...)`: put the condition in `WHERE`.
- Every call opens with the AI and recording disclosure, and spending above an owner's approval limit goes to the owner while the vendor holds. Legal notices, evictions, screening and payment details stay with people.
