import { getReadyDb } from "@/lib/db";
import { rowToEvaluation, EVALUATION_COLUMNS } from "@/lib/evaluation";
import { loadTurns } from "@/lib/pipeline";
import { AppError } from "@/lib/errors";
import type { EvaluationRecord, PersonaRecord, Turn } from "@/types";
import { createReportToken } from "./auth";
import { PLAN_CATEGORIES, type PlannedObjection } from "./prompt";

/** Below this many scored objections, a category is shown as "not enough data" instead of being ranked. */
export const MIN_N_TO_RANK = 3;

export interface CategoryStat {
  category: string;
  n: number;
  mean: number | null;
  unanswered: number;
  worst: { score: number; rep_name: string; objection: string; quote: string | null; report_token: string } | null;
}

export interface RepRow {
  call_id: string;
  rep_name: string;
  call_status: string;
  duration_sec: number | null;
  eval_status: string;
  eval_error: string | null;
  prep_status: string;
  prep_error: string | null;
  overall_score: number | null;
  weakest_category: string | null;
  verified_quotes: number | null;
  report_token: string;
}

export interface RunSummary {
  id: string;
  scheduled_at: string;
  status: string;
  error: string | null;
  auto_launch: boolean;
  bolna_batch_id: string | null;
  counts: { planned: number; prepared: number; connected: number; scored: number; not_scored: number; failed: number };
  calls: RepRow[];
}

