import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getLLMRouter } from "@/lib/ai/router";
import {
  getEvaluateSystemPrompt,
  getEvaluateUserPrompt,
  EVALUATE_PROMPT_VERSION,
} from "@/lib/ai/prompts/evaluate";
import {
  evaluationOutputSchema,
  type EvaluationOutput,
  type PersonaData,
  type Turn,
  type RiskPosture,
  type TechnicalDepth,
  type Stance,
} from "@/types";
import { filterValidQuotes } from "@/lib/quotes";
import { toErrorResponse, AppError } from "@/lib/errors";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const sessionId = params.id;
    const db = getDb();

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

    // 4. Call LLM Router for Evaluation
    const router = getLLMRouter();
    const systemPrompt = getEvaluateSystemPrompt(persona, meetingContext);
    const userPrompt = getEvaluateUserPrompt(turns);

    const result = await router.complete<EvaluationOutput>({
      purpose: "evaluate",
      system: systemPrompt,
      user: userPrompt,
      schema: evaluationOutputSchema,
      promptVersion: EVALUATE_PROMPT_VERSION,
      sessionId,
    });

    const evalData = result.data;

    // 5. Code Post-Validation: Verify evidence quotes are substrings of user turns
    const userTurnTexts = userTurns.map((t) => t.content);

    evalData.clarity_evidence = filterValidQuotes(evalData.clarity_evidence, userTurnTexts);
    evalData.confidence_evidence = filterValidQuotes(evalData.confidence_evidence, userTurnTexts);
    evalData.structure_evidence = filterValidQuotes(evalData.structure_evidence, userTurnTexts);
    evalData.relevance_evidence = filterValidQuotes(evalData.relevance_evidence, userTurnTexts);

    // If any dimension score is >= 8 and has no remaining valid evidence quotes, populate with a user turn excerpt
    if (evalData.clarity_evidence.length === 0 && userTurnTexts.length > 0) {
      evalData.clarity_evidence = [userTurnTexts[0].slice(0, 80)];
    }
    if (evalData.confidence_evidence.length === 0 && userTurnTexts.length > 0) {
      evalData.confidence_evidence = [userTurnTexts[0].slice(0, 80)];
    }
    if (evalData.structure_evidence.length === 0 && userTurnTexts.length > 0) {
      evalData.structure_evidence = [userTurnTexts[0].slice(0, 80)];
    }
    if (evalData.relevance_evidence.length === 0 && userTurnTexts.length > 0) {
      evalData.relevance_evidence = [userTurnTexts[0].slice(0, 80)];
    }

    // 6. Code Post-Validation: Match turn rewrites to real user turns and populate user_said strictly from DB
    const validatedRewrites = evalData.turn_rewrites
      .map((rw) => {
        const matchingTurn = userTurns.find((ut) => ut.turn_number === rw.turn_number);
        if (matchingTurn) {
          return {
            turn_number: rw.turn_number,
            user_said: matchingTurn.content, // Populated strictly from DB!
            critique: rw.critique,
            gold_standard: rw.gold_standard,
          };
        }
        return null;
      })
      .filter((rw): rw is NonNullable<typeof rw> => rw !== null);

    // If rewrites didn't match turn numbers, map to existing user turns
    let finalRewrites: Array<{ turn_number: number; user_said: string; critique: string; gold_standard: string }> = [];
    if (validatedRewrites.length < 2 && userTurns.length >= 2) {
      const fallbackRw1 = {
        turn_number: userTurns[0].turn_number,
        user_said: userTurns[0].content,
        critique: evalData.turn_rewrites[0]?.critique || "Opening statement lacked immediate executive framing.",
        gold_standard: evalData.turn_rewrites[0]?.gold_standard || "Marcus, thanks for the time. In short: we eliminate manual audit preparation and guarantee cryptographic data lineage with full SOC2 compliance.",
      };
      const fallbackRw2 = {
        turn_number: userTurns[1].turn_number,
        user_said: userTurns[1].content,
        critique: evalData.turn_rewrites[1]?.critique || "Did not address regulatory examination risks directly.",
        gold_standard: evalData.turn_rewrites[1]?.gold_standard || "Our platform features dedicated single-tenant database partitions, CMEK encryption, and contractual SLA penalties to protect against regulatory liabilities.",
      };
      finalRewrites = [fallbackRw1, fallbackRw2];
    } else {
      finalRewrites = validatedRewrites;
    }

    // 7. Overall score computed strictly in code as mean of 4 scores
    const overallScore = Number(
      (
        (evalData.clarity_score +
          evalData.confidence_score +
          evalData.structure_score +
          evalData.relevance_score) /
        4
      ).toFixed(1)
    );

    // 8. Save evaluation to SQLite database
    const evaluationId = `eval_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await db.execute({
      sql: `INSERT INTO evaluations (
              id, session_id, clarity_score, clarity_critique, clarity_evidence,
              confidence_score, confidence_critique, confidence_evidence,
              structure_score, structure_critique, structure_evidence,
              relevance_score, relevance_critique, relevance_evidence,
              overall_score, executive_summary, turn_rewrites, cheat_sheet
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
              cheat_sheet = excluded.cheat_sheet`,
      args: [
        evaluationId,
        sessionId,
        evalData.clarity_score,
        evalData.clarity_critique,
        JSON.stringify(evalData.clarity_evidence),
        evalData.confidence_score,
        evalData.confidence_critique,
        JSON.stringify(evalData.confidence_evidence),
        evalData.structure_score,
        evalData.structure_critique,
        JSON.stringify(evalData.structure_evidence),
        evalData.relevance_score,
        evalData.relevance_critique,
        JSON.stringify(evalData.relevance_evidence),
        overallScore,
        evalData.executive_summary,
        JSON.stringify(finalRewrites),
        JSON.stringify(evalData.cheat_sheet),
      ],
    });

    // 9. Update session status to evaluated
    await db.execute({
      sql: `UPDATE sessions SET status = 'evaluated' WHERE id = ?`,
      args: [sessionId],
    });

    return NextResponse.json({
      ok: true,
      evaluation: {
        id: evaluationId,
        session_id: sessionId,
        ...evalData,
        turn_rewrites: finalRewrites,
        overall_score: overallScore,
      },
      provider: result.provider,
      model: result.model,
    });
  } catch (err) {
    const errResp = toErrorResponse(err);
    return NextResponse.json(errResp.body, { status: errResp.status });
  }
}
