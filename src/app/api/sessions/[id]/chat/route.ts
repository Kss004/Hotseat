import { getDb } from "@/lib/db";
import { getLLMRouter } from "@/lib/ai/router";
import { getChatSystemPrompt, CHAT_PROMPT_VERSION } from "@/lib/ai/prompts/chat";
import { getStanceSystemPrompt, getStanceUserPrompt, STANCE_PROMPT_VERSION } from "@/lib/ai/prompts/stance";
import { stanceOutputSchema, type PersonaData, type Stance, type LLMCallStatus } from "@/types";
import { AppError } from "@/lib/errors";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const sessionId = params.id;
    const body = await req.json();
    const userMessage = body?.message;

    if (!userMessage || typeof userMessage !== "string" || userMessage.trim().length === 0) {
      return new Response(JSON.stringify({ code: "VALIDATION", message: "Message cannot be empty" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const db = getDb();

    // 1. Fetch session & turn cap
    const sessionRes = await db.execute({
      sql: `SELECT id, meeting_context, difficulty, max_turns, status FROM sessions WHERE id = ?`,
      args: [sessionId],
    });

    if (sessionRes.rows.length === 0) {
      return new Response(JSON.stringify({ code: "NOT_FOUND", message: "Session not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const s = sessionRes.rows[0];
    const meetingContext = JSON.parse(s.meeting_context as string);
    const difficulty = (s.difficulty as any) || "realistic";
    const maxTurns = Number(s.max_turns) || 10;

    // 2. Count existing user turns to enforce TURN_CAP
    const userTurnsCountRes = await db.execute({
      sql: `SELECT COUNT(*) as count FROM turns WHERE session_id = ? AND role = 'user'`,
      args: [sessionId],
    });
    const userTurnsCount = Number(userTurnsCountRes.rows[0].count);

    if (userTurnsCount >= maxTurns) {
      return new Response(
        JSON.stringify({
          code: "TURN_CAP",
          message: `Maximum turn cap (${maxTurns} turns) reached for this session. Please end simulation and review analytics.`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 3. Get next turn number
    const maxTurnRes = await db.execute({
      sql: `SELECT MAX(turn_number) as max_num FROM turns WHERE session_id = ?`,
      args: [sessionId],
    });
    const currentMaxTurn = Number(maxTurnRes.rows[0]?.max_num || 0);
    const userTurnNumber = currentMaxTurn + 1;
    const userTurnId = `turn_${Date.now()}_u`;

    // 4. Save user turn to database
    await db.execute({
      sql: `INSERT INTO turns (id, session_id, turn_number, role, content)
            VALUES (?, ?, ?, 'user', ?)`,
      args: [userTurnId, sessionId, userTurnNumber, userMessage.trim()],
    });

    // Update session status to roleplay_active
    await db.execute({
      sql: `UPDATE sessions SET status = 'roleplay_active' WHERE id = ?`,
      args: [sessionId],
    });

    // 5. Fetch persona & scenarios
    const personaRes = await db.execute({
      sql: `SELECT name, title, company, background, risk_posture, technical_depth,
                   business_priorities, hot_buttons, conversational_style FROM personas WHERE session_id = ?`,
      args: [sessionId],
    });
    if (personaRes.rows.length === 0) {
      return new Response(JSON.stringify({ code: "VALIDATION", message: "Persona not found" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const p = personaRes.rows[0];
    const persona: PersonaData = {
      name: p.name as string,
      title: p.title as string,
      company: p.company as string,
      background: p.background as string,
      risk_posture: p.risk_posture as any,
      technical_depth: p.technical_depth as any,
      business_priorities: JSON.parse(p.business_priorities as string),
      hot_buttons: JSON.parse(p.hot_buttons as string),
      conversational_style: p.conversational_style as string,
      uncertain_fields: [],
    };

    const scenariosRes = await db.execute({
      sql: `SELECT objections FROM scenarios WHERE session_id = ?`,
      args: [sessionId],
    });
    const objections = scenariosRes.rows.length > 0 ? JSON.parse(scenariosRes.rows[0].objections as string) : [];

    // 6. Fetch conversation history truncated to last 12 messages
    const historyRes = await db.execute({
      sql: `SELECT role, content FROM turns WHERE session_id = ? ORDER BY turn_number DESC LIMIT 12`,
      args: [sessionId],
    });
    const messages = historyRes.rows.reverse().map((r) => ({
      role: r.role as "user" | "assistant",
      content: r.content as string,
    }));

    const systemPrompt = getChatSystemPrompt({
      persona,
      meeting: meetingContext,
      objections,
      difficulty,
    });

    const router = getLLMRouter();

    // 7. Prepare SSE response stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let assistantReply = "";
        const assistantTurnNumber = userTurnNumber + 1;
        const assistantTurnId = `turn_${Date.now()}_a`;

        try {
          // Stream plain reply text as SSE token events
          for await (const token of router.stream({
            purpose: "chat",
            system: systemPrompt,
            messages,
            promptVersion: CHAT_PROMPT_VERSION,
            sessionId,
          })) {
            assistantReply += token;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ event: "token", token })}\n\n`)
            );
          }

          // Persist full reply in database
          await db.execute({
            sql: `INSERT INTO turns (id, session_id, turn_number, role, content)
                  VALUES (?, ?, ?, 'assistant', ?)`,
            args: [assistantTurnId, sessionId, assistantTurnNumber, assistantReply],
          });

          // Second structured call: Decision D2 (classify stance)
          let classifiedStance: Stance = "skeptical";
          try {
            const stanceResult = await router.complete<{ stance: Stance; reasoning?: string }>({
              purpose: "stance",
              system: getStanceSystemPrompt(persona),
              user: getStanceUserPrompt({
                lastUserMessage: userMessage,
                assistantReply,
              }),
              schema: stanceOutputSchema,
              promptVersion: STANCE_PROMPT_VERSION,
              sessionId,
            });

            classifiedStance = stanceResult.data.stance;

            // Update assistant turn with classified stance
            await db.execute({
              sql: `UPDATE turns SET stance = ? WHERE id = ?`,
              args: [classifiedStance, assistantTurnId],
            });

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  event: "stance",
                  stance: classifiedStance,
                  reasoning: stanceResult.data.reasoning || "",
                })}\n\n`
              )
            );
          } catch (stanceErr) {
            console.warn("Stance classification failed, defaulting to skeptical:", stanceErr);
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  event: "stance",
                  stance: "skeptical",
                  reasoning: "Classification unavailable",
                })}\n\n`
              )
            );
          }

          // Emit done event
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                event: "done",
                turn_number: assistantTurnNumber,
                stance: classifiedStance,
                remaining_turns: maxTurns - (userTurnsCount + 1),
              })}\n\n`
            )
          );

          controller.close();
        } catch (streamErr: unknown) {
          const errMsg = streamErr instanceof Error ? streamErr.message : "Stream failure";
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ event: "error", error: errMsg })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
      },
    });
  } catch (err: unknown) {
    const isCap = err instanceof AppError && err.code === "TURN_CAP";
    return new Response(
      JSON.stringify({
        code: isCap ? "TURN_CAP" : "INTERNAL_ERROR",
        message: err instanceof Error ? err.message : "Error handling chat",
      }),
      { status: isCap ? 400 : 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