export interface FloorDashboard {
  categories: CategoryStat[];
  weakest: string | null;
  scope_run_ids: string[];
  scored_calls: number;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function countVerifiedQuotes(e: EvaluationRecord): number {
  return (
    e.clarity_evidence.length +
    e.confidence_evidence.length +
    e.structure_evidence.length +
    e.relevance_evidence.length +
    e.objection_playbook.reduce((s, o) => s + (o.evidence?.length || 0), 0)
  );
}

async function loadEvaluations(sessionIds: string[]): Promise<Map<string, EvaluationRecord>> {
  const out = new Map<string, EvaluationRecord>();
  if (sessionIds.length === 0) return out;
  const db = await getReadyDb();
  const res = await db.execute({
    sql: `SELECT session_id, ${EVALUATION_COLUMNS} FROM evaluations WHERE session_id IN (${sessionIds.map(() => "?").join(",")})`,
    args: sessionIds,
  });
  for (const row of res.rows) out.set(row.session_id as string, rowToEvaluation(row, row.session_id as string));
  return out;
}

/** Lowest mean handling score per category within one call (null if the call has no scored objections). */
function weakestInCall(e: EvaluationRecord): string | null {
  const byCat = new Map<string, number[]>();
  for (const o of e.objection_playbook) {
    if (typeof o.handling_score !== "number") continue;
    byCat.set(o.category, [...(byCat.get(o.category) || []), o.handling_score]);
  }
  let worst: { cat: string; mean: number } | null = null;
  byCat.forEach((scores, cat) => {
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (!worst || mean < worst.mean) worst = { cat, mean };
  });
  return worst ? (worst as { cat: string }).cat : null;
}

export async function listRuns(limit = 10): Promise<RunSummary[]> {
  const db = await getReadyDb();
  const runs = await db.execute({
    sql: `SELECT * FROM floor_runs ORDER BY scheduled_at DESC LIMIT ?`,
    args: [limit],
  });
  if (runs.rows.length === 0) return [];
  const runIds = runs.rows.map((r) => r.id as string);
  const calls = await db.execute({
    sql: `SELECT c.*, r.name AS rep_name FROM floor_calls c JOIN floor_reps r ON r.id = c.rep_id
          WHERE c.run_id IN (${runIds.map(() => "?").join(",")}) ORDER BY r.name ASC`,
    args: runIds,
  });
  const evals = await loadEvaluations(
    calls.rows.filter((c) => c.eval_status === "scored" && c.session_id).map((c) => c.session_id as string)
  );

  return runs.rows.map((run) => {
    const runCalls = calls.rows.filter((c) => c.run_id === run.id);
    const rows: RepRow[] = runCalls.map((c) => {
      const e = c.eval_status === "scored" ? evals.get(c.session_id as string) : undefined;
      return {
        call_id: c.id as string,
        rep_name: c.rep_name as string,
        call_status: c.call_status as string,
        duration_sec: c.duration_sec === null ? null : Number(c.duration_sec),
        eval_status: c.eval_status as string,
        eval_error: (c.eval_error as string | null) || null,
        prep_status: c.prep_status as string,
        prep_error: (c.prep_error as string | null) || null,
        overall_score: e ? e.overall_score : null,
        weakest_category: e ? weakestInCall(e) : null,
        verified_quotes: e ? countVerifiedQuotes(e) : null,
        report_token: createReportToken(c.id as string),
      };
    });
    return {
      id: run.id as string,
      scheduled_at: run.scheduled_at as string,
      status: run.status as string,
      error: (run.error as string | null) || null,
      auto_launch: Number(run.auto_launch) === 1,
      bolna_batch_id: (run.bolna_batch_id as string | null) || null,
      counts: {
        planned: rows.length,
        prepared: rows.filter((r) => r.prep_status === "ready").length,
        connected: rows.filter((r) => r.call_status === "completed").length,
        scored: rows.filter((r) => r.eval_status === "scored").length,
        not_scored: rows.filter((r) => r.eval_status === "not_scored").length,
        failed: rows.filter((r) => r.eval_status === "failed").length,
      },
      calls: rows,
    };
  });
}

/**
 * Floor-level objection handling across the given runs. Every number comes from a scored call; each category shows
 * its sample size, and only categories with at least MIN_N_TO_RANK scored objections can be called the weakest.
 */
export async function buildDashboard(runIds: string[]): Promise<FloorDashboard> {
  const db = await getReadyDb();
  const empty = PLAN_CATEGORIES.map((category) => ({ category, n: 0, mean: null, unanswered: 0, worst: null }));
  if (runIds.length === 0) return { categories: empty, weakest: null, scope_run_ids: [], scored_calls: 0 };

  const calls = await db.execute({
    sql: `SELECT c.id, c.session_id, r.name AS rep_name FROM floor_calls c JOIN floor_reps r ON r.id = c.rep_id
          WHERE c.eval_status = 'scored' AND c.run_id IN (${runIds.map(() => "?").join(",")})`,
    args: runIds,
  });
  const evals = await loadEvaluations(calls.rows.map((c) => c.session_id as string));

  const stats = new Map<string, { scores: number[]; unanswered: number; worst: CategoryStat["worst"] }>();
  for (const c of calls.rows) {
    const e = evals.get(c.session_id as string);
    if (!e) continue;
    for (const o of e.objection_playbook) {
      if (typeof o.handling_score !== "number") continue;
      const s = stats.get(o.category) || { scores: [], unanswered: 0, worst: null };
      s.scores.push(o.handling_score);
      if (o.user_turn_number === null) s.unanswered++;
      if (!s.worst || o.handling_score < s.worst.score) {
        s.worst = {
          score: o.handling_score,
          rep_name: c.rep_name as string,
          objection: o.objection,
          // Only verified text: a verbatim evidence quote, else the rep's own stored answer
          quote: o.evidence?.[0] || o.user_said,
          report_token: createReportToken(c.id as string),
        };
      }
      stats.set(o.category, s);
    }
  }

  const categories: CategoryStat[] = PLAN_CATEGORIES.map((category) => {
    const s = stats.get(category);
    if (!s || s.scores.length === 0) return { category, n: 0, mean: null, unanswered: 0, worst: null };
    return {
      category,
      n: s.scores.length,
      mean: round1(s.scores.reduce((a, b) => a + b, 0) / s.scores.length),
      unanswered: s.unanswered,
      worst: s.worst,
    };
  });
  const rankable = categories.filter((c) => c.n >= MIN_N_TO_RANK && c.mean !== null);
  const weakest = rankable.length ? rankable.reduce((a, b) => (b.mean! < a.mean! ? b : a)).category : null;

  return { categories, weakest, scope_run_ids: runIds, scored_calls: evals.size };
}

export interface CallReport {
  rep_name: string;
  scheduled_at: string;
  call_status: string;
  duration_sec: number | null;
  eval_status: string;
  eval_error: string | null;
  recording_url: string | null;
  objection_plan: PlannedObjection[];
  persona: PersonaRecord | null;
  evaluation: EvaluationRecord | null;
  turns: Turn[];
}

export async function getCallReport(callId: string): Promise<CallReport> {
  const db = await getReadyDb();
  const res = await db.execute({
    sql: `SELECT c.*, r.name AS rep_name, run.scheduled_at FROM floor_calls c
          JOIN floor_reps r ON r.id = c.rep_id JOIN floor_runs run ON run.id = c.run_id WHERE c.id = ?`,
    args: [callId],
  });
  if (res.rows.length === 0) throw new AppError("NOT_FOUND", "Report not found", 404);
  const c = res.rows[0];
  const sessionId = c.session_id as string | null;

  let persona: PersonaRecord | null = null;
  let evaluation: EvaluationRecord | null = null;
  let turns: Turn[] = [];
  if (sessionId) {
    const p = await db.execute({ sql: `SELECT * FROM personas WHERE session_id = ?`, args: [sessionId] });
    if (p.rows.length) {
      const r = p.rows[0];
      persona = {
        id: r.id as string,
        session_id: sessionId,
        name: r.name as string,
        title: r.title as string,
        company: r.company as string,
        background: r.background as string,
        risk_posture: r.risk_posture as PersonaRecord["risk_posture"],
        technical_depth: r.technical_depth as PersonaRecord["technical_depth"],
        business_priorities: JSON.parse(r.business_priorities as string),
        hot_buttons: JSON.parse(r.hot_buttons as string),
        conversational_style: r.conversational_style as string,
        uncertain_fields: JSON.parse((r.uncertain_fields as string) || "[]"),
        edited_by_user: Number(r.edited_by_user) === 1,
        updated_at: r.updated_at as string,
      };
    }
    if (c.eval_status === "scored") evaluation = (await loadEvaluations([sessionId])).get(sessionId) || null;
    turns = await loadTurns(sessionId);
  }

  return {
    rep_name: c.rep_name as string,
    scheduled_at: c.scheduled_at as string,
    call_status: c.call_status as string,
    duration_sec: c.duration_sec === null ? null : Number(c.duration_sec),
    eval_status: c.eval_status as string,
    eval_error: (c.eval_error as string | null) || null,
    recording_url: (c.recording_url as string | null) || null,
    objection_plan: JSON.parse((c.objection_plan as string) || "[]"),
    persona,
    evaluation,
    turns,
  };
}
