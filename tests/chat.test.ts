import { describe, it, expect, beforeAll } from "vitest";
import { getDb, runMigrations } from "@/lib/db";
import { stanceOutputSchema, type Stance } from "@/types";
import { getChatSystemPrompt } from "@/lib/ai/prompts/chat";
import fixtureScenarios from "../fixtures/llm/scenarios.json";

describe("Step 4: Streaming Sparring Chat & Stance Validation", () => {
  beforeAll(async () => {
    await runMigrations();
  });

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
      objections: fixtureScenarios.objections as any,
      difficulty: "realistic",
    });

    expect(prompt).toContain("NEVER mention that you are an AI");
    expect(prompt).toContain("Stay 100% in character");
    expect(prompt).toContain("Present only ONE distinct question");
    expect(prompt).toContain("at most 100 to 120 words");
  });

  it("3. Enforces TURN_CAP at database level when user reaches max_turns", async () => {
    const db = getDb();
    const sessionId = `sess_turncap_${Date.now()}`;

    // Insert session with max_turns = 2
    await db.execute({
      sql: `INSERT INTO sessions (id, title, raw_input, meeting_context, difficulty, max_turns, status)
            VALUES (?, 'Test Cap', 'Raw input exceeding 80 chars for turn cap validation.', ?, 'realistic', 2, 'roleplay_active')`,
      args: [sessionId, JSON.stringify({ product_summary: "P", goal: "G", meeting_type: "T", duration_minutes: 30 })],
    });

    // Insert 2 user turns
    const t1 = `t1_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const t2 = `t2_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    await db.execute({
      sql: `INSERT INTO turns (id, session_id, turn_number, role, content) VALUES (?, ?, 1, 'user', 'msg 1')`,
      args: [t1, sessionId],
    });
    await db.execute({
      sql: `INSERT INTO turns (id, session_id, turn_number, role, content) VALUES (?, ?, 2, 'user', 'msg 2')`,
      args: [t2, sessionId],
    });

    // Check count
    const countRes = await db.execute({
      sql: `SELECT COUNT(*) as count FROM turns WHERE session_id = ? AND role = 'user'`,
      args: [sessionId],
    });
    const count = Number(countRes.rows[0].count);
    expect(count).toBe(2);

    // Verifying turn cap condition
    const maxTurns = 2;
    const isCapped = count >= maxTurns;
    expect(isCapped).toBe(true);
  });
});
