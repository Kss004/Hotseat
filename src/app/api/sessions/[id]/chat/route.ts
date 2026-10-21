import { z } from "zod";
import { getReadyDb } from "@/lib/db";
import { getLLMRouter } from "@/lib/ai/router";
import { getChatSystemPrompt, CHAT_PROMPT_VERSION } from "@/lib/ai/prompts/chat";
import { getStanceSystemPrompt, getStanceUserPrompt, STANCE_PROMPT_VERSION } from "@/lib/ai/prompts/stance";
import {
  stanceOutputSchema,
  type PersonaData,
  type Stance,
  type Difficulty,
  type RiskPosture,
  type TechnicalDepth,
} from "@/types";
import { AppError, toErrorResponse, type ErrorCode } from "@/lib/errors";
import { loadSessionResearch } from "@/lib/research";
import { enforceRateLimit } from "@/lib/rateLimit";

// LLM calls (with failover and one repair retry) can outlast the default serverless timeout.
export const maxDuration = 120;

const chatBodySchema = z.object({
  message: z.string().trim().min(1, "Message cannot be empty").max(4000, "Message is too long"),
});

// Longer than maxDuration, so a lock left by a killed function always expires
const LOCK_SEC = 150;

function jsonError(code: ErrorCode, message: string, status: number) {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  // Set once this request holds the session's chat lock; called on every exit path after that
  let releaseLock: (() => Promise<void>) | null = null;
  try {
    await enforceRateLimit(req, "chat");
    const sessionId = params.id;
    const body = chatBodySchema.safeParse(await req.json().catch(() => null));
    if (!body.success) {
      return jsonError("VALIDATION", body.error.issues[0]?.message || "Invalid request body", 400);
    }
    const userMessage = body.data.message;

    const db = await getReadyDb();

    // 1. Fetch session & turn cap
    const sessionRes = await db.execute({
      sql: `SELECT id, meeting_context, difficulty, max_turns, status FROM sessions WHERE id = ?`,
      args: [sessionId],
    });

    if (sessionRes.rows.length === 0) {
      return jsonError("NOT_FOUND", "Session not found", 404);
    }

    const s = sessionRes.rows[0];
    if (s.status === "ended" || s.status === "evaluated") {
      return jsonError("SESSION_ENDED", "This simulation has ended. Start a new session to spar again.", 409);
    }
    const meetingContext = JSON.parse(s.meeting_context as string);
    const difficulty = (s.difficulty as Difficulty) || "realistic";
    const maxTurns = Number(s.max_turns) || 10;

    // 2. Count existing user turns to enforce TURN_CAP
    const userTurnsCountRes = await db.execute({
      sql: `SELECT COUNT(*) as count FROM turns WHERE session_id = ? AND role = 'user'`,
      args: [sessionId],
    });
    const userTurnsCount = Number(userTurnsCountRes.rows[0].count);

    if (userTurnsCount >= maxTurns) {
      return jsonError(
        "TURN_CAP",
        `Maximum turn cap (${maxTurns} turns) reached for this session. Please end simulation and review analytics.`,
        400
      );
    }

    // 3. Fetch persona & scenarios before writing anything, so a missing persona never leaves an orphan turn
    const personaRes = await db.execute({
      sql: `SELECT name, title, company, background, risk_posture, technical_depth,
                   business_priorities, hot_buttons, conversational_style FROM personas WHERE session_id = ?`,
      args: [sessionId],
    });
    if (personaRes.rows.length === 0) {
      return jsonError("VALIDATION", "Persona not found", 400);
    }
    const p = personaRes.rows[0];
    const persona: PersonaData = {
      name: p.name as string,
      title: p.title as string,
      company: p.company as string,
      background: p.background as string,
      risk_posture: p.risk_posture as RiskPosture,
      technical_depth: p.technical_depth as TechnicalDepth,
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
    const research = await loadSessionResearch(sessionId);

    // One reply in flight per session: a double-send or a script can't run parallel AI calls on one session.
    // The lock expires on its own after LOCK_SEC, so a function killed mid-reply can't leave the session stuck.
    const nowSec = Math.floor(Date.now() / 1000);
    const lock = await db.execute({
      sql: `UPDATE sessions SET streaming_until = ?
            WHERE id = ? AND (streaming_until IS NULL OR streaming_until < ?)`,
      args: [nowSec + LOCK_SEC, sessionId, nowSec],
    });
    if (lock.rowsAffected === 0) {
      return jsonError("BUSY", "The counterpart is still replying. Wait for the reply to finish, then send again.", 409);
    }
    releaseLock = () =>
      db
        .execute({ sql: `UPDATE sessions SET streaming_until = NULL WHERE id = ?`, args: [sessionId] })
        .then(() => undefined)
        .catch((e) => console.error("Failed to release chat lock:", e));

    // 4. Save user turn; the turn number is computed in the same statement to avoid a read-then-write race
    const userTurnId = `turn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}_u`;
    const insertedUser = await db.execute({
      sql: `INSERT INTO turns (id, session_id, turn_number, role, content)
            SELECT ?, ?, COALESCE(MAX(turn_number), 0) + 1, 'user', ? FROM turns WHERE session_id = ?
            RETURNING turn_number`,
      args: [userTurnId, sessionId, userMessage, sessionId],
    });
    const userTurnNumber = Number(insertedUser.rows[0].turn_number);

    await db.execute({
      sql: `UPDATE sessions SET status = 'roleplay_active' WHERE id = ?`,
      args: [sessionId],
    });

    // 5. Conversation history truncated to last 12 messages
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
      research: research?.findings,
    });

    const router = getLLMRouter();

    // 6. SSE response stream
    const encoder = new TextEncoder();
    let clientGone = false;
    const releaseStreamLock = releaseLock;

    const streamReply = async (controller: ReadableStreamDefaultController<Uint8Array>) => {
      // If the browser disconnects we keep generating so the reply is still persisted
      const send = (payload: Record<string, unknown>) => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          clientGone = true;
        }
      };

      let assistantReply = "";
      const assistantTurnNumber = userTurnNumber + 1;
      const assistantTurnId = `turn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}_a`;

      try {
        for await (const token of router.stream({
          purpose: "chat",
          system: systemPrompt,
          messages,
          promptVersion: CHAT_PROMPT_VERSION,
          sessionId,
        })) {
          assistantReply += token;
          send({ event: "token", token });
        }
      } catch (streamErr: unknown) {
        // The persona never answered, so the user's turn is rolled back and does not count against the cap
        await db
          .execute({ sql: `DELETE FROM turns WHERE id = ?`, args: [userTurnId] })
          .catch((e) => console.error("Failed to roll back user turn:", e));
        const code: ErrorCode = streamErr instanceof AppError ? streamErr.code : "LLM_UNAVAILABLE";
        console.error(`Chat stream failed for ${sessionId}:`, streamErr);
        send({
          event: "error",
          code,
          error: "The AI providers are unavailable right now. Your message was not counted; try sending it again.",
        });
        try {
          controller.close();
        } catch {
          // already closed by a disconnect
        }
        return;
      }

      try {
        await db.execute({
          sql: `INSERT INTO turns (id, session_id, turn_number, role, content)
                VALUES (?, ?, ?, 'assistant', ?)`,
          args: [assistantTurnId, sessionId, assistantTurnNumber, assistantReply],
        });

        // Decision D2: second small structured call classifies the persona's stance.
        // On failure we report the stance as unavailable instead of inventing one.
        let classifiedStance: Stance | null = null;
        try {
          const stanceResult = await router.complete<{ stance: Stance; reasoning?: string }>({
            purpose: "stance",
            system: getStanceSystemPrompt(persona),
            user: getStanceUserPrompt({ lastUserMessage: userMessage, assistantReply }),
            schema: stanceOutputSchema,
            promptVersion: STANCE_PROMPT_VERSION,
            sessionId,
            // A small classification; if it is slow, the stance is reported as unavailable rather than delaying `done`
            timeoutMs: 15_000,
            budgetMs: 25_000,
          });
          classifiedStance = stanceResult.data.stance;
          await db.execute({
            sql: `UPDATE turns SET stance = ? WHERE id = ?`,
            args: [classifiedStance, assistantTurnId],
          });
          send({ event: "stance", stance: classifiedStance, reasoning: stanceResult.data.reasoning || "" });
        } catch (stanceErr) {
          console.warn("Stance classification failed:", stanceErr);
          send({ event: "stance", stance: null, unavailable: true, reasoning: "Stance reading unavailable for this turn" });
        }

        send({
          event: "done",
          turn_number: assistantTurnNumber,
          user_turn_number: userTurnNumber,
          stance: classifiedStance,
          remaining_turns: maxTurns - (userTurnsCount + 1),
        });
      } catch (persistErr) {
        console.error(`Chat persistence failed for ${sessionId}:`, persistErr);
        send({ event: "error", code: "INTERNAL_ERROR", error: "The reply could not be saved. Reload to see the saved transcript." });
      }

      try {
        controller.close();
      } catch {
        // already closed by a disconnect
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          await streamReply(controller);
        } finally {
          // Released however the reply ends: done, provider failure, or a save error
          await releaseStreamLock();
        }
      },
      cancel() {
        clientGone = true;
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err: unknown) {
    // A failure after taking the lock but before the stream started (e.g. saving the user turn)
    await releaseLock?.();
    const errResp = toErrorResponse(err);
    return new Response(JSON.stringify(errResp.body), {
      status: errResp.status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
