import { NextResponse } from "next/server";
import { z } from "zod";
import { getReadyDb } from "@/lib/db";
import { meetingContextSchema } from "@/types";
import { toErrorResponse } from "@/lib/errors";
import { getEnv } from "@/lib/env";

const createSessionSchema = z.object({
  title: z.string().min(1).default("Executive Meeting Preparation"),
  target_url: z.string().optional().nullable(),
  raw_input: z
    .string()
    .min(80, "Profile text must be at least 80 characters")
    .max(20000, "Profile text is too long (max 20,000 characters)"),
  meeting_context: meetingContextSchema,
  difficulty: z.enum(["warmup", "realistic", "hostile"]).default("realistic"),
  max_turns: z.coerce.number().int().min(2).max(30).optional(),
});

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const parsed = createSessionSchema.safeParse(json);

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

    const { title, target_url, raw_input, meeting_context, difficulty } = parsed.data;
    const max_turns = parsed.data.max_turns ?? getEnv().MAX_TURNS;
    const id = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const db = await getReadyDb();

    await db.execute({
      sql: `INSERT INTO sessions (id, title, target_url, raw_input, meeting_context, difficulty, max_turns, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')`,
      args: [
        id,
        title,
        target_url || null,
        raw_input,
        JSON.stringify(meeting_context),
        difficulty,
        max_turns,
      ],
    });

    const session = {
      id,
      title,
      target_url: target_url || null,
      raw_input,
      meeting_context,
      difficulty,
      max_turns,
      status: "draft",
      created_at: new Date().toISOString(),
    };

    return NextResponse.json({ ok: true, session }, { status: 201 });
  } catch (err) {
    const errResp = toErrorResponse(err);
    return NextResponse.json(errResp.body, { status: errResp.status });
  }
}

export async function GET() {
  try {
    const db = await getReadyDb();
    const result = await db.execute({
      sql: `SELECT id, created_at, title, target_url, raw_input, meeting_context, difficulty, max_turns, status
            FROM sessions ORDER BY created_at DESC LIMIT 50`,
      args: [],
    });

    const sessions = result.rows.map((r) => ({
      id: r.id as string,
      created_at: r.created_at as string,
      title: r.title as string,
      target_url: r.target_url as string | null,
      raw_input: r.raw_input as string,
      meeting_context: JSON.parse(r.meeting_context as string),
      difficulty: r.difficulty as string,
      max_turns: Number(r.max_turns),
      status: r.status as string,
    }));

    return NextResponse.json({ ok: true, sessions });
  } catch (err) {
    const errResp = toErrorResponse(err);
    return NextResponse.json(errResp.body, { status: errResp.status });
  }
}
