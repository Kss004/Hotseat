import { NextResponse } from "next/server";
import { getReadyDb } from "@/lib/db";
import { personaSchema } from "@/types";
import { generatePersona } from "@/lib/pipeline";
import { toErrorResponse, AppError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rateLimit";

// LLM calls (with failover and one repair retry) can outlast the default serverless timeout.
export const maxDuration = 120;
// The AI failover chain must finish inside maxDuration so a slow provider ends in LLM_UNAVAILABLE, not a platform 504
const AI_BUDGET_MS = 100_000;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    await enforceRateLimit(req, "persona-generate");
    const result = await generatePersona(params.id, AI_BUDGET_MS);
    return NextResponse.json({ ok: true, ...result });
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
