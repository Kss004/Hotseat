import { NextResponse } from "next/server";
import { getReadyDb } from "@/lib/db";
import { toErrorResponse, AppError } from "@/lib/errors";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const sessionId = params.id;
    const db = await getReadyDb();

    const sessionRes = await db.execute({
      sql: `SELECT id, status FROM sessions WHERE id = ?`,
      args: [sessionId],
    });

    if (sessionRes.rows.length === 0) {
      throw new AppError("NOT_FOUND", "Session not found", 404);
    }

    // An ended session can't take more turns, so ending before 2 user turns would leave it unevaluable forever
    const userTurns = await db.execute({
      sql: `SELECT COUNT(*) AS c FROM turns WHERE session_id = ? AND role = 'user'`,
      args: [sessionId],
    });
    if (Number(userTurns.rows[0].c) < 2) {
      throw new AppError("INSUFFICIENT_TURNS", "Reply to the persona at least twice before ending the simulation.", 400);
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
