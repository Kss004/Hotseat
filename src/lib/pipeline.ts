import { getReadyDb } from "@/lib/db";
import { getLLMRouter } from "@/lib/ai/router";
import { getPersonaSystemPrompt, getPersonaUserPrompt, PERSONA_PROMPT_VERSION } from "@/lib/ai/prompts/persona";
import { getScenariosSystemPrompt, getScenariosUserPrompt, SCENARIOS_PROMPT_VERSION } from "@/lib/ai/prompts/scenarios";
import { getEvaluateSystemPrompt, getEvaluateUserPrompt, EVALUATE_PROMPT_VERSION } from "@/lib/ai/prompts/evaluate";
import {
  personaSchema,
  scenariosOutputSchema,
  buildEvaluationSchema,
  type PersonaData,
  type PersonaRecord,
  type ScenariosOutput,
  type ScenariosRecord,
  type EvaluationOutput,
  type EvaluationRecord,
  type ResearchRecord,
  type Turn,
  type RiskPosture,
  type TechnicalDepth,
  type Stance,
} from "@/types";
import { postValidateEvaluation } from "@/lib/evaluation";
import { AppError } from "@/lib/errors";
import { researchForSession } from "@/lib/research";

/**
 * The session pipeline shared by the web routes and the Hotseat Floor job queue:
 * persona -> scenarios -> (turns) -> evaluation. Every step validates LLM output with Zod (one repair retry in the
 * router) and post-validates in code, so a voice call is held to exactly the same rules as a typed session.
 */

export async function loadPersona(sessionId: string): Promise<PersonaData | null> {
  const db = await getReadyDb();
  const res = await db.execute({
    sql: `SELECT name, title, company, background, risk_posture, technical_depth,
                 business_priorities, hot_buttons, conversational_style, uncertain_fields
          FROM personas WHERE session_id = ?`,
    args: [sessionId],
  });
  if (res.rows.length === 0) return null;
  const p = res.rows[0];
  return {
    name: p.name as string,
    title: p.title as string,
    company: p.company as string,
    background: p.background as string,
    risk_posture: p.risk_posture as RiskPosture,
    technical_depth: p.technical_depth as TechnicalDepth,
    business_priorities: JSON.parse(p.business_priorities as string),
    hot_buttons: JSON.parse(p.hot_buttons as string),
    conversational_style: p.conversational_style as string,
    uncertain_fields: JSON.parse((p.uncertain_fields as string) || "[]"),
  };
}

export async function loadTurns(sessionId: string): Promise<Turn[]> {
  const db = await getReadyDb();
  const res = await db.execute({
    sql: `SELECT id, turn_number, role, content, stance, created_at
          FROM turns WHERE session_id = ? ORDER BY turn_number ASC`,
    args: [sessionId],
  });
  return res.rows.map((r) => ({
    id: r.id as string,
    session_id: sessionId,
    turn_number: Number(r.turn_number),
    role: r.role as "user" | "assistant",
    content: r.content as string,
    stance: (r.stance as Stance | null) || null,
    created_at: r.created_at as string,
  }));
}

async function loadMeetingContext(sessionId: string, columns = "meeting_context") {
  const db = await getReadyDb();
  const res = await db.execute({ sql: `SELECT id, ${columns} FROM sessions WHERE id = ?`, args: [sessionId] });
  if (res.rows.length === 0) throw new AppError("NOT_FOUND", "Session not found", 404);
  return res.rows[0];
}

