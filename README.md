# Hotseat: AI-Powered Role-Play Preparation Coach

Hotseat prepares you for a high-stakes meeting. You give it the counterpart's profile and your meeting context. It builds an editable persona, predicts their objections, suggests strategic questions, plays the counterpart in a live streaming role-play, and then coaches you on clarity, confidence, structure and relevance. The coaching includes a named framework for the hardest pushback you faced, such as a budget objection.

> Demo video: _add link_ · Live deployment: _add link_

---

## 1. Quickstart (about 3 minutes)

Prerequisites: Node.js 18+ (tested on 24) and npm 9+.

```bash
npm install
cp .env.example .env.local     # then add at least one API key
npm run dev                    # http://localhost:3000
```

| Variable | Required | Notes |
|---|---|---|
| `OPENCODE_API_KEY` | one of the three | [OpenCode Go](https://opencode.ai/docs/go/); primary provider |
| `OPENCODE_MODEL` | yes, if that key is set | e.g. `deepseek-v4.1-flash` |
| `GEMINI_API_KEY` | one of the three | Free at [Google AI Studio](https://aistudio.google.com/app/apikey) |
| `GROQ_API_KEY` | one of the three | Free at [Groq Console](https://console.groq.com/keys) |
| `GEMINI_MODEL` / `GROQ_MODEL` | yes, if that key is set | No defaults in code; `.env.example` has working IDs |
| `DATABASE_URL` | no | Defaults to `file:./data/app.db`. Use `libsql://…` for Turso |
| `DATABASE_AUTH_TOKEN` | Turso only | |
| `MAX_TURNS` | no | Default user-turn cap per session (10) |
| `ACCESS_CODE` | no | If set, visitors must enter this code first. Recommended for a public deployment |
| `RATE_LIMIT` | no | Per-IP request limits, `on` by default |
| `GLOBAL_DAILY_LLM_LIMIT` | no | AI-backed requests per day across all visitors (500) |

There is no manual database step: tables are created on the first request. `npm run db:migrate` still exists if you want to create them ahead of time. To check your keys and model IDs, run `npm run llm:smoke`.

Then click **Load Marcus Vance (MD Benchmark)** on the first screen and follow the demo script in section 6.

---

## 2. How it maps to the brief

| Brief capability | Where it lives |
|---|---|
| Context ingestion and profiling | Paste-first form, plus a best-effort LinkedIn URL fetch. The AI builds the persona (background, technical depth, risk posture, priorities, hot buttons) and highlights fields it had to guess. You can edit any of them before sparring. |
| Predictive scenario mapping | 4–6 objections across Risk/Compliance/Security, ROI/Financial, Implementation and Status Quo. Each has a trigger, probability, severity, underlying concern and counter-strategy. |
| Strategic question generation | 5–7 questions in phases (rapport, challenge, risk, decision criteria), each with a rationale and what to listen for. |
| Interactive simulation | Streaming chat in which the AI stays in character and raises its private objection bank. Three difficulty levels, a live stance meter (skeptical → convinced / impatient), a turn cap, and optional voice in and out. |
| Performance analytics and coaching | Four 1–10 scores, each backed by verbatim quotes from your own messages. Also: rewrites of your weakest turns, an **Objection Playbook** (what went wrong, a named framework, an example answer) and a printable 5-minute cheat sheet. |

---

## 3. Architecture

```
Browser (Next.js App Router, React, vanilla CSS)
  │  ingest → persona → briefing → sparring (SSE) → report       ?session=<id> resumes any stage
  ▼
Route handlers  /api/sessions[/id]/{persona,scenarios,chat,evaluate,evaluation,end}, /api/ingest/linkedin
  │
  ├─ LLM router  (src/lib/ai/router.ts)
  │     OpenCode Go ──fail──▶ Gemini ──fail──▶ Groq ──fail──▶ local OpenAI-compatible (dev) ──fail──▶ LLM_UNAVAILABLE
  │     structured calls: Zod-validate → 1 repair retry with the exact validation error
  │     streaming: fail over only before the first token, never mid-reply
  │     every call is logged to llm_calls (provider, model, latency, status)
  │
  └─ libSQL (local SQLite file or Turso): sessions, personas, scenarios, turns, evaluations, llm_calls
```

Key files:
- `src/lib/ai/prompts/*`: one versioned prompt per purpose (persona, scenarios, chat, stance, evaluate)
- `src/types/index.ts`: Zod schemas, which are the contract for every LLM output
- `src/lib/evaluation.ts`: the evaluator's code-side checks
- `src/lib/quotes.ts`: verifies quotes are verbatim

---

## 4. Design decisions

- **No disguised mocks.** If every provider fails, the API returns `LLM_UNAVAILABLE` and the UI shows a retry. A failed stance reading shows "unavailable" rather than a guessed stance. A chat message the AI never answered is rolled back, so it doesn't use up a turn.
- **The evaluator is checked in code, not trusted.**
  - Each evidence quote must appear verbatim inside a single user message (case, whitespace and smart punctuation are normalized). Quotes that fail are dropped, never backfilled, and the UI says when a score has no verified quote.
  - Rewrites must point at real user turns. This is part of the per-request Zod schema, so a wrong turn number triggers the one repair retry.
  - The "what you said" text always comes from the database, never from the AI.
  - The overall score is computed in code as the mean of the four dimensions.
- **Stance is a second, small structured call** made after the streamed reply finishes (decision D2). Plain text streams fast, and the stance classification still gets schema validation.
- **Paste-first ingestion.** LinkedIn doesn't offer a public profile API to unauthenticated clients, so the URL fetch is best-effort and clearly labelled (see Limitations).
- **Safe to put on a public URL.** Every API route is rate-limited per client IP, with counters in the database so the limits hold across serverless instances, and AI routes also share a daily cap so rotating IPs can't drain the keys. An optional `ACCESS_CODE` puts the whole app behind a code (httpOnly cookie holding a hash of the code; guesses are rate-limited). Session ids are random 128-bit values, there is no route that lists sessions, and every response carries a Content-Security-Policy and other security headers.
- **Model IDs come only from the environment**, so a model deprecation is a config change, not a code change.

---

## 5. Tests

```bash
npm test            # 59 Vitest cases across 9 files
npm run typecheck
npm run build
npm run llm:smoke   # live check of your OpenCode/Gemini/Groq keys and model IDs
```

Route-level tests call the real handlers against a separate `data/test.db`, with AI output served from `fixtures/llm/*.json` (`LLM_MODE=replay`). Validation, post-validation, persistence, SSE framing and turn accounting all run the production code path. What they cover:
- **Golden gate:** the full Marcus Vance flow through the routes, plus a reload, plus the honest failure with no providers.
- **Chat:** turn cap, a session that has ended, invalid bodies, rollback on provider failure.
- **Evaluate:** `INSUFFICIENT_TURNS`, a deliberately fabricated quote in the fixture being dropped, the score computed in code.
- **Persona:** edits persist through a reload.
- **Router:** failover, repair retry, no switching providers mid-stream.
- **OpenCode Go provider:** endpoint, bearer auth, the required `x-opencode-session` header, streamed content only, config errors.
- **LinkedIn scraper:** SSRF guard, the sign-in wall, LinkedIn's 999 bot block.
- **Security:** per-IP limits and their reset, the global daily AI cap, a route returning 429, the access-code redirect and 401, cookie handling, the open-redirect guard, random session ids, no session listing.

The replay fixtures exercise everything except the models themselves. Output quality is checked manually with `llm:smoke` and the demo script below.

---

## 6. Demo script (the brief's example scenario)

1. **Ingest.** Click **Load Marcus Vance (MD Benchmark)**. Marcus is a fictional MD of Operational Risk & Compliance at a bank; the meeting is a pitch for workflow-automation software, aiming for a 60-day pilot. Click **Generate Persona Card**.
2. **Persona.** Check that it flags `risk_averse`, high technical depth, and priorities around audit trails and security rather than UI. Edit a field if you want, then **Confirm Persona & Map Scenarios**.
3. **Briefing.** Review the objection map (it should include Risk/Security and ROI) and the phased questions. Copy one.
4. **Spar.** Pitch, answer the security question, then dodge the budget question. Watch the stance meter respond.
5. **Report.** After two or more turns, click **End & Evaluate**. The playbook should give you a framework for the budget objection; the report also has quotes, rewrites and the cheat sheet. Try **Print Cheat Sheet** and **Download .md**.

Failure path: remove both keys from `.env.local` and restart. Generating a persona then shows the honest `LLM_UNAVAILABLE` state with a Retry button.

---

## 7. Limitations

- **LinkedIn:** a logged-out request usually hits LinkedIn's sign-in wall or its 999 bot block. When the fetch does work, it only gets the public headline and summary meta tags. The app says so on screen and asks you to paste the About and Experience text, which is the reliable path. Scraping behind a login would violate LinkedIn's terms, so it isn't attempted.
- **No user accounts.** Anyone with a session link can open that session (links are unguessable random ids). `ACCESS_CODE` keeps strangers out of the whole app, but everyone who has the code shares it.
- **Free-tier rate limits** on the providers can cause a temporary `LLM_UNAVAILABLE`; retrying works once the quota resets.
- **Voice** uses the browser's Web Speech API (best in Chrome or Edge). It falls back to text where that API is unsupported.
- **Rate limits are per IP**, so people behind one office or campus network share a limit.

---

## 8. Deployment (Vercel + Turso)

A local SQLite file doesn't persist on serverless hosts, so use a [Turso](https://turso.tech) database.

1. Create a Turso database and copy its `libsql://…` URL and an auth token.
2. Import the GitHub repo into [Vercel](https://vercel.com/new). The defaults (Next.js, `npm run build`) are correct.
3. Add environment variables: at least one provider key with its model ID (see section 1), `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, and `ACCESS_CODE` if the URL will be shared. Leave `LLM_MODE` unset or `live`.
4. Deploy. Tables are created on the first request. Then run the demo script on the live URL.

Long AI routes declare their own time limits (`maxDuration`: 60s, and 120s for evaluation).
