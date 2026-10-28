# Hotseat: AI-Powered Role-Play Preparation Coach

Hotseat prepares you for a high-stakes meeting. You give it the counterpart's profile and your meeting context. It builds an editable persona, predicts their objections, suggests strategic questions, plays the counterpart in a live streaming role-play, and then coaches you on clarity, confidence, structure and relevance. The coaching includes a named framework for the hardest pushback you faced, such as a budget objection.

> **Live demo:** https://hotseat-lac.vercel.app · **Demo videos:** in the Google Drive folder shared with the submission
>
> To try it: click **Load Marcus Vance (MD Benchmark)** and follow the demo script in section 6.

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
| `RATE_LIMIT` | no | Per-IP request limits, `on` by default |
| `GLOBAL_DAILY_LLM_LIMIT` | no | AI-backed requests per day across all visitors (500) |
| `GLOBAL_LLM_PER_MINUTE` | no | AI-backed requests per minute across all visitors (30) |
| `TAVILY_API_KEY` | no | Turns on live company research at the briefing step ([Tavily](https://app.tavily.com)) |
| `RESEARCH_DAILY_LIMIT` | no | Live research runs per day across all visitors; cached repeats don't count (30) |

There is no manual database step: tables are created on the first request. `npm run db:migrate` still exists if you want to create them ahead of time. To check your keys and model IDs, run `npm run llm:smoke`.

Then click **Load Marcus Vance (MD Benchmark)** on the first screen and follow the demo script in section 6.

---

## 2. How it maps to the brief

| Brief capability | Where it lives |
|---|---|
| Context ingestion and profiling | Paste-first form, plus a best-effort LinkedIn URL fetch. The AI builds the persona (background, technical depth, risk posture, priorities, hot buttons) and highlights fields it had to guess. You can edit any of them before sparring. |
| Predictive scenario mapping | 4–6 objections across Risk/Compliance/Security, ROI/Financial, Implementation and Status Quo. Each has a trigger, probability, severity, underlying concern and counter-strategy. With a Tavily key, recent public news about the counterpart's **company** grounds at least one objection in a real event, and is shown with its sources. |
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
  │     time limits: each call is aborted after its timeout and fails over; a per-route budget ends the chain in time
  │     streaming: fail over only before the first token (or after 20s without one), never mid-reply
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
- **Live company research, not people research.** At the briefing step, two Tavily searches run in parallel on the counterpart's company (recent news, and challenges/regulation for their role). The person is never searched, which avoids profiling a private individual and same-name mix-ups; social networks, people-search sites and job boards are also excluded, both in the Tavily request and again when results are read (including from the cache). Results must mention the company as whole words, are deduped, and are shown as a sources panel. In the prompts the web text is fenced as untrusted data with an instruction to ignore anything that reads like an instruction, and the role-play only receives headlines. Research never blocks the briefing: no key, research turned off, an unknown company, the daily cap or a Tavily outage each show their reason instead. Results are cached per company for 24 hours, so a repeat adds no latency or cost; a fresh search adds about 1–3 seconds (8s timeout).
- **Paste-first ingestion.** LinkedIn doesn't offer a public profile API to unauthenticated clients, so the URL fetch is best-effort and clearly labelled (see Limitations).
- **Safe to put on a public URL.** Every API route is rate-limited per client IP, with counters in the database so the limits hold across serverless instances, and AI routes also share a daily cap so rotating IPs can't drain the keys. Short-window limits stop bursts: at most 20 requests per 10 seconds from one IP, and 30 AI requests a minute across all visitors (the providers' own per-minute limits). Each session streams one chat reply at a time, so a double-send can't run parallel AI calls. Session ids are random 128-bit values, there is no route that lists sessions, and every response carries a Content-Security-Policy and other security headers.
- **Model IDs come only from the environment**, so a model deprecation is a config change, not a code change.

---

## 5. Tests

```bash
npm test            # 96 Vitest cases across 12 files
npm run typecheck
npm run build
npm run llm:smoke   # live check of your OpenCode/Gemini/Groq keys and model IDs
```

Route-level tests call the real handlers against a separate `data/test.db`, with AI output served from `fixtures/llm/*.json` (`LLM_MODE=replay`). Validation, post-validation, persistence, SSE framing and turn accounting all run the production code path. What they cover:
- **Golden gate:** the full Marcus Vance flow through the routes, plus a reload, plus the honest failure with no providers.
- **Chat:** turn cap, a session that has ended, invalid bodies, rollback on provider failure.
- **Evaluate:** `INSUFFICIENT_TURNS`, a deliberately fabricated quote in the fixture being dropped, the score computed in code.
- **Persona:** edits persist through a reload.
- **Router:** failover, repair retry, no switching providers mid-stream, per-call timeouts that abort and fail over, the time budget ending in `LLM_UNAVAILABLE`, and a stream failing over when no first token arrives.
- **OpenCode Go provider:** endpoint, bearer auth, the required `x-opencode-session` header, streamed content only, config errors.
- **LinkedIn scraper:** SSRF guard, the sign-in wall, LinkedIn's 999 bot block.
- **Recent sessions:** the browser-only list adds, updates and forgets sessions, keeps at most 10, and ignores invalid or corrupted storage without throwing.
- **Live research:** the Tavily client (parallel requests, auth, filtering, whole-word matching on the company or its parent brand ("HSBC UK" → "HSBC", with brand-only matches required to read as business news, so a namesake person is dropped), people/job-site exclusion, dedupe, timeouts, 429/432/500/network failures, placeholder companies), and in the app: research stored and restored on reload, no key, turned off, unknown company, 24h cache not using the daily quota, an outage recorded without caching, and prompts fencing web text.
- **Security:** per-IP hourly and burst limits and their reset, the global per-minute and daily AI caps, a route returning 429, a full normal session staying inside every limit, random session ids, no session listing.
- **Chat lock:** two messages sent at once (one streams, one gets 409 `BUSY`), release after each reply and after a provider failure, an expired lock not blocking.

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
- **No user accounts.** The app is open to anyone with the URL, and anyone with a session link can open that session (links are unguessable random ids). Rate limits, not logins, protect the API keys. Your own recent sessions are listed on the first screen from this browser's storage only; the server has no route that lists sessions.
- **Free-tier rate limits** on the providers can cause a temporary `LLM_UNAVAILABLE`; retrying works once the quota resets.
- **Voice** uses the browser's Web Speech API (best in Chrome or Edge). It falls back to text where that API is unsupported.
- **Rate limits are per IP**, so people behind one office or campus network share a limit.
- **Live research only finds what's public and recent.** Small, private or fictional companies (including the Marcus Vance demo's Apex Financial Capital) usually return nothing, and the panel says so. Results can still be imperfect; the panel asks users to check the sources.

