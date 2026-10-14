# AI-Powered Role-Play Preparation Coach

An executive-grade preparation coach and sparring simulator that analyzes professional profiles, anticipates cynical objections, recommends strategic discovery questions, conducts live streaming sparring sessions with real-time stance/skepticism tracking, and generates granular turn-by-turn performance coaching with gold-standard rewrites.

---

## 1. System Capabilities & Architecture

```
[ Ingestion: Paste-First + Best-Effort LinkedIn URL + Meeting Context ]
                                   │
                                   ▼
[ Cognitive Persona Synthesis ──> Editable Persona Card (Uncertainty Highlighting) ]
                                   │
                                   ▼
[ Single-Call Scenario Engine: 4-6 Categorized Objections + 5-7 Strategic Questions ]
                                   │
                                   ▼
[ Dynamic Sparring Arena: Streaming SSE Chat + Live Stance & Skepticism Meter ]
                                   │
                                   ▼
[ PRD Performance Evaluator: 4 Dimensions (1-10) + Evidence Quotes + Gold Rewrites ]
                                   │
                                   ▼
[ Actionable Pre-Meeting Deliverable: 5-Minute Executive Cheat Sheet (Print/Export) ]
```

### Multi-Tier AI Provider Fallback
- **Primary**: Google Gemini Free Tier (`gemini-2.5-flash` / `gemini-1.5-flash`)
- **Secondary Fallback**: Groq Cloud (`llama-3.3-70b-versatile` / `llama-3.1-8b-instant`)
- **Tertiary Dev-Time**: Local OpenAI-compatible endpoint (e.g. Ollama `http://localhost:11434/v1`)
- **Integrity Guarantee**: Strict Zod schema validation on every output with automated 1-shot repair retry. If all providers fail, fails honestly with `LLM_UNAVAILABLE`—**no fake or disguised mock outputs**.

### Persistence Layer
- SQLite via `@libsql/client` (`file:./data/app.db`) with idempotent migrations, WAL mode, and persistent turn history. Fully deployable to Turso without code changes.

---

## 2. Quickstart & Installation

### Prerequisites
- Node.js `v18+` (Tested on `v24.21.0`)
- npm `v9+`

### Setup Steps
```bash
# 1. Install dependencies
npm install

# 2. Run idempotent database migrations
npm run db:migrate

# 3. Configure environment variables
cp .env.example .env.local
```

Edit `.env.local` with your API keys:
```env
GEMINI_API_KEY=your_gemini_key_here
GROQ_API_KEY=your_groq_key_here
GEMINI_MODEL=gemini-2.5-flash
GROQ_MODEL=llama-3.3-70b-versatile
DATABASE_URL=file:./data/app.db
MAX_TURNS=10
LLM_MODE=live
```

### Run Live Development Server
```bash
npm run dev
# App will be accessible at http://localhost:3000
```

---

## 3. Test Suite & Validation

Run all unit, integration, and golden-gate assertion tests:
```bash
# Run Vitest test suite (26 assertions across 7 test files)
npm test

# Run TypeScript strict typecheck
npm run typecheck

# Run LLM live provider smoke check
npm run llm:smoke
```

---

## 4. Flagship Golden Path Demo Script (PRD Scenario)

### Persona: Marcus Vance (Managing Director, Operational Risk & Compliance at Apex Financial Capital)

1. **Step 1: Ingestion & Profiling**
   - Open `http://localhost:3000`.
   - Click the **"Load Marcus Vance (MD Benchmark)"** button.
   - The form populates with Marcus's profile (18 years in banking risk, ex-Deloitte Risk Advisory partner, FedRAMP/SOC2 focus, zero tolerance for vague claims) and the meeting context (pitching *AutoFlow Enterprise* workflow automation to secure a 60-day sandbox pilot).
   - Click **"Generate Persona Card →"**.

2. **Step 2: Review & Edit Persona Dossier**
   - The system synthesizes Marcus's profile: `risk_posture: risk_averse`, `technical_depth: high`, priorities in immutable audit trails and SLA penalties, and pet peeves on buzzwords.
   - Any inferred attributes are highlighted with an uncertainty pill.
   - Click **"Edit Persona"** to adjust any fields, or click **"Confirm Persona & Map Scenarios →"**.

3. **Step 3: Tactical Briefing & Question Playbook**
   - Review the **Predictive Objection Map** (4–6 prioritized objections covering Risk/Compliance, ROI, Implementation, and Status Quo).
   - Review the **Strategic Discovery Questions** organized by phase (*rapport, challenge, risk uncovery, decision criteria*).
   - Click the **"📋 Copy"** button on any question to paste it into your meeting notes.
   - Click **"Enter Sparring Arena →"**.

4. **Step 4: Live Sparring Arena**
   - Spar with Marcus in real-time. Notice how he stays in character as a skeptical financial MD.
   - Pitch your solution:
     *User:* `"Marcus, AutoFlow isolates audit logs in dedicated customer-managed vaults with zero third-party access and automated SOC2 evidence collection."`
   - Observe the live **Persona Stance Meter** updating dynamically based on your response (`Skeptical` $\rightarrow$ `Guarded` $\rightarrow$ `Intrigued`).
   - Counter his questions about SLA penalties and ROI timelines.
   - The turn counter tracks your progress up to the 10-turn cap.
   - Click **"End & Evaluate Session 🏁"**.

5. **Step 5: Performance Analytics & 5-Minute Cheat Sheet**
   - Review your **Overall Score** (calculated strictly in code as the mean of the 4 PRD dimensions).
   - Inspect the **4 Core Rubrics** (Clarity, Confidence, Structure, Relevance) with verbatim cited quotes from your transcript.
   - Study the **Turn-by-Turn Post-Mortem** showing what you said, the coach critique, and the **Gold Standard "Say this instead" script**.
   - Review the **5-Minute Pre-Meeting Cheat Sheet** containing the top talking points, defensive shields, and killer questions.
   - Click **"Print Cheat Sheet"** (`window.print()`) or **"Copy as Markdown"** to take it into your actual meeting!
