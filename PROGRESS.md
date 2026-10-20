# PROGRESS.md - Project Tracking & Status

Source of truth for implementation status. An item is checked only when the cited evidence exists and was run.
Last verified: 2026-10-20 (`npm test` 83/83, `npm run typecheck` clean, `npm run build` clean, live browser run with real keys).

---

## Verified Working Model IDs
- **OpenCode Go (`OPENCODE_MODEL`)**: `deepseek-v4.1-flash`, primary provider, which passed `llm:smoke` (JSON and streaming) on 2026-10-20. The Go gateway returns 400 `MissingSessionID` unless each request carries `x-opencode-session`. The app sends its session ID there, plus a `hotseat/0.1` user agent, as the Go docs ask (`tests/opencode.test.ts`).
- **Gemini (`GEMINI_MODEL`)**: `gemini-2.5-flash`, which passed `llm:smoke` on 2026-10-20. The free-tier key then hit 429 quota limits, and every call in the live run below failed over to Groq.
- **Groq (`GROQ_MODEL`)**: `openai/gpt-oss-120b`, which passed `llm:smoke` on 2026-10-20. `llama-3.3-70b-versatile` returned 404 `model_not_found` for this account, so it was replaced via env only, with no code change.

---

## Step 1: Scaffold and Core Infrastructure
- [x] Next.js App Router, TypeScript strict, vanilla CSS design system (no Tailwind)
- [x] libSQL client; idempotent schema plus additive column migrations, auto-applied on first request (`getReadyDb`)
- [x] Env schema; model IDs read only from env; `DATABASE_AUTH_TOKEN` for Turso
- [x] LLM router: OpenCode Go → Gemini → Groq → local; Zod validation plus one repair retry; failover before first token only (`tests/router.test.ts`)
- [x] `llm_calls` logging; client-safe error messages (upstream detail logged server-side only)
- [x] Replay mode (`LLM_MODE=replay`) from `fixtures/llm/`, used by route-level tests
- [x] `npm run llm:smoke` against live keys (both providers passed individually; see model IDs above)

