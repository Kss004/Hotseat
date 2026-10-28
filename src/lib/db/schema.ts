// Base schema. Inlined as a TS string (not read from disk) so it ships with any build output.
// Every statement must be idempotent; column additions go in COLUMN_MIGRATIONS below.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  title TEXT NOT NULL,
  target_url TEXT,
  raw_input TEXT NOT NULL,
  meeting_context TEXT NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'realistic',
  max_turns INTEGER NOT NULL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'draft'
);

CREATE TABLE IF NOT EXISTS personas (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  background TEXT NOT NULL,
  risk_posture TEXT NOT NULL,
  technical_depth TEXT NOT NULL,
  business_priorities TEXT NOT NULL,
  hot_buttons TEXT NOT NULL,
  conversational_style TEXT NOT NULL,
  uncertain_fields TEXT NOT NULL DEFAULT '[]',
  edited_by_user INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  objections TEXT NOT NULL,
  strategic_questions TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_number INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  stance TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (session_id, turn_number)
);

CREATE TABLE IF NOT EXISTS evaluations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  clarity_score INTEGER NOT NULL CHECK (clarity_score BETWEEN 1 AND 10),
  clarity_critique TEXT NOT NULL,
  clarity_evidence TEXT NOT NULL,
  confidence_score INTEGER NOT NULL CHECK (confidence_score BETWEEN 1 AND 10),
  confidence_critique TEXT NOT NULL,
  confidence_evidence TEXT NOT NULL,
  structure_score INTEGER NOT NULL CHECK (structure_score BETWEEN 1 AND 10),
  structure_critique TEXT NOT NULL,
  structure_evidence TEXT NOT NULL,
  relevance_score INTEGER NOT NULL CHECK (relevance_score BETWEEN 1 AND 10),
  relevance_critique TEXT NOT NULL,
  relevance_evidence TEXT NOT NULL,
  overall_score REAL NOT NULL,
  executive_summary TEXT NOT NULL,
  turn_rewrites TEXT NOT NULL,
  cheat_sheet TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  purpose TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  latency_ms INTEGER,
  status TEXT NOT NULL,
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS research (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  reason TEXT,
  queries TEXT NOT NULL DEFAULT '[]',
  findings TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS research_cache (
  company_key TEXT PRIMARY KEY,
  reason TEXT,
  queries TEXT NOT NULL,
  findings TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

-- Hotseat Floor (Step 8): the manager's roster of reps who consented to morning practice calls
CREATE TABLE IF NOT EXISTS floor_reps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone_e164 TEXT NOT NULL UNIQUE,
  deal_notes TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  consent_note TEXT NOT NULL,
  opted_out_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One morning of calls for the whole floor (one Bolna batch)
CREATE TABLE IF NOT EXISTS floor_runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'preparing',
  bolna_batch_id TEXT,
  auto_launch INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  product_summary TEXT NOT NULL,
  goal TEXT NOT NULL
);

-- One rep's call within a run. Each call gets its own Hotseat session (persona, objections, turns, evaluation)
CREATE TABLE IF NOT EXISTS floor_calls (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES floor_runs(id) ON DELETE CASCADE,
  rep_id TEXT NOT NULL REFERENCES floor_reps(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  prep_status TEXT NOT NULL DEFAULT 'pending',
  prep_error TEXT,
  objection_plan TEXT NOT NULL DEFAULT '[]',
  call_brief TEXT,
  bolna_execution_id TEXT UNIQUE,
  call_status TEXT NOT NULL DEFAULT 'not_started',
  termination_reason TEXT,
  duration_sec REAL,
  recording_url TEXT,
  transcript TEXT,
  eval_status TEXT NOT NULL DEFAULT 'waiting',
  eval_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (run_id, rep_id)
);

-- Background work (preparing calls, scoring calls), claimed with a lease so two workers never run the same job
CREATE TABLE IF NOT EXISTS floor_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_after INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (kind, ref_id)
);

-- Floor-wide settings (what the team sells, the Bolna agent id, etc.)
CREATE TABLE IF NOT EXISTS floor_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// Additive column migrations for tables that already exist. Applied only when the column is missing.
export const COLUMN_MIGRATIONS: Array<{ table: string; column: string; ddl: string }> = [
  {
    table: "evaluations",
    column: "objection_playbook",
    ddl: "ALTER TABLE evaluations ADD COLUMN objection_playbook TEXT NOT NULL DEFAULT '[]'",
  },
  {
    // Unix seconds until which a chat reply is in flight; NULL when idle (one reply at a time per session)
    table: "sessions",
    column: "streaming_until",
    ddl: "ALTER TABLE sessions ADD COLUMN streaming_until INTEGER",
  },
  {
    // 1 = a scheduled morning run that launches itself once every call is prepared
    table: "floor_runs",
    column: "auto_launch",
    ddl: "ALTER TABLE floor_runs ADD COLUMN auto_launch INTEGER NOT NULL DEFAULT 0",
  },
];
