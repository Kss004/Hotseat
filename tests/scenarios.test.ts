import { describe, it, expect } from "vitest";
import { scenariosOutputSchema } from "@/types";
import fixture from "../fixtures/llm/scenarios.json";

describe("Step 3: Scenario Mapping & Strategic Questions Validation", () => {
  it("1. Validates scenarios output schema against benchmark fixture", () => {
    const parsed = scenariosOutputSchema.safeParse(fixture);
    expect(parsed.success).toBe(true);

    if (parsed.success) {
      const data = parsed.data;
      // Objections count between 4 and 6
      expect(data.objections.length).toBeGreaterThanOrEqual(4);
      expect(data.objections.length).toBeLessThanOrEqual(6);

      // Strategic questions count between 5 and 7
      expect(data.strategic_questions.length).toBeGreaterThanOrEqual(5);
      expect(data.strategic_questions.length).toBeLessThanOrEqual(7);

      // Verify category requirements
      const categories = data.objections.map((o) => o.category);
      expect(categories).toContain("Risk/Compliance/Security");
      expect(categories).toContain("ROI/Financial");
    }
  });

  it("2. Rejects invalid scenarios schema when questions are under 5", () => {
    const invalid = {
      ...fixture,
      strategic_questions: fixture.strategic_questions.slice(0, 2), // only 2 questions
    };
    const parsed = scenariosOutputSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });
});
