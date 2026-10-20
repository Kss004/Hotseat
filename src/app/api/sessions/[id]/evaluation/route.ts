import { NextResponse } from "next/server";
import { getReadyDb } from "@/lib/db";
import { EVALUATION_COLUMNS, rowToEvaluation } from "@/lib/evaluation";
import { toErrorResponse, AppError } from "@/lib/errors";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const sessionId = params.id;
    const db = await getReadyDb();

    const evalRes = await db.execute({
      sql: `SELECT ${EVALUATION_COLUMNS} FROM evaluations WHERE session_id = ?`,
      args: [sessionId],
    });

    if (evalRes.rows.length === 0) {
      throw new AppError("NOT_FOUND", "Evaluation not found for this session", 404);
    }

    return NextResponse.json({ ok: true, evaluation: rowToEvaluation(evalRes.rows[0], sessionId) });
  } catch (err) {
    const errResp = toErrorResponse(err);
    return NextResponse.json(errResp.body, { status: errResp.status });
  }
}
