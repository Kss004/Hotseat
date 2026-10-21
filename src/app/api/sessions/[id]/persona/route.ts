import { NextResponse } from "next/server";
import { getReadyDb } from "@/lib/db";
import { getLLMRouter } from "@/lib/ai/router";
import {
  getPersonaSystemPrompt,
  getPersonaUserPrompt,
  PERSONA_PROMPT_VERSION,
} from "@/lib/ai/prompts/persona";
import { personaSchema, type PersonaData } from "@/types";
import { toErrorResponse, AppError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rateLimit";

// LLM calls (with failover and one repair retry) can outlast the default serverless timeout.
export const maxDuration = 120;
// The AI failover chain must finish inside maxDuration so a slow provider ends in LLM_UNAVAILABLE, not a platform 504
const AI_BUDGET_MS = 100_000;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    await enforceRateLimit(req, "persona-generate");
    const sessionId = params.id;
    const db = await getReadyDb();

    // 1. Fetch session
    const sessionRes = await db.execute({
      sql: `SELECT id, raw_input, target_url, meeting_context FROM sessions WHERE id = ?`,
      args: [sessionId],
    });

    if (sessionRes.rows.length === 0) {
      throw new AppError("NOT_FOUND", "Session not found", 404);
    }

    const s = sessionRes.rows[0];
    const rawInput = s.raw_input as string;
    const targetUrl = s.target_url as string | null;
    const meetingContext = JSON.parse(s.meeting_context as string);

    // 2. Call LLM Router
    const router = getLLMRouter();
    const systemPrompt = getPersonaSystemPrompt();
    const userPrompt = getPersonaUserPrompt({
      rawInput,
      targetUrl,
      meetingContext,
    });

    const llmResult = await router.complete<PersonaData>({
      budgetMs: AI_BUDGET_MS,
      purpose: "persona",
      system: systemPrompt,
      user: userPrompt,
      schema: personaSchema,
      promptVersion: PERSONA_PROMPT_VERSION,
      sessionId,
    });

    const persona = llmResult.data;
    const personaId = `pers_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // 3. Upsert into personas table (RETURNING gives the stored id, which differs from personaId on regenerate)
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
        personaId,
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

    // 4. Update session status
    await db.execute({
      sql: `UPDATE sessions SET status = 'persona_ready' WHERE id = ?`,
      args: [sessionId],
    });

    return NextResponse.json({
      ok: true,
      persona: {
        id: saved.rows[0].id as string,
        session_id: sessionId,
        ...persona,
        edited_by_user: false,
        updated_at: new Date().toISOString(),
      },
      provider: llmResult.provider,
      model: llmResult.model,
    });
  } catch (err) {
    const errResp = toErrorResponse(err);
    return NextResponse.json(errResp.body, { status: errResp.status });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    await enforceRateLimit(req, "persona-edit");
    const sessionId = params.id;
    const json = await req.json();

    const parsed = personaSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          code: "VALIDATION",
          message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
          details: parsed.error.issues,
        },
        { status: 400 }
      );
    }

    const db = await getReadyDb();
    const updated = parsed.data;

    // Check if persona exists for session
    const existingRes = await db.execute({
      sql: `SELECT id FROM personas WHERE session_id = ?`,
      args: [sessionId],
    });

    if (existingRes.rows.length === 0) {
      throw new AppError("NOT_FOUND", "No persona exists for this session to update", 404);
    }

    await db.execute({
      sql: `UPDATE personas
            SET name = ?, title = ?, company = ?, background = ?,
                risk_posture = ?, technical_depth = ?, business_priorities = ?,
                hot_buttons = ?, conversational_style = ?, uncertain_fields = ?,
                edited_by_user = 1, updated_at = CURRENT_TIMESTAMP
            WHERE session_id = ?`,
      args: [
        updated.name,
        updated.title,
        updated.company,
        updated.background,
        updated.risk_posture,
        updated.technical_depth,
        JSON.stringify(updated.business_priorities),
        JSON.stringify(updated.hot_buttons),
        updated.conversational_style,
        JSON.stringify(updated.uncertain_fields || []),
        sessionId,
      ],
    });

    return NextResponse.json({
      ok: true,
      persona: {
        session_id: sessionId,
        ...updated,
        edited_by_user: true,
        updated_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    const errResp = toErrorResponse(err);
    return NextResponse.json(errResp.body, { status: errResp.status });
  }
}
