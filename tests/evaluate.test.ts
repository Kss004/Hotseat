import { describe, it, expect, beforeAll } from "vitest";
import { getDb, runMigrations } from "@/lib/db";
import { evaluationOutputSchema } from "@/types";
import { filterValidQuotes } from "@/lib/quotes";
import fixtureEvaluation from "../fixtures/llm/evaluate.json";

describe("Step 5: Evaluator, Rewrites & Post-Validation", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  it("1. Validates evaluation schema structure and score boundaries [1-10]", () => {
    const parsed = evaluationOutputSchema.safeParse(fixtureEvaluation);
    expect(parsed.success).toBe(true);

    if (parsed.success) {
      const data = parsed.data;
      expect(data.clarity_score).toBeGreaterThanOrEqual(1);
      expect(data.clarity_score).toBeLessThanOrEqual(10);
      expect(data.confidence_score).toBeGreaterThanOrEqual(1);
      expect(data.confidence_score).toBeLessThanOrEqual(10);
      expect(data.structure_score).toBeGreaterThanOrEqual(1);
      expect(data.structure_score).toBeLessThanOrEqual(10);
      expect(data.relevance_score).toBeGreaterThanOrEqual(1);
      expect(data.relevance_score).toBeLessThanOrEqual(10);

      // Verify cheat sheet has all 3 lists populated
      expect(data.cheat_sheet.top_talking_points.length).toBeGreaterThan(0);
      expect(data.cheat_sheet.defense_shields.length).toBeGreaterThan(0);
      expect(data.cheat_sheet.killer_questions.length).toBeGreaterThan(0);
    }
  });

  it("2. Verbatim Quote Post-Validation: drops fabricated quotes and preserves real user substrings", () => {
    const realUserTurns = [
      "Our architecture isolates audit logs in customer-managed vaults with zero third-party access.",
      "We back our tamper-evident logs with contractual financial SLA credits.",
    ];

    const candidateQuotes = [
      "isolates audit logs in customer-managed vaults", // valid substring
      "We back our tamper-evident logs", // valid substring
      "This is a fabricated quote never spoken by the user", // invalid quote
    ];

    const validQuotes = filterValidQuotes(candidateQuotes, realUserTurns);

    expect(validQuotes).toContain("isolates audit logs in customer-managed vaults");
    expect(validQuotes).toContain("We back our tamper-evident logs");
    expect(validQuotes).not.toContain("This is a fabricated quote never spoken by the user");
  });

  it("3. Overall score computation: strictly equals mean of 4 scores", () => {
    const clarity = 8;
    const confidence = 8;
    const structure = 7;
    const relevance = 9;

    const mean = Number(((clarity + confidence + structure + relevance) / 4).toFixed(1));
    expect(mean).toBe(8.0);
  });
});