## Step 2: Ingestion and Editable Persona Card
- [x] Paste-first form (80-char minimum); retrying after a persona failure reuses the created session
- [x] LinkedIn best-effort fetch: https `*.linkedin.com` only, at most 2 redirects to LinkedIn hosts, 5s timeout, sign-in wall and 999 detection (`tests/scraper.test.ts`)
- [x] Persona generation with uncertain fields; regenerate returns the stored id (`tests/persona.test.ts` #2)
- [x] PATCH edits persist through a reload with `edited_by_user = 1`; invalid edits rejected (`tests/persona.test.ts` #3, #4)

## Step 3: Scenario Map and Strategic Questions
- [x] Single call: 4–6 categorized objections plus 5–7 phased questions (`tests/scenarios.test.ts`, `tests/golden-gate.test.ts` Gate 2)

## Step 4: Streaming Sparring Chat and Stance Meter
- [x] SSE route: tokens → persist → stance call → `stance` → `done` (`tests/chat.test.ts` #3)
- [x] Turn cap returns `TURN_CAP` without writing a turn (`tests/chat.test.ts` #4)
- [x] Ended sessions reject messages with `SESSION_ENDED` (`tests/chat.test.ts` #5)
- [x] Provider failure emits `LLM_UNAVAILABLE` and rolls back the user turn (`tests/chat.test.ts` #7)
- [x] Stance failure reported as unavailable (`stance: null`), never guessed
- [x] Client: buffered SSE parser, abort on unmount, retry with text restored, dictation without duplicated words

## Step 5: Evaluator, Rewrites, Objection Playbook, Cheat Sheet
- [x] `INSUFFICIENT_TURNS` below 2 user turns (`tests/evaluate.test.ts` #7)
- [x] Quotes must be verbatim within a single user turn; invalid quotes dropped, never backfilled (`tests/evaluate.test.ts` #1, #2, #4, #5, #8)
- [x] Rewrite and playbook turn numbers validated in the per-request schema, so a bad number gets the repair retry (`tests/evaluate.test.ts` #3)
- [x] `user_said` from the DB; overall score is the mean computed in code (`tests/evaluate.test.ts` #4, #6)
- [x] Objection Playbook (framework coaching for the hardest pushback) in schema, prompt, DB and report UI
- [x] Report: Markdown copy and download, print of the cheat sheet only

## Step 6: GATE - Golden Path
- [x] Route-level golden path on the Marcus Vance fixture: persona, scenarios, two chat turns, evaluation, reload restore, honest failure with no providers (`tests/golden-gate.test.ts` Gates 1–6)
- [x] `npm run build` passes
- [x] Manual live run of the demo script in the browser with real keys (2026-10-20):
  - Persona: risk_averse, high technical depth, with inferred-field highlighting.
  - Scenarios: 5 objections across all 4 categories, and 6 questions.
  - Chat: 2 turns, stances streamed live.
  - Evaluation: overall 5.8; technical answer credited and the budget dodge penalised; playbook "Acknowledge, Quantify, Prove, Commit"; all quotes verified.
  - Providers: all 14 LLM calls failed over from Gemini (429) to Groq, as logged in `llm_calls`.

- [x] Manual live run in Chrome on OpenCode Go / `deepseek-v4.1-flash` (2026-10-20):
  - All 7 LLM calls were served by `opencode` with status `ok` and no failover, as logged in `llm_calls`.
  - Persona 6s, scenarios 17s, chat turns about 3s each, evaluation about 45s.
  - Evaluation: technical answer credited and the pricing hedge penalised; playbook "Acknowledge, Baseline, Quantify, Commit".
  - LinkedIn fetch was blocked and showed the paste fallback, as designed.
  - Fixed after this run: evaluator prose said "Turn 3" where the UI says "message #2" (`tests/evaluate.test.ts` #9), and scores from 5 to 6.9 now read "Promising, Needs Sharpening" instead of "High Risk of Disqualification".

## Deployment Hardening
- [x] Removed `GET /api/sessions`, which listed the latest 50 sessions (profiles included) to anyone (`tests/security.test.ts` #1)
- [x] Session ids are `sess_` + a random UUID instead of a timestamp (#2)
- [x] Security headers: CSP, frame blocking, nosniff, referrer and permissions policies, HSTS in production; checked on a production build with no CSP violations
- [x] Per-IP rate limits on every API route, stored in libSQL, plus a global daily cap on AI requests; 429 `RATE_LIMITED` (#3–#7; 31st `end` call in an hour returned 429 on a production build)
- [x] Short-window limits: 20 requests/10s per IP across all routes, 30 AI requests/minute across all visitors (`GLOBAL_LLM_PER_MINUTE`), and one chat reply in flight per session (409 `BUSY`) (`tests/security.test.ts` #8–#10, `tests/chat.test.ts` #8–#10). On a production build the full flow ran with limits on, and 25 parallel requests gave exactly 20 × 200 and 5 × 429
- [x] ~~Optional `ACCESS_CODE` gate~~: added, then removed at the user's request so the live demo is open; rate limits remain the protection
- [x] `maxDuration` on AI routes (60s, evaluation 120s)

## Stretch: Live Company Research (Tavily)
- [x] Client: two parallel searches, 8s timeout, whole-word company filter, dedupe, never throws (`tests/research-client.test.ts`, 16 cases)
- [x] App: research at the scenarios step feeds the objection map and the persona's headlines; web text fenced as untrusted; stored per session and restored on reload; 24h per-company cache; `RESEARCH_DAILY_LIMIT` cap; honest skipped/unavailable reasons (`tests/research.test.ts`, 7 cases)
- [x] UI: sources panel on the briefing, opt-out checkbox; checked on a production build in replay mode, including phone width
- [ ] Live check with a real `TAVILY_API_KEY` on a real company

## Step 7: Stretch - Voice
- [x] Web Speech API detection; dictation into the chat input; TTS for persona replies; text-only fallback
