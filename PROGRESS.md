# PROGRESS.md - Project Tracking & Status

Source of truth for implementation status. Steps must be strictly completed and validated in sequence.

---

## Verified Working Model IDs
- **Gemini Model (`GEMINI_MODEL`)**: Pending live smoke verification
- **Groq Model (`GROQ_MODEL`)**: Pending live smoke verification

---

## Step Tracker

### [x] Step 1: Scaffold and Core Infrastructure
- [x] Initialize Next.js project with TypeScript strict mode
- [x] Configure vanilla CSS dark executive design system & tokens
- [x] Setup `@libsql/client` and idempotent SQLite migration script (`file:./data/app.db`)
- [x] Implement environment variable schema & validation
- [x] Implement seeded MD fixture: Marcus Vance (`fixtures/marcus-vance.json`)
- [x] Implement LLM router (`complete` & `stream`) with Gemini primary, Groq fallback, local dev option
- [x] Implement Zod schema validation & 1-shot repair retry for structured calls
- [x] Implement `llm_calls` database logging and typed error hierarchy
- [x] Implement replay mode (`LLM_MODE=replay`) from `fixtures/llm/`
- [x] Implement `llm:smoke` CLI script to verify Gemini and Groq live connectivity & model IDs
- [x] **Validation Criteria**:
  - [x] `llm:smoke` script operational (`npm run llm:smoke`)
  - [x] Router tests cover 429 failover, all-providers-fail error, repair retry success, invalid JSON twice (`npm test` passes 6/6)
  - [x] DB migration runs twice cleanly without errors (`npm run db:migrate`)
  - [x] Typecheck and unit tests green (`npm run typecheck` & `npm test`)

---

### [x] Step 2: Ingestion and Editable Persona Card
- [x] Paste-first input form (min 80 chars profile, meeting context fields)
- [x] LinkedIn best-effort route (`POST /api/ingest/linkedin`) with hostname allowlist (`linkedin.com`), 5s timeout, OpenGraph/meta tag extraction only
- [x] Persona generator route (`POST /api/sessions/[id]/persona`) with `uncertain_fields` detection
- [x] Editable Persona Card UI with visual highlighting of uncertain fields
- [x] Persona update persistence (`PATCH /api/sessions/[id]/persona` setting `edited_by_user = 1`)
- [x] **Validation Criteria**:
  - [x] Zod schema tests pass (`tests/persona.test.ts`)
  - [x] SSRF test blocks non-LinkedIn hosts & private IPs (`tests/scraper.test.ts`)
  - [x] Fixture produces `risk_averse` persona on live/replay run
  - [x] Edits survive a reload and persist to SQLite with `edited_by_user = 1`

---

### [x] Step 3: Scenario Map and Strategic Questions
- [x] Single-call combined generator route (`POST /api/sessions/[id]/scenarios`)
- [x] Generate 4–6 objections (Risk/Compliance/Security, ROI/Financial, Implementation, Status Quo)
- [x] Generate 5–7 phased strategic questions (rapport, challenge, risk, decision criteria) with rationale and listening cues
- [x] Interactive Briefing view with 1-click copy
- [x] **Validation Criteria**:
  - [x] Schema validation tests pass (`tests/scenarios.test.ts`)
  - [x] Benchmark run includes Risk/Security objection and ROI objection
  - [x] 5–7 questions returned cleanly

---

### [x] Step 4: Streaming Sparring Chat and Stance Meter
- [x] Streaming SSE route (`POST /api/sessions/[id]/chat`)
- [x] System prompt with persona, meeting context, private objections, difficulty modifier
- [x] Sparring behavior guardrails (stay in character, max ~120 words, no AI references, no coaching)
- [x] Difficulty selector: warmup, realistic, hostile
- [x] Turn cap enforcement (max 10 user messages; returns `TURN_CAP` error code; chat history truncated to last 12 messages)
- [x] Stance classifier call on stream end emitting SSE `stance` event (`skeptical | guarded | neutral | intrigued | convinced | impatient`)
- [x] Close simulation route (`POST /api/sessions/[id]/end`)
- [x] **Validation Criteria**:
  - [x] SSE stream unit tests pass
  - [x] Failover occurs strictly before first token (`tests/router.test.ts`)
  - [x] Turn cap enforced (`tests/chat.test.ts`)
  - [x] Stance always in enum (`tests/chat.test.ts`)
  - [x] In-character guardrail tests pass (`tests/chat.test.ts`)

---

### [x] Step 5: Evaluator, Rewrites, Cheat Sheet
- [x] Evaluator route (`POST /api/sessions/[id]/evaluate`) with guard requiring $\ge$ 2 user turns (`INSUFFICIENT_TURNS`)
- [x] Structured evaluation across 4 PRD dimensions (1–10 anchored scale with evidence quotes)
- [x] Code post-validation: verify all evidence quotes are verbatim substrings of user turns
- [x] Code post-validation: turn rewrites reference real user turns; `user_said` populated from DB
- [x] Compute `overall_score` strictly in code
- [x] Generate Executive Summary & 5-minute Cheat Sheet
- [x] Report UI with Markdown export and `@media print` cheat sheet
- [x] **Validation Criteria**:
  - [x] Quote-substring validator drops fabricated quotes and preserves real user substrings (`tests/evaluate.test.ts`)
  - [x] Rewrites match real user turns with DB-sourced `user_said`
  - [x] Fewer than 2 turns returns `INSUFFICIENT_TURNS` (`tests/evaluate.test.ts`)

---

### [x] Step 6: GATE - Golden Path & Demo Script
- [x] Automated test suite on the Marcus Vance fixture (`tests/golden-gate.test.ts`)
- [x] Verify all 7 Gate Assertions:
  - [x] Persona: `risk_posture = risk_averse`, priorities/hot buttons mention security/compliance/risk
  - [x] Scenarios: $\ge$ 1 Risk objection, $\ge$ 1 ROI objection, 4–6 objections, 5–7 questions
  - [x] Chat: persona replies on every turn, stance in enum, turn cap enforced, no mid-stream provider switch
  - [x] Evaluation: 4 integer scores in 1–10, all quotes verified substrings, $\ge$ 2 rewrites on real user turns, overall score equals mean of 4, cheat sheet complete
  - [x] Failure path: forced provider failure renders `LLM_UNAVAILABLE` error state honestly with no mock disguise
  - [x] Persistence: reload restores persona, scenarios, transcript, and report from SQLite
  - [x] Production build passes cleanly (`next build`)
- [x] Write `README.md` with installation, setup, and step-by-step PRD demo script

---

### [x] Step 7: Stretch - Voice AI (STT & TTS)
- [x] Feature detection for Web Speech API (`src/lib/audio/speech.ts`)
- [x] Voice input (Microphone STT) streaming into chat input (`SparringArena.tsx`)
- [x] Speech synthesis (TTS) for persona replies with pitch/rate/voice tailored to persona
- [x] Graceful fallback to text-only if unsupported, with mute/unmute and stop controls
