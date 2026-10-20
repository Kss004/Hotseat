import { NextResponse } from "next/server";
import { getReadyDb } from "@/lib/db";
import { getLLMRouter } from "@/lib/ai/router";
import {
  getScenariosSystemPrompt,
  getScenariosUserPrompt,
  SCENARIOS_PROMPT_VERSION,
} from "@/lib/ai/prompts/scenarios";
import {
  scenariosOutputSchema,
  type ScenariosOutput,
  type PersonaData,
  type RiskPosture,
  type TechnicalDepth,
} from "@/types";
import { toErrorResponse, AppError } from "@/lib/errors";

// LLM calls (with failover and one repair retry) can outlast the default serverless timeout.
export const maxDuration = 60;

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
                   business_priorities, hot_buttons, conversational_style, uncertain_fields
            FROM personas WHERE session_id = ?`,
      args: [sessionId],
    });

    if (personaRes.rows.length === 0) {
      throw new AppError("VALIDATION", "No persona found for this session. Generate persona first.", 400);
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
      uncertain_fields: JSON.parse((p.uncertain_fields as string) || "[]"),
    };

    // 3. Call LLM Router for single combined call
    const router = getLLMRouter();
    const systemPrompt = getScenariosSystemPrompt();
    const userPrompt = getScenariosUserPrompt(persona, meetingContext);

    const result = await router.complete<ScenariosOutput>({
      purpose: "scenarios",
      system: systemPrompt,
      user: userPrompt,
      schema: scenariosOutputSchema,
      promptVersion: SCENARIOS_PROMPT_VERSION,
      sessionId,
    });

    const scenarios = result.data;
    const scenariosId = `scen_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // 4. Save to database
    const saved = await db.execute({
      sql: `INSERT INTO scenarios (id, session_id, objections, strategic_questions)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
              objections = excluded.objections,
              strategic_questions = excluded.strategic_questions
            RETURNING id`,
      args: [
        scenariosId,
        sessionId,
        JSON.stringify(scenarios.objections),
        JSON.stringify(scenarios.strategic_questions),
      ],
    });

    // 5. Update session status
    await db.execute({
      sql: `UPDATE sessions SET status = 'scenarios_ready' WHERE id = ?`,
      args: [sessionId],
    });

    return NextResponse.json({
      ok: true,
      scenarios: {
        id: saved.rows[0].id as string,
        session_id: sessionId,
        ...scenarios,
      },
      provider: result.provider,
      model: result.model,
    });
  } catch (err) {
    const errResp = toErrorResponse(err);
    return NextResponse.json(errResp.body, { status: errResp.status });
  }
}
