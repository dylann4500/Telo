# Telo

Telo is a hackathon app (SpeedHacks, Oct 11 2026): you text or call Telo, and it handles phone tasks with Dial voice calls, Claude reasoning and Keewano event memory. Read README.md first; developer notes are in docs/architecture.md; sponsor API facts are in docs/integrations/.

- Next.js 16.4 with Cache Components on. Read node_modules/next/dist/docs/ before using an API you haven't checked (see AGENTS.md).
- Run with `npm run dev` (port 3210). Test with `npm test` (vitest; end-to-end on the simulated stack). Typecheck with `npm run typecheck`.
- With no keys, everything runs on simulations: the rule-based stand-in in `src/server/agent/mock-llm.ts`, the simulated phone line in `src/server/voice/mock.ts` with scripts in `mock-scenarios.ts`, and the local memory provider. Keep the demo scenarios working on it.
- Every task state change goes through `transitionTask` (compare-and-swap). Never update `tasks.status` directly.
- Only typed, low-cardinality values go to Keewano (no names, transcripts or free text). It has no delete API.
- Never dial a number nobody gave Telo. `tests/safety.test.ts` guards this.
- Changing the DB schema: edit `src/server/db/schema.ts`, then run `npm run db:generate`. Migrations apply on startup.
- The UI is a mirror. The product is the text and call conversation, so don't grow the dashboard into the main interface.