export async function generatePersona(sessionId: string, budgetMs: number) {
  const s = await loadMeetingContext(sessionId, "raw_input, target_url, meeting_context");
  const meetingContext = JSON.parse(s.meeting_context as string);

  const result = await getLLMRouter().complete<PersonaData>({
    budgetMs,
    purpose: "persona",
    system: getPersonaSystemPrompt(),
    user: getPersonaUserPrompt({
      rawInput: s.raw_input as string,
      targetUrl: s.target_url as string | null,
      meetingContext,
    }),
    schema: personaSchema,
    promptVersion: PERSONA_PROMPT_VERSION,
    sessionId,
  });
  const persona = result.data;

  const db = await getReadyDb();
  // RETURNING gives the stored id, which differs from the new id on regenerate
  const saved = await db.execute({
    sql: `INSERT INTO personas (
            id, session_id, name, title, company, background,
            risk_posture, technical_depth, business_priorities,
            hot_buttons, conversational_style, uncertain_fields, edited_by_user
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
          ON CONFLICT(session_id) DO UPDATE SET
            name = excluded.name,
            title = excluded.title,
            company = excluded.company,
            background = excluded.background,
            risk_posture = excluded.risk_posture,
            technical_depth = excluded.technical_depth,
            business_priorities = excluded.business_priorities,
            hot_buttons = excluded.hot_buttons,
            conversational_style = excluded.conversational_style,
            uncertain_fields = excluded.uncertain_fields,
            edited_by_user = 0,
            updated_at = CURRENT_TIMESTAMP
          RETURNING id`,
    args: [
      `pers_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      sessionId,
      persona.name,
      persona.title,
      persona.company,
      persona.background,
      persona.risk_posture,
      persona.technical_depth,
      JSON.stringify(persona.business_priorities),
      JSON.stringify(persona.hot_buttons),
      persona.conversational_style,
      JSON.stringify(persona.uncertain_fields || []),
    ],
  });
  await db.execute({ sql: `UPDATE sessions SET status = 'persona_ready' WHERE id = ?`, args: [sessionId] });

  const record: PersonaRecord = {
    id: saved.rows[0].id as string,
    session_id: sessionId,
    ...persona,
    edited_by_user: false,
    updated_at: new Date().toISOString(),
  };
  return { persona: record, provider: result.provider, model: result.model };
}

export async function generateScenarios(sessionId: string, budgetMs: number) {
  const start = Date.now();
  const s = await loadMeetingContext(sessionId);
  const meetingContext = JSON.parse(s.meeting_context as string);

  const persona = await loadPersona(sessionId);
  if (!persona) {
    throw new AppError("VALIDATION", "No persona found for this session. Generate persona first.", 400);
  }

  // Live company research (Tavily). Never throws; skipped or failed research is reported, not faked
  const research: ResearchRecord = await researchForSession(sessionId, persona, meetingContext);

  const result = await getLLMRouter().complete<ScenariosOutput>({
    budgetMs: budgetMs - (Date.now() - start),
    purpose: "scenarios",
    system: getScenariosSystemPrompt(),
    user: getScenariosUserPrompt(persona, meetingContext, research.findings),
    schema: scenariosOutputSchema,
    promptVersion: SCENARIOS_PROMPT_VERSION,
    sessionId,
  });
  const scenarios = result.data;

  const db = await getReadyDb();
  const saved = await db.execute({
    sql: `INSERT INTO scenarios (id, session_id, objections, strategic_questions)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET
            objections = excluded.objections,
            strategic_questions = excluded.strategic_questions
          RETURNING id`,
    args: [
      `scen_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      sessionId,
      JSON.stringify(scenarios.objections),
      JSON.stringify(scenarios.strategic_questions),
    ],
  });
  await db.execute({ sql: `UPDATE sessions SET status = 'scenarios_ready' WHERE id = ?`, args: [sessionId] });

  const record: ScenariosRecord = { id: saved.rows[0].id as string, session_id: sessionId, ...scenarios };
  return { scenarios: record, research, provider: result.provider, model: result.model };
}

