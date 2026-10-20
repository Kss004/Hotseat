import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getReadyDb } from "@/lib/db";
import { buildEvaluationSchema, evaluationOutputSchema, type EvaluationOutput, type Turn } from "@/types";
import { filterValidQuotes } from "@/lib/quotes";
import { postValidateEvaluation } from "@/lib/evaluation";
import { getEvaluateUserPrompt } from "@/lib/ai/prompts/evaluate";
import { POST as evaluatePOST } from "@/app/api/sessions/[id]/evaluate/route";
import { GET as evaluationGET } from "@/app/api/sessions/[id]/evaluation/route";
import fixtureEvaluation from "../fixtures/llm/evaluate.json";
import {
  TRANSCRIPT, createSession, jsonRequest, params, resetDb,
  seedPersonaAndScenarios, seedTranscript, useLiveMode, useReplayMode,
} from "./helpers";

const FABRICATED = "We are FedRAMP High authorized across every region today";

const userTurns: Turn[] = TRANSCRIPT.map((t, i) => ({
  id: `t${i + 1}`,
  session_id: "s",
  turn_number: i + 1,
  role: t.role,
  content: t.content,
  created_at: "",
})).filter((t) => t.role === "user");

describe("Step 5: Evaluator, Rewrites & Post-Validation", () => {
  describe("quote validator", () => {
    it("1. Keeps verbatim quotes (case, whitespace and smart punctuation normalized) and drops invented ones", () => {
      const texts = ["We don’t   store keys.  Ever.", "Pilot runs 60 days."];
      expect(filterValidQuotes(["we don't store keys", "“Pilot runs 60 days…”"], texts)).toEqual([
        "we don't store keys",
        "“Pilot runs 60 days…”",
      ]);
      expect(filterValidQuotes(["We store nothing at all"], texts)).toEqual([]);
    });

    it("2. Rejects a quote stitched across two separate user turns", () => {
      const texts = ["Our logs are immutable.", "Pricing is per seat."];
      expect(filterValidQuotes(["immutable. Pricing is"], texts)).toEqual([]);
    });
  });

  describe("schema refinement", () => {
    it("3. Rejects rewrites that point at an assistant turn, with an error naming the valid user turns", () => {
      const bad = {
        ...fixtureEvaluation,
        turn_rewrites: fixtureEvaluation.turn_rewrites.map((rw, i) => ({ ...rw, turn_number: i === 0 ? 2 : 3 })),
      };
      const parsed = buildEvaluationSchema([1, 3]).safeParse(bad);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.message).toContain("Valid user turn numbers: 1, 3");
      expect(buildEvaluationSchema([1, 3]).safeParse(fixtureEvaluation).success).toBe(true);
    });
  });

  describe("postValidateEvaluation", () => {
    const data = evaluationOutputSchema.parse(fixtureEvaluation) as EvaluationOutput;

    it("4. Drops fabricated evidence without backfilling, and sources user_said from the DB turn", () => {
      const { evaluation, droppedQuotes } = postValidateEvaluation(data, userTurns);
      expect(droppedQuotes).toBe(1);
      expect(evaluation.clarity_evidence).not.toContain(FABRICATED);
      for (const quote of [
        ...evaluation.clarity_evidence,
        ...evaluation.confidence_evidence,
        ...evaluation.structure_evidence,
        ...evaluation.relevance_evidence,
      ]) {
        expect(userTurns.some((t) => t.content.toLowerCase().includes(quote.toLowerCase()))).toBe(true);
      }
      expect(evaluation.turn_rewrites.map((r) => r.user_said)).toEqual([userTurns[0].content, userTurns[1].content]);
      // turn_number 3 is the user's 2nd message, so it is labelled #2
      expect(evaluation.turn_rewrites.map((r) => r.user_turn_index)).toEqual([1, 2]);
      expect(evaluation.objection_playbook[0].user_turn_index).toBe(2);
      expect(evaluation.objection_playbook[0].user_said).toBe(userTurns[1].content);
    });

    it("5. Leaves a dimension's evidence empty when every quote is invalid", () => {
      const allFake = { ...data, structure_evidence: ["nothing like this was said"] };
      expect(postValidateEvaluation(allFake, userTurns).evaluation.structure_evidence).toEqual([]);
    });

    it("6. Computes overall_score in code as the mean of the four dimensions", () => {
      const scored = { ...data, clarity_score: 9, confidence_score: 6, structure_score: 7, relevance_score: 5 };
      expect(postValidateEvaluation(scored, userTurns).evaluation.overall_score).toBe(6.8);
    });
  });

  describe("POST /api/sessions/[id]/evaluate (real route, replay LLM)", () => {
    beforeAll(() => useReplayMode());
    afterAll(() => useLiveMode());
    beforeEach(() => resetDb());

    it("7. Returns INSUFFICIENT_TURNS with fewer than 2 user turns", async () => {
      const sessionId = await createSession();
      await seedPersonaAndScenarios(sessionId);
      await seedTranscript(sessionId, TRANSCRIPT.slice(0, 2));

      const res = await evaluatePOST(jsonRequest({}), params(sessionId));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("INSUFFICIENT_TURNS");
    });

    it("8. Persists a post-validated evaluation that the GET route returns identically", async () => {
      const sessionId = await createSession();
      await seedPersonaAndScenarios(sessionId);
      await seedTranscript(sessionId);

      const res = await evaluatePOST(jsonRequest({}), params(sessionId));
      expect(res.status).toBe(200);
      const { evaluation } = await res.json();

      expect(evaluation.clarity_evidence).not.toContain(FABRICATED);
      expect(evaluation.overall_score).toBe(
        Number(((evaluation.clarity_score + evaluation.confidence_score + evaluation.structure_score + evaluation.relevance_score) / 4).toFixed(1))
      );
      expect(evaluation.turn_rewrites).toHaveLength(2);
      expect(evaluation.objection_playbook[0].framework_steps.length).toBeGreaterThanOrEqual(3);

      const stored = await (await evaluationGET(jsonRequest({}, "GET"), params(sessionId))).json();
      expect(stored.evaluation).toEqual(evaluation);

      const db = await getReadyDb();
      const session = await db.execute({ sql: `SELECT status FROM sessions WHERE id = ?`, args: [sessionId] });
      expect(session.rows[0].status).toBe("evaluated");
    });
  });

  describe("evaluator prompt", () => {
    it("9. labels user turns with the UI's message numbers so critiques match the report", () => {
      const turn = (n: number, role: "user" | "assistant"): Turn => ({
        id: `t${n}`,
        session_id: "s",
        turn_number: n,
        role,
        content: `content ${n}`,
        created_at: "",
      });
      const prompt = getEvaluateUserPrompt([turn(1, "user"), turn(2, "assistant"), turn(3, "user"), turn(4, "assistant")]);

      expect(prompt).toContain("[Turn 1] USER (message #1):");
      expect(prompt).toContain("[Turn 3] USER (message #2):");
      expect(prompt).toContain("[Turn 2] ASSISTANT:");
      expect(prompt).toContain("the only values allowed for turn_number and user_turn_number): 1, 3");
    });
  });
});
