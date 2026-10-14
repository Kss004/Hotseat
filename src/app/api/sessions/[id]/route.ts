import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { toErrorResponse } from "@/lib/errors";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const sessionId = params.id;
    const db = getDb();

    // 1. Fetch session
    const sessionRes = await db.execute({
      sql: `SELECT id, created_at, title, target_url, raw_input, meeting_context, difficulty, max_turns, status
            FROM sessions WHERE id = ?`,
      args: [sessionId],
    });

    if (sessionRes.rows.length === 0) {
      return NextResponse.json({ code: "NOT_FOUND", message: "Session not found" }, { status: 404 });
    }

    const s = sessionRes.rows[0];
    const session = {
      id: s.id as string,
      created_at: s.created_at as string,
      title: s.title as string,
      target_url: s.target_url as string | null,
      raw_input: s.raw_input as string,
      meeting_context: JSON.parse(s.meeting_context as string),
      difficulty: s.difficulty as string,
      max_turns: Number(s.max_turns),
      status: s.status as string,
    };

    // 2. Fetch persona if exists
    const personaRes = await db.execute({
      sql: `SELECT id, name, title, company, background, risk_posture, technical_depth,
                   business_priorities, hot_buttons, conversational_style, uncertain_fields, edited_by_user, updated_at
            FROM personas WHERE session_id = ?`,
      args: [sessionId],
    });

    let persona = null;
    if (personaRes.rows.length > 0) {
      const p = personaRes.rows[0];
      persona = {
        id: p.id as string,
        name: p.name as string,
        title: p.title as string,
        company: p.company as string,
        background: p.background as string,
        risk_posture: p.risk_posture as string,
        technical_depth: p.technical_depth as string,
        business_priorities: JSON.parse(p.business_priorities as string),
        hot_buttons: JSON.parse(p.hot_buttons as string),
        conversational_style: p.conversational_style as string,
        uncertain_fields: JSON.parse((p.uncertain_fields as string) || "[]"),
        edited_by_user: Number(p.edited_by_user) === 1,
        updated_at: p.updated_at as string,
      };
    }

    // 3. Fetch scenarios if exists
    const scenariosRes = await db.execute({
      sql: `SELECT id, objections, strategic_questions FROM scenarios WHERE session_id = ?`,
      args: [sessionId],
    });

    let scenarios = null;
    if (scenariosRes.rows.length > 0) {
      const sc = scenariosRes.rows[0];
      scenarios = {
        id: sc.id as string,
        objections: JSON.parse(sc.objections as string),
        strategic_questions: JSON.parse(sc.strategic_questions as string),
      };
    }

    // 4. Fetch turns
    const turnsRes = await db.execute({
      sql: `SELECT id, turn_number, role, content, stance, created_at
            FROM turns WHERE session_id = ? ORDER BY turn_number ASC`,
      args: [sessionId],
    });

    const turns = turnsRes.rows.map((t) => ({
      id: t.id as string,
      turn_number: Number(t.turn_number),
      role: t.role as string,
      content: t.content as string,
      stance: (t.stance as string) || null,
      created_at: t.created_at as string,
    }));

    // 5. Fetch evaluation if exists
    const evalRes = await db.execute({
      sql: `SELECT id, clarity_score, clarity_critique, clarity_evidence,
                   confidence_score, confidence_critique, confidence_evidence,
                   structure_score, structure_critique, structure_evidence,
                   relevance_score, relevance_critique, relevance_evidence,
                   overall_score, executive_summary, turn_rewrites, cheat_sheet
            FROM evaluations WHERE session_id = ?`,
      args: [sessionId],
    });

    let evaluation = null;
    if (evalRes.rows.length > 0) {
      const e = evalRes.rows[0];
      evaluation = {
        id: e.id as string,
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
    }

    return NextResponse.json({
      ok: true,
      session,
      persona,
      scenarios,
      turns,
      evaluation,
    });
  } catch (err) {
    const errResp = toErrorResponse(err);
    return NextResponse.json(errResp.body, { status: errResp.status });
  }
}
