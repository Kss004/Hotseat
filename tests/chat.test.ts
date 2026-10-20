import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getReadyDb } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { POST as chatPOST } from "@/app/api/sessions/[id]/chat/route";
import { POST as endPOST } from "@/app/api/sessions/[id]/end/route";
import {
  TRANSCRIPT, createSession, jsonRequest, params, readSse, resetDb,
  seedPersonaAndScenarios, seedTranscript, useLiveMode, useReplayMode,
} from "./helpers";
import { stanceOutputSchema, type Stance, type ScenariosOutput } from "@/types";
import { getChatSystemPrompt } from "@/lib/ai/prompts/chat";
import fixtureScenarios from "../fixtures/llm/scenarios.json";

describe("Step 4: Streaming Sparring Chat & Stance Validation", () => {
  it("1. Stance schema validates allowed enum values strictly", () => {
    const validStances: Stance[] = [
      "skeptical",
      "guarded",
      "neutral",
      "intrigued",
      "convinced",
      "impatient",
    ];

    for (const stance of validStances) {
      const parsed = stanceOutputSchema.safeParse({ stance, reasoning: "Test reasoning" });
      expect(parsed.success).toBe(true);
    }

    const invalid = stanceOutputSchema.safeParse({ stance: "happy", reasoning: "invalid" });
    expect(invalid.success).toBe(false);
  });

  it("2. Guardrails test: Chat system prompt strictly forbids breaking character or coach whispers", () => {
    const prompt = getChatSystemPrompt({
      persona: {
        name: "Marcus Vance",
        title: "Managing Director",
        company: "Apex Financial",
        background: "Risk advisory",
        risk_posture: "risk_averse",
        technical_depth: "high",
        business_priorities: ["SOC2"],
        hot_buttons: ["Buzzwords"],
        conversational_style: "Skeptical",
        uncertain_fields: [],
      },
      meeting: {
        product_summary: "AutoFlow",
        goal: "Pilot",
        meeting_type: "Pitch",
        duration_minutes: 30,
      },
      objections: fixtureScenarios.objections as ScenariosOutput["objections"],
      difficulty: "realistic",
    });

    expect(prompt).toContain("NEVER mention that you are an AI");
    expect(prompt).toContain("Stay 100% in character");
    expect(prompt).toContain("Present only ONE distinct question");
    expect(prompt).toContain("at most 100 to 120 words");
  });

  describe("POST /api/sessions/[id]/chat (real route, replay LLM)", () => {
    beforeAll(() => useReplayMode());
    afterAll(() => useLiveMode());
    beforeEach(() => resetDb());

    it("3. Streams tokens, persists both turns, and emits a stance in the enum before done", async () => {
      const sessionId = await createSession();
      await seedPersonaAndScenarios(sessionId);

      const res = await chatPOST(jsonRequest({ message: "Marcus, here is how we isolate your audit logs." }), params(sessionId));
      expect(res.headers.get("Content-Type")).toContain("text/event-stream");
      const events = await readSse(res);

      const kinds = events.map((e) => e.event);
      expect(kinds.filter((k) => k === "token").length).toBeGreaterThan(0);
      expect(kinds.slice(-2)).toEqual(["stance", "done"]);
      const stance = events.find((e) => e.event === "stance")!;
      expect(["skeptical", "guarded", "neutral", "intrigued", "convinced", "impatient"]).toContain(stance.stance);

      const db = await getReadyDb();
      const turns = await db.execute({ sql: `SELECT role, turn_number, stance FROM turns WHERE session_id = ? ORDER BY turn_number`, args: [sessionId] });
      expect(turns.rows.map((r) => r.role)).toEqual(["user", "assistant"]);
      expect(turns.rows[1].stance).toBe(stance.stance);
    });

    it("4. Rejects the message with TURN_CAP once max_turns user turns exist, without writing a turn", async () => {
      const sessionId = await createSession({ max_turns: 2 });
      await seedPersonaAndScenarios(sessionId);
      await seedTranscript(sessionId);

      const res = await chatPOST(jsonRequest({ message: "One more point." }), params(sessionId));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("TURN_CAP");

      const db = await getReadyDb();
      const count = await db.execute({ sql: `SELECT COUNT(*) AS c FROM turns WHERE session_id = ?`, args: [sessionId] });
      expect(Number(count.rows[0].c)).toBe(TRANSCRIPT.length);
    });

    it("5. Rejects messages after the session has ended", async () => {
      const sessionId = await createSession();
      await seedPersonaAndScenarios(sessionId);
      await seedTranscript(sessionId);
      expect((await endPOST(jsonRequest({}), params(sessionId))).status).toBe(200);

      const res = await chatPOST(jsonRequest({ message: "Wait, one more thing." }), params(sessionId));
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("SESSION_ENDED");
    });

    it("5b. Refuses to end a session before 2 user turns, so it can still be evaluated later", async () => {
      const sessionId = await createSession();
      await seedPersonaAndScenarios(sessionId);
      await seedTranscript(sessionId, TRANSCRIPT.slice(0, 2));

      const res = await endPOST(jsonRequest({}), params(sessionId));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("INSUFFICIENT_TURNS");

      const chat = await chatPOST(jsonRequest({ message: "Let me continue." }), params(sessionId));
      expect(chat.headers.get("Content-Type")).toContain("text/event-stream");
      await chat.text();
    });

    it("6. Rejects empty and malformed bodies with VALIDATION", async () => {
      const sessionId = await createSession();
      const empty = await chatPOST(jsonRequest({ message: "   " }), params(sessionId));
      expect(empty.status).toBe(400);
      expect((await empty.json()).code).toBe("VALIDATION");

      const malformed = await chatPOST(
        new Request("http://localhost/api", { method: "POST", body: "{not json" }),
        params(sessionId)
      );
      expect(malformed.status).toBe(400);
    });

    it("7. With no providers configured, emits LLM_UNAVAILABLE and rolls back the user turn", async () => {
      useLiveMode();
      const saved = { ...process.env };
      delete process.env.OPENCODE_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GROQ_API_KEY;
      delete process.env.LOCAL_LLM_URL;
      resetEnvCache();
      try {
        const sessionId = await createSession();
        await seedPersonaAndScenarios(sessionId);
        const events = await readSse(await chatPOST(jsonRequest({ message: "Hello Marcus." }), params(sessionId)));

        expect(events.map((e) => e.event)).toEqual(["error"]);
        expect(events[0].code).toBe("LLM_UNAVAILABLE");

        const db = await getReadyDb();
        const count = await db.execute({ sql: `SELECT COUNT(*) AS c FROM turns WHERE session_id = ?`, args: [sessionId] });
        expect(Number(count.rows[0].c)).toBe(0);
      } finally {
        process.env = saved;
        useReplayMode();
      }
    });
  });
});
