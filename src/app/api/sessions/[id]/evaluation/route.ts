import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { toErrorResponse, AppError } from "@/lib/errors";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const sessionId = params.id;
    const db = getDb();

    const evalRes = await db.execute({
      sql: `SELECT id, clarity_score, clarity_critique, clarity_evidence,
                   confidence_score, confidence_critique, confidence_evidence,
                   structure_score, structure_critique, structure_evidence,
                   relevance_score, relevance_critique, relevance_evidence,
                   overall_score, executive_summary, turn_rewrites, cheat_sheet
            FROM evaluations WHERE session_id = ?`,
      args: [sessionId],
    });

    if (evalRes.rows.length === 0) {
      throw new AppError("NOT_FOUND", "Evaluation not found for this session", 404);
    }

    const e = evalRes.rows[0];
    const evaluation = {
      id: e.id as string,
      session_id: sessionId,
      clarity_score: Number(e.clarity_score),
      clarity_critique: e.clarity_critique as string,
      clarity_evidence: JSON.parse(e.clarity_evidence as string),
      confidence_score: Number(e.confidence_score),
      confidence_critique: e.confidence_critique as string,
      confidence_evidence: JSON.parse(e.confidence_evidence as string),
      structure_score: Number(e.structure_score),
      structure_critique: e.structure_critique as string,
      structure_evidence: JSON.parse(e.structure_evidence as string),
      relevance_score: Number(e.relevance_score),
      relevance_critique: e.relevance_critique as string,
      relevance_evidence: JSON.parse(e.relevance_evidence as string),
      overall_score: Number(e.overall_score),
      executive_summary: e.executive_summary as string,
      turn_rewrites: JSON.parse(e.turn_rewrites as string),
      cheat_sheet: JSON.parse(e.cheat_sheet as string),
    };

    return NextResponse.json({ ok: true, evaluation });
  } catch (err) {
    const errResp = toErrorResponse(err);
    return NextResponse.json(errResp.body, { status: errResp.status });
  }
}
