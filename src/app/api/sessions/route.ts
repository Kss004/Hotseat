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
