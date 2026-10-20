import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { POST as personaPOST } from "@/app/api/sessions/[id]/persona/route";
import { POST as scenariosPOST } from "@/app/api/sessions/[id]/scenarios/route";
import { POST as chatPOST } from "@/app/api/sessions/[id]/chat/route";
import { POST as evaluatePOST } from "@/app/api/sessions/[id]/evaluate/route";
import { GET as sessionGET } from "@/app/api/sessions/[id]/route";
import { TRANSCRIPT, createSession, jsonRequest, params, readSse, resetDb, useLiveMode, useReplayMode } from "./helpers";

const STANCES = ["skeptical", "guarded", "neutral", "intrigued", "convinced", "impatient"];

/**
 * Step 6 gate: the Marcus Vance benchmark driven end to end through the real route handlers.
 * LLM output comes from fixtures/llm/ (replay mode); everything else (validation, post-validation,
 * persistence, SSE framing, turn accounting) is the production code path.
 */
describe("Step 6 GATE: Golden path on the MD benchmark (route level)", () => {
  let sessionId = "";
  let evaluation: Record<string, any> = {};

  beforeAll(async () => {
    useReplayMode();
    await resetDb();
    sessionId = await createSession();
  });
  afterAll(() => useLiveMode());

  it("Gate 1: persona is risk_averse and centres security/compliance", async () => {
    const res = await personaPOST(jsonRequest({}), params(sessionId));
    expect(res.status).toBe(200);
    const { persona } = await res.json();
    expect(persona.risk_posture).toBe("risk_averse");
    const text = [...persona.business_priorities, ...persona.hot_buttons].join(" ").toLowerCase();
    expect(/security|compliance|audit|risk/.test(text)).toBe(true);
  });

  it("Gate 2: scenarios have 4-6 objections incl. Risk and ROI, and 5-7 questions", async () => {
    const res = await scenariosPOST(jsonRequest({}), params(sessionId));
    expect(res.status).toBe(200);
    const { scenarios } = await res.json();
    expect(scenarios.objections.length).toBeGreaterThanOrEqual(4);
    expect(scenarios.objections.length).toBeLessThanOrEqual(6);
    expect(scenarios.strategic_questions.length).toBeGreaterThanOrEqual(5);
    expect(scenarios.strategic_questions.length).toBeLessThanOrEqual(7);
    const categories = scenarios.objections.map((o: { category: string }) => o.category);
    expect(categories).toContain("Risk/Compliance/Security");
    expect(categories).toContain("ROI/Financial");
  });

  it("Gate 3: the persona replies on every turn with a stance in the enum", async () => {
    for (const turn of TRANSCRIPT.filter((t) => t.role === "user")) {
      const events = await readSse(await chatPOST(jsonRequest({ message: turn.content }), params(sessionId)));
      expect(events.some((e) => e.event === "token")).toBe(true);
      expect(STANCES).toContain(events.find((e) => e.event === "stance")?.stance);
      expect(events.at(-1)?.event).toBe("done");
    }
  });

  it("Gate 4: evaluation has 4 integer scores, only verbatim quotes, >=2 real-turn rewrites, coded mean, playbook and cheat sheet", async () => {
    const res = await evaluatePOST(jsonRequest({}), params(sessionId));
    expect(res.status).toBe(200);
    evaluation = (await res.json()).evaluation;

    const dims = ["clarity", "confidence", "structure", "relevance"];
    for (const d of dims) {
      expect(Number.isInteger(evaluation[`${d}_score`])).toBe(true);
      expect(evaluation[`${d}_score`]).toBeGreaterThanOrEqual(1);
      expect(evaluation[`${d}_score`]).toBeLessThanOrEqual(10);
    }
    const userTexts = TRANSCRIPT.filter((t) => t.role === "user").map((t) => t.content.toLowerCase());
    for (const quote of dims.flatMap((d) => evaluation[`${d}_evidence`] as string[])) {
      expect(userTexts.some((t) => t.includes(quote.toLowerCase()))).toBe(true);
    }
    expect(evaluation.turn_rewrites.length).toBeGreaterThanOrEqual(2);
    for (const rw of evaluation.turn_rewrites) {
      expect(userTexts).toContain(rw.user_said.toLowerCase());
    }
    const mean = dims.reduce((sum, d) => sum + evaluation[`${d}_score`], 0) / 4;
    expect(evaluation.overall_score).toBe(Number(mean.toFixed(1)));
    expect(evaluation.objection_playbook.length).toBeGreaterThanOrEqual(1);
    expect(evaluation.cheat_sheet.top_talking_points.length).toBeGreaterThan(0);
    expect(evaluation.cheat_sheet.defense_shields.length).toBeGreaterThan(0);
    expect(evaluation.cheat_sheet.killer_questions.length).toBeGreaterThan(0);
  });

  it("Gate 5: reload restores persona, scenarios, transcript and report from SQLite", async () => {
    const data = await (await sessionGET(jsonRequest({}, "GET"), params(sessionId))).json();
    expect(data.session.status).toBe("evaluated");
    expect(data.persona.name).toBe("Marcus Vance");
    expect(data.scenarios.objections.length).toBeGreaterThanOrEqual(4);
    expect(data.turns.map((t: { role: string }) => t.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(data.evaluation).toEqual(evaluation);
  });

  it("Gate 6: with no providers, persona generation fails honestly with LLM_UNAVAILABLE", async () => {
    useLiveMode();
    const saved = { ...process.env };
    delete process.env.OPENCODE_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.LOCAL_LLM_URL;
    resetEnvCache();
    try {
      const freshId = await createSession();
      const res = await personaPOST(jsonRequest({}), params(freshId));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.code).toBe("LLM_UNAVAILABLE");
      expect(body.persona).toBeUndefined();
    } finally {
      process.env = saved;
      useReplayMode();
    }
  });
});
