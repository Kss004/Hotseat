# AGENTS.md - Project Rules & Operating Principles

## 1. Core Principles
- **No shortcuts, no disguised mocks**: Never output fake mock responses when in live mode. If an LLM call fails across all providers, fail honestly with `LLM_UNAVAILABLE` and present a clear retry state in the UI.
- **Finish the golden path before any stretch feature**: Out of scope until the Step 6 gate passes: voice, in-flight coach whispers, curveballs, auth, multi-user.
- **Strict schema validation**: Every LLM output is validated with Zod before touching the database or the UI. On failure, run exactly one repair retry with the validation error.
- **Do not advance steps prematurely**: Do not start a step until the previous step's validation criteria are verified and marked complete in `PROGRESS.md`.

## 2. Technical Standards
- **Framework**: Next.js App Router with TypeScript strict mode.
- **Styling**: Vanilla CSS design system with CSS custom properties (dark executive theme) or CSS Modules. **No Tailwind**.
- **Database**: libSQL (`@libsql/client`) with local default `DATABASE_URL=file:./data/app.db`. All migrations must be idempotent.
- **LLM Router**:
  - Primary: Gemini (`GEMINI_MODEL`, e.g., `gemini-2.5-flash` or live-verified model ID).
  - Fallback: Groq (`GROQ_MODEL`, e.g., `llama-3.3-70b-versatile`).
  - Dev-time local: `LOCAL_LLM_URL` (optional).
  - Model IDs must never be hardcoded; verify via environment variables.
- **Streaming & Stance (Decision D2)**:
  - Chat route streams plain reply text as SSE tokens.
  - On stream end, persist reply and make a second small structured call (`purpose: "stance"`) to classify persona stance (`skeptical | guarded | neutral | intrigued | convinced | impatient`).
  - Emit SSE `stance` event, then close stream with `done`.
- **Evaluator Post-Validation**:
  - Every evidence quote must be verified in code as a substring of a user turn (whitespace-normalized). Invalid quotes are dropped.
  - Turn rewrites `user_said` must come from the database, never from LLM generation.
  - Overall score is computed strictly in code as the average of the 4 dimension scores.
