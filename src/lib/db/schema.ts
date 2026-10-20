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

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
`;

// Additive column migrations for tables that already exist. Applied only when the column is missing.
export const COLUMN_MIGRATIONS: Array<{ table: string; column: string; ddl: string }> = [
  {
    table: "evaluations",
    column: "objection_playbook",
    ddl: "ALTER TABLE evaluations ADD COLUMN objection_playbook TEXT NOT NULL DEFAULT '[]'",
  },
];
