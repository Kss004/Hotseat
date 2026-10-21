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
import { enforceRateLimit } from "@/lib/rateLimit";
import { researchForSession } from "@/lib/research";

// LLM calls (with failover and one repair retry) can outlast the default serverless timeout.
export const maxDuration = 120;
// The AI failover chain must finish inside maxDuration (after research) so a slow provider ends in LLM_UNAVAILABLE, not a platform 504
const ROUTE_BUDGET_MS = 100_000;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const routeStart = Date.now();
  try {
    await enforceRateLimit(req, "scenarios");
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

    // 3. Live company research (Tavily). Never throws; skipped or failed research is reported, not faked
    const research = await researchForSession(sessionId, persona, meetingContext);

    // 4. Call LLM Router for single combined call
    const router = getLLMRouter();
    const systemPrompt = getScenariosSystemPrompt();
    const userPrompt = getScenariosUserPrompt(persona, meetingContext, research.findings);

    const result = await router.complete<ScenariosOutput>({
      budgetMs: ROUTE_BUDGET_MS - (Date.now() - routeStart),
      purpose: "scenarios",
      system: systemPrompt,
      user: userPrompt,
      schema: scenariosOutputSchema,
      promptVersion: SCENARIOS_PROMPT_VERSION,
      sessionId,
    });

    const scenarios = result.data;
    const scenariosId = `scen_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // 5. Save to database
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

    // 6. Update session status
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
      research,
      provider: result.provider,
      model: result.model,
    });
  } catch (err) {
    const errResp = toErrorResponse(err);
    return NextResponse.json(errResp.body, { status: errResp.status });
  }
}
