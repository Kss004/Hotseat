import { getReadyDb } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import marcus from "../fixtures/marcus-vance.json";
import personaFixture from "../fixtures/llm/persona.json";
import scenariosFixture from "../fixtures/llm/scenarios.json";

/** Route tests run the real handlers with LLM output served from fixtures/llm/ (LLM_MODE=replay). */
export function useReplayMode() {
  process.env.LLM_MODE = "replay";
  resetEnvCache();
}

export function useLiveMode() {
  process.env.LLM_MODE = "live";
  resetEnvCache();
}

export async function resetDb() {
  const db = await getReadyDb();
  for (const table of [
    "evaluations", "turns", "scenarios", "research", "research_cache", "personas", "llm_calls", "sessions", "rate_limits",
  ]) {
    await db.execute(`DELETE FROM ${table}`);
  }
}

/** User turns contain the verbatim quotes used by fixtures/llm/evaluate.json. */
export const TRANSCRIPT = [
  {
    role: "user",
    content:
      "Thanks Marcus. Our architecture isolates audit logs in customer-managed vaults, and every state change generates a cryptographically signed receipt.",
  },
  { role: "assistant", content: "Signed by whom, and who holds the keys? Vague answers end this meeting." },
  {
    role: "user",
    content:
      "We back our tamper-evident logs with contractual financial SLA credits. Rather than asking you to replace existing systems, we plug into your current infrastructure for a 60-day sandbox.",
  },
  { role: "assistant", content: "And what does that sandbox cost me before I see a single result?" },
] as const;

export function jsonRequest(body: unknown, method = "POST"): Request {
  return new Request("http://localhost/api", {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

export async function createSession(overrides: Record<string, unknown> = {}): Promise<string> {
  const { POST } = await import("@/app/api/sessions/route");
  const res = await POST(
    jsonRequest({
      title: marcus.title,
      target_url: marcus.target_url,
      raw_input: marcus.raw_input,
      meeting_context: marcus.meeting_context,
      difficulty: marcus.difficulty,
      ...overrides,
    })
  );
  const data = await res.json();
  if (res.status !== 201) throw new Error(`createSession failed: ${JSON.stringify(data)}`);
  return data.session.id as string;
}

/** Inserts persona + scenarios rows directly (used when a test isn't about generating them). */
export async function seedPersonaAndScenarios(sessionId: string) {
  const db = await getReadyDb();
  const p = personaFixture;
  await db.execute({
    sql: `INSERT INTO personas (id, session_id, name, title, company, background, risk_posture, technical_depth,
            business_priorities, hot_buttons, conversational_style, uncertain_fields)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      `pers_${sessionId}`, sessionId, p.name, p.title, p.company, p.background, p.risk_posture, p.technical_depth,
      JSON.stringify(p.business_priorities), JSON.stringify(p.hot_buttons), p.conversational_style, "[]",
    ],
  });
  await db.execute({
    sql: `INSERT INTO scenarios (id, session_id, objections, strategic_questions) VALUES (?, ?, ?, ?)`,
    args: [
      `scen_${sessionId}`, sessionId,
      JSON.stringify(scenariosFixture.objections), JSON.stringify(scenariosFixture.strategic_questions),
    ],
  });
}

export async function seedTranscript(sessionId: string, turns: ReadonlyArray<{ role: string; content: string }> = TRANSCRIPT) {
  const db = await getReadyDb();
  for (let i = 0; i < turns.length; i++) {
    await db.execute({
      sql: `INSERT INTO turns (id, session_id, turn_number, role, content) VALUES (?, ?, ?, ?, ?)`,
      args: [`t_${sessionId}_${i + 1}`, sessionId, i + 1, turns[i].role, turns[i].content],
    });
  }
}

/** Reads an SSE response body into parsed event payloads. */
export async function readSse(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text
    .split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block.startsWith("data: "))
    .map((block) => JSON.parse(block.slice(6)));
}

export const params = (id: string) => ({ params: { id } });
