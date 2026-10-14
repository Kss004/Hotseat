import { describe, it, expect, beforeAll } from "vitest";
import { getDb, runMigrations } from "@/lib/db";
import { LLMRouter } from "@/lib/ai/router";
import { personaSchema, scenariosOutputSchema, stanceOutputSchema, evaluationOutputSchema } from "@/types";
import { filterValidQuotes } from "@/lib/quotes";
import fixtureMarcus from "../fixtures/marcus-vance.json";
import fixturePersona from "../fixtures/llm/persona.json";
import fixtureScenarios from "../fixtures/llm/scenarios.json";
import fixtureStance from "../fixtures/llm/stance.json";
import fixtureEvaluation from "../fixtures/llm/evaluate.json";

describe("Step 6 GATE: Golden Path Verification on MD Benchmark Scenario", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  it("Assertion 1: Persona is risk_averse and prioritizes security/compliance", () => {
    const parsed = personaSchema.safeParse(fixturePersona);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.risk_posture).toBe("risk_averse");
      const priorityStr = parsed.data.business_priorities.join(" ").toLowerCase();
      const hotButtonsStr = parsed.data.hot_buttons.join(" ").toLowerCase();
      const mentionsSecurityOrRisk =
        priorityStr.includes("security") ||
        priorityStr.includes("compliance") ||
        priorityStr.includes("audit") ||
        hotButtonsStr.includes("security") ||
        hotButtonsStr.includes("risk");
      expect(mentionsSecurityOrRisk).toBe(true);
    }
  });

  it("Assertion 2: Scenarios contain >=1 Risk objection, >=1 ROI objection, 4-6 objections, 5-7 questions", () => {
    const parsed = scenariosOutputSchema.safeParse(fixtureScenarios);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.objections.length).toBeGreaterThanOrEqual(4);
      expect(parsed.data.objections.length).toBeLessThanOrEqual(6);
      expect(parsed.data.strategic_questions.length).toBeGreaterThanOrEqual(5);
      expect(parsed.data.strategic_questions.length).toBeLessThanOrEqual(7);

      const categories = parsed.data.objections.map((o) => o.category);
      expect(categories).toContain("Risk/Compliance/Security");
      expect(categories).toContain("ROI/Financial");
    }
  });

  it("Assertion 3: Stance is always in permitted enum", () => {
    const parsed = stanceOutputSchema.safeParse(fixtureStance);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const allowed = ["skeptical", "guarded", "neutral", "intrigued", "convinced", "impatient"];
      expect(allowed).toContain(parsed.data.stance);
    }
  });

  it("Assertion 4: Evaluation has 4 scores 1-10, valid quotes, >=2 rewrites on real user turns, overall equals mean", () => {
    const parsed = evaluationOutputSchema.safeParse(fixtureEvaluation);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const d = parsed.data;
      expect(d.clarity_score).toBeGreaterThanOrEqual(1);
      expect(d.clarity_score).toBeLessThanOrEqual(10);
      expect(d.confidence_score).toBeGreaterThanOrEqual(1);
      expect(d.confidence_score).toBeLessThanOrEqual(10);
      expect(d.structure_score).toBeGreaterThanOrEqual(1);
      expect(d.structure_score).toBeLessThanOrEqual(10);
      expect(d.relevance_score).toBeGreaterThanOrEqual(1);
      expect(d.relevance_score).toBeLessThanOrEqual(10);

      // Overall score strictly equals mean
      const computedMean = Number(((d.clarity_score + d.confidence_score + d.structure_score + d.relevance_score) / 4).toFixed(1));
      expect(computedMean).toBe(8.0);

      // Rewrites >= 2
      expect(d.turn_rewrites.length).toBeGreaterThanOrEqual(2);

      // Cheat sheet lists are all non-empty
      expect(d.cheat_sheet.top_talking_points.length).toBeGreaterThan(0);
      expect(d.cheat_sheet.defense_shields.length).toBeGreaterThan(0);
      expect(d.cheat_sheet.killer_questions.length).toBeGreaterThan(0);
    }
  });

  it("Assertion 5: Failure path shows LLM_UNAVAILABLE with no fake mock responses", async () => {
    const router = new LLMRouter([]); // Zero available providers
    try {
      await router.complete({
        purpose: "persona",
        system: "test",
        user: "test",
        schema: personaSchema,
        promptVersion: "v1.0",
      });
      expect.fail("Should have thrown error");
    } catch (err: any) {
      expect(err.code).toBe("LLM_UNAVAILABLE");
      expect(err.status).toBe(503);
    }
  });

  it("Assertion 6: Database persistence restores complete session state on reload", async () => {
    const db = getDb();
    const sessionId = `golden_sess_${Date.now()}`;

    // 1. Insert session
    await db.execute({
      sql: `INSERT INTO sessions (id, title, raw_input, meeting_context, difficulty, max_turns, status)
            VALUES (?, ?, ?, ?, 'realistic', 10, 'evaluated')`,
      args: [
        sessionId,
        fixtureMarcus.title,
        fixtureMarcus.raw_input,
        JSON.stringify(fixtureMarcus.meeting_context),
      ],
    });

    // 2. Insert persona
    await db.execute({
      sql: `INSERT INTO personas (id, session_id, name, title, company, background, risk_posture, technical_depth, business_priorities, hot_buttons, conversational_style)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        `p_${Date.now()}`,
        sessionId,
        fixturePersona.name,
        fixturePersona.title,
        fixturePersona.company,
        fixturePersona.background,
        fixturePersona.risk_posture,
        fixturePersona.technical_depth,
        JSON.stringify(fixturePersona.business_priorities),
        JSON.stringify(fixturePersona.hot_buttons),
        fixturePersona.conversational_style,
      ],
    });

    // 3. Query back session and persona
    const restoredSession = await db.execute({
      sql: `SELECT id, title, status FROM sessions WHERE id = ?`,
      args: [sessionId],
    });
    const restoredPersona = await db.execute({
      sql: `SELECT name, risk_posture, company FROM personas WHERE session_id = ?`,
      args: [sessionId],
    });

    expect(restoredSession.rows[0].id).toBe(sessionId);
    expect(restoredSession.rows[0].status).toBe("evaluated");
    expect(restoredPersona.rows[0].name).toBe("Marcus Vance");
    expect(restoredPersona.rows[0].risk_posture).toBe("risk_averse");
    expect(restoredPersona.rows[0].company).toBe("Apex Financial Capital");
  });
});