---

## 8. Deployment (Vercel + Turso)

A local SQLite file doesn't persist on serverless hosts, so use a [Turso](https://turso.tech) database.

1. Create a Turso database and copy its `libsql://…` URL and an auth token.
2. Import the GitHub repo into [Vercel](https://vercel.com/new). The defaults (Next.js, `npm run build`) are correct.
3. Add environment variables: at least one provider key with its model ID (see section 1), `DATABASE_URL`, and `DATABASE_AUTH_TOKEN`. Leave `LLM_MODE` unset or `live`.
4. Deploy. Tables are created on the first request. Then run the demo script on the live URL.

Long AI routes declare their own time limits (`maxDuration`: 120s, and 180s for evaluation). Inside that, each AI call is aborted after 30s (75s for evaluation) and the router fails over, with a total budget that leaves room for the route to answer, so a slow provider ends in the app's own `LLM_UNAVAILABLE` retry state rather than a platform timeout.

The live instance runs exactly this setup: Vercel (Washington, D.C.) with a Turso database in AWS US East, and OpenCode Go as the primary model. The full Marcus Vance demo was run there end to end on 2026-10-20: the evaluation finished in under a minute, and the report reloaded from the database.

Two setup mistakes to avoid:
- `DATABASE_AUTH_TOKEN` must be a **database** token (the database page → Create Token), not a Platform API token from Settings → API Tokens. The wrong one shows up as `LibsqlError: SERVER_ERROR: Server returned HTTP status 401` in the Vercel logs.
- Environment variables only take effect after a redeploy.

## 9. Hotseat Floor: morning practice calls over the phone (Bolna)

Built for the Bolna Symphony Buildathon. Every morning, a Bolna voice agent calls each rep on the floor as a skeptical buyer in that rep's own deal. Hotseat prepares each call, scores it with the same quote-verified evaluator as the text coach, and shows the manager which objection categories the floor handles worst.

**Who does what**
- **Bolna:** phone numbers, dialling, speech-to-text (Sarvam), the live conversation, text-to-speech, batch scheduling.
- **Hotseat:** the rep roster and consent, a fresh buyer persona and objection bank per call, a fixed plan of one objection per category, transcript ingestion, scoring, the floor dashboard and each rep's report.

**Flow**
1. The manager adds reps (name, mobile, deal notes, how they consented) and describes what the team sells at `/floor`.
2. A run creates one session per rep and queues a prep job: persona → scenarios → objection plan → one-line call brief.
3. Launch sends one Bolna batch: a CSV with `contact_number, rep_name, buyer_name, buyer_company, call_brief, hotseat_call_id`, filled into a single agent's prompt. Calls only go out 09:00–21:00 IST (agent calling guardrails).
4. Bolna posts status updates to `/api/floor/webhook?token=…`. Bolna doesn't sign webhooks, so the body is used only for the execution id; the execution is re-fetched from Bolna's API before anything is stored. A sweep of the batch's executions catches lost webhooks.
5. A completed call's transcript is stored verbatim as session turns and scored. The evaluator now scores **every objection the buyer raised** (`handling_score` 1–10 with verified evidence quotes; an unanswered objection is 1 by rule).
6. The dashboard shows the mean handling score per category with its sample size. A category is called the weakest only with 3+ scored objections. Calls that didn't connect, were too short (under 2 rep turns) or couldn't be scored are listed with the reason, never estimated.

**Background work.** Prep and scoring run in a job queue in the database (`floor_jobs`), claimed with a lease, retried up to 3 times for provider outages. The queue is worked by the manager screen while it is open (`/api/floor/tick`), by the webhook for the call it just ingested, and by a daily Vercel Cron (`vercel.json`, 02:00 UTC) that also keeps the next morning's run queued when the daily schedule is on.

**Access.** `/floor` needs `MANAGER_PASSWORD` (signed, HTTP-only cookie). Reps get signed report links (`/floor/report/<token>`) that open only their own call. There is still no public listing of sessions.

**Settings** (see `.env.example`): `BOLNA_API_KEY`, the agent's voice stack (`BOLNA_LLM_*`, `BOLNA_STT_*`, `BOLNA_TTS_*`, `BOLNA_TELEPHONY_PROVIDER`), `PUBLIC_BASE_URL`, `BOLNA_WEBHOOK_SECRET`, `MANAGER_PASSWORD`, `APP_SECRET`, `CRON_SECRET`. The agent is created on first launch and updated whenever its prompt or voice settings change.

**Consent and conduct.** Only reps who agreed in writing are added; the consent note is stored and reps can opt out or be deleted with all their data. The agent says it is an AI practice buyer and that the call is recorded before anything else, stops on "stop", and is blunt but never abusive (Bolna's acceptable-use policy).