export async function evaluateSession(sessionId: string, opts: { budgetMs: number; callTimeoutMs: number }) {
  const start = Date.now();
  const s = await loadMeetingContext(sessionId);
  const meetingContext = JSON.parse(s.meeting_context as string);

  const persona = await loadPersona(sessionId);
  if (!persona) throw new AppError("VALIDATION", "Persona not found", 400);

  const turns = await loadTurns(sessionId);
  const userTurns = turns.filter((t) => t.role === "user");
  if (userTurns.length < 2) {
    throw new AppError(
      "INSUFFICIENT_TURNS",
      `Evaluation requires at least 2 user turns. Completed user turns: ${userTurns.length}`,
      400
    );
  }

  // The schema is built per request so rewrite turn numbers that don't point at a real user turn fail validation
  // and go through the single repair retry.
  const result = await getLLMRouter().complete<EvaluationOutput>({
    timeoutMs: opts.callTimeoutMs,
    budgetMs: opts.budgetMs - (Date.now() - start),
    purpose: "evaluate",
    system: getEvaluateSystemPrompt(persona, meetingContext),
    user: getEvaluateUserPrompt(turns),
    schema: buildEvaluationSchema(userTurns.map((t) => t.turn_number)),
    promptVersion: EVALUATE_PROMPT_VERSION,
    sessionId,
  });

  // Code post-validation: verbatim quotes, DB-sourced user_said, overall score computed in code
  const { evaluation, droppedQuotes } = postValidateEvaluation(result.data, userTurns);
  if (droppedQuotes > 0) {
    console.warn(`Evaluation ${sessionId}: dropped ${droppedQuotes} evidence quote(s) not found verbatim in a user turn`);
  }

  const db = await getReadyDb();
  // One evaluation per session; re-evaluating replaces it
  const saved = await db.execute({
    sql: `INSERT INTO evaluations (
            id, session_id, clarity_score, clarity_critique, clarity_evidence,
            confidence_score, confidence_critique, confidence_evidence,
            structure_score, structure_critique, structure_evidence,
            relevance_score, relevance_critique, relevance_evidence,
            overall_score, executive_summary, turn_rewrites, objection_playbook, cheat_sheet
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET
            clarity_score = excluded.clarity_score,
            clarity_critique = excluded.clarity_critique,
            clarity_evidence = excluded.clarity_evidence,
            confidence_score = excluded.confidence_score,
            confidence_critique = excluded.confidence_critique,
            confidence_evidence = excluded.confidence_evidence,
            structure_score = excluded.structure_score,
            structure_critique = excluded.structure_critique,
            structure_evidence = excluded.structure_evidence,
            relevance_score = excluded.relevance_score,
            relevance_critique = excluded.relevance_critique,
            relevance_evidence = excluded.relevance_evidence,
            overall_score = excluded.overall_score,
            executive_summary = excluded.executive_summary,
            turn_rewrites = excluded.turn_rewrites,
            objection_playbook = excluded.objection_playbook,
            cheat_sheet = excluded.cheat_sheet
          RETURNING id`,
    args: [
      `eval_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      sessionId,
      evaluation.clarity_score,
      evaluation.clarity_critique,
      JSON.stringify(evaluation.clarity_evidence),
      evaluation.confidence_score,
      evaluation.confidence_critique,
      JSON.stringify(evaluation.confidence_evidence),
      evaluation.structure_score,
      evaluation.structure_critique,
      JSON.stringify(evaluation.structure_evidence),
      evaluation.relevance_score,
      evaluation.relevance_critique,
      JSON.stringify(evaluation.relevance_evidence),
      evaluation.overall_score,
      evaluation.executive_summary,
      JSON.stringify(evaluation.turn_rewrites),
      JSON.stringify(evaluation.objection_playbook),
      JSON.stringify(evaluation.cheat_sheet),
    ],
  });
  await db.execute({ sql: `UPDATE sessions SET status = 'evaluated' WHERE id = ?`, args: [sessionId] });

  const record: EvaluationRecord = { id: saved.rows[0].id as string, session_id: sessionId, ...evaluation };
  return { evaluation: record, provider: result.provider, model: result.model };
}
