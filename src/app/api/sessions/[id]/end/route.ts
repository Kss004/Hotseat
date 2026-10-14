import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { toErrorResponse, AppError } from "@/lib/errors";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const sessionId = params.id;
    const db = getDb();

    const sessionRes = await db.execute({
      sql: `SELECT id, status FROM sessions WHERE id = ?`,
      args: [sessionId],
    });

    if (sessionRes.rows.length === 0) {
      throw new AppError("NOT_FOUND", "Session not found", 404);
    }

    await db.execute({
      sql: `UPDATE sessions SET status = 'ended' WHERE id = ?`,
      args: [sessionId],
    });

    return NextResponse.json({
      ok: true,
      session_id: sessionId,
      status: "ended",
    });
  } catch (err) {
    const errResp = toErrorResponse(err);
    return NextResponse.json(errResp.body, { status: errResp.status });
  }
}
