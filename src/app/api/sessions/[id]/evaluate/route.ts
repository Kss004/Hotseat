import { NextResponse } from "next/server";
import { getReadyDb } from "@/lib/db";
import { getLLMRouter } from "@/lib/ai/router";
import {
  getEvaluateSystemPrompt,
  getEvaluateUserPrompt,
  EVALUATE_PROMPT_VERSION,
} from "@/lib/ai/prompts/evaluate";
import {
  buildEvaluationSchema,
  type EvaluationOutput,
  type EvaluationRecord,
  type PersonaData,
  type Turn,
  type RiskPosture,
  type TechnicalDepth,
  type Stance,
} from "@/types";
import { postValidateEvaluation } from "@/lib/evaluation";
import { toErrorResponse, AppError } from "@/lib/errors";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const sessionId = params.id;
    const db = await getReadyDb();

    // 1. Fetch session
    const sessionRes = await db.execute({
      sql: `SELECT id, meeting_context FROM sessions WHERE id = ?`,
      args: [sessionId],
    });
    if (sessionRes.rows.length === 0) {
      throw new AppError("NOT_FOUND", "Session not found", 404);
    }
    const meetingContext = JSON.parse(sessionRes.rows[0].meeting_context as string);

    // 2. Fetch persona
    const personaRes = await db.execute({
      sql: `SELECT name, title, company, background, risk_posture, technical_depth,
                   business_priorities, hot_buttons, conversational_style FROM personas WHERE session_id = ?`,
      args: [sessionId],
    });
    if (personaRes.rows.length === 0) {
      throw new AppError("VALIDATION", "Persona not found", 400);
    }
    const p = personaRes.rows[0];
    const persona: PersonaData = {
      name: p.name as string,
      title: p.title as string,
      company: p.company as string,
      background: p.background as string,
      risk_posture: p.risk_posture as RiskPosture,
      technical_depth: p.technical_depth as TechnicalDepth,
      business_priorities: JSON.parse(p.business_priorities as string),
      hot_buttons: JSON.parse(p.hot_buttons as string),
      conversational_style: p.conversational_style as string,
      uncertain_fields: [],
    };

    // 3. Fetch turns
    const turnsRes = await db.execute({
      sql: `SELECT id, turn_number, role, content, stance, created_at
            FROM turns WHERE session_id = ? ORDER BY turn_number ASC`,
      args: [sessionId],
    });

    const turns: Turn[] = turnsRes.rows.map((r) => ({
      id: r.id as string,
      session_id: sessionId,
      turn_number: Number(r.turn_number),
      role: r.role as "user" | "assistant",
      content: r.content as string,
      stance: (r.stance as Stance | null) || null,
      created_at: r.created_at as string,
    }));

    const userTurns = turns.filter((t) => t.role === "user");
    if (userTurns.length < 2) {
      throw new AppError(
        "INSUFFICIENT_TURNS",
        `Evaluation requires at least 2 user turns. Completed user turns: ${userTurns.length}`,
        400
      );
    }

    // 4. Call LLM Router for Evaluation. The schema is built per request so rewrite turn numbers
    //    that don't point at a real user turn fail validation and go through the single repair retry.
    const router = getLLMRouter();
    const result = await router.complete<EvaluationOutput>({
      purpose: "evaluate",
      system: getEvaluateSystemPrompt(persona, meetingContext),
      user: getEvaluateUserPrompt(turns),
      schema: buildEvaluationSchema(userTurns.map((t) => t.turn_number)),
      promptVersion: EVALUATE_PROMPT_VERSION,
      sessionId,
    });

    // 5. Code post-validation: verbatim quotes, DB-sourced user_said, overall score computed in code
    const { evaluation, droppedQuotes } = postValidateEvaluation(result.data, userTurns);
    if (droppedQuotes > 0) {
      console.warn(`Evaluation ${sessionId}: dropped ${droppedQuotes} evidence quote(s) not found verbatim in a user turn`);
    }

    // 6. Save evaluation (one per session; re-evaluating replaces it)
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

    // 7. Update session status to evaluated
    await db.execute({
      sql: `UPDATE sessions SET status = 'evaluated' WHERE id = ?`,
      args: [sessionId],
    });

    const record: EvaluationRecord = {
      id: saved.rows[0].id as string,
      session_id: sessionId,
      ...evaluation,
    };

    return NextResponse.json({
      ok: true,
      evaluation: record,
      provider: result.provider,
      model: result.model,
    });
  } catch (err) {
    const errResp = toErrorResponse(err);
    return NextResponse.json(errResp.body, { status: errResp.status });
  }
}
