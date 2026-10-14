import { describe, it, expect, beforeAll } from "vitest";
import { getDb, runMigrations } from "@/lib/db";
import { personaSchema } from "@/types";

describe("Step 2: Persona Schema & Persistence Integration", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  it("1. Validates persona schema strictly", () => {
    const valid = {
      name: "Marcus Vance",
      title: "Managing Director of Operational Risk",
      company: "Apex Financial",
      background: "Former Deloitte partner, 18 years in banking governance.",
      risk_posture: "risk_averse",
      technical_depth: "high",
      business_priorities: ["SOC2 compliance", "Audit logging"],
      hot_buttons: ["Vague buzzwords"],
      conversational_style: "Skeptical, direct, rigorous",
      uncertain_fields: ["technical_depth"],
    };

    const parsed = personaSchema.safeParse(valid);
    expect(parsed.success).toBe(true);

    const invalid = {
      ...valid,
      risk_posture: "unknown_posture", // invalid enum
    };
    const invalidParsed = personaSchema.safeParse(invalid);
    expect(invalidParsed.success).toBe(false);
  });

  it("2. Persists persona and updates edited_by_user on PATCH", async () => {
    const db = getDb();
    const sessionId = `test_sess_${Date.now()}`;

    // Insert session
    await db.execute({
      sql: `INSERT INTO sessions (id, title, raw_input, meeting_context, difficulty, max_turns, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        sessionId,
        "Test Session",
        "Raw input text for Marcus Vance with risk compliance background exceeding 80 characters.",
        JSON.stringify({ product_summary: "AutoFlow", goal: "Pilot", meeting_type: "Pitch", duration_minutes: 30 }),
        "realistic",
        10,
        "draft",
      ],
    });

    const personaId = `pers_${Date.now()}`;
    // Insert initial generated persona
    await db.execute({
      sql: `INSERT INTO personas (
              id, session_id, name, title, company, background,
              risk_posture, technical_depth, business_priorities,
              hot_buttons, conversational_style, uncertain_fields, edited_by_user
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      args: [
        personaId,
        sessionId,
        "Marcus Vance",
        "Managing Director",
        "Apex Financial",
        "Risk background",
        "risk_averse",
        "high",
        JSON.stringify(["Security"]),
        JSON.stringify(["Buzzwords"]),
        "Direct",
        JSON.stringify(["technical_depth"]),
      ],
    });

    // Check initial persona
    const initialRes = await db.execute({
      sql: `SELECT edited_by_user, title FROM personas WHERE session_id = ?`,
      args: [sessionId],
    });
    expect(Number(initialRes.rows[0].edited_by_user)).toBe(0);
    expect(initialRes.rows[0].title).toBe("Managing Director");

    // Perform user edit (simulate PATCH)
    await db.execute({
      sql: `UPDATE personas
            SET title = ?, edited_by_user = 1, updated_at = CURRENT_TIMESTAMP
            WHERE session_id = ?`,
      args: ["Executive Managing Director - Global Risk", sessionId],
    });

    // Verify edits survived and persisted
    const updatedRes = await db.execute({
      sql: `SELECT edited_by_user, title FROM personas WHERE session_id = ?`,
      args: [sessionId],
    });
    expect(Number(updatedRes.rows[0].edited_by_user)).toBe(1);
    expect(updatedRes.rows[0].title).toBe("Executive Managing Director - Global Risk");
  });
});
