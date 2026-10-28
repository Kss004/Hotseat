import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { getReadyDb } from "@/lib/db";
import { parseTranscript } from "@/lib/floor/transcript";
import { pickObjectionPlan, buildCallBrief, getVoiceAgentSystemPrompt } from "@/lib/floor/prompt";
import {
  addRep,
  buildBatchCsv,
  createRun,
  launchRun,
  nextMorningSlot,
  processJobs,
  saveSettings,
} from "@/lib/floor/service";
import { formatScheduledAt } from "@/lib/floor/bolna";
import {
  createManagerCookieValue,
  createReportToken,
  isManager,
  verifyReportToken,
  checkManagerPassword,
  MANAGER_COOKIE,
} from "@/lib/floor/auth";
import { buildDashboard, listRuns } from "@/lib/floor/dashboard";
import { postValidateEvaluation } from "@/lib/evaluation";
import scenariosFixture from "../fixtures/llm/scenarios.json";
import evaluateFixture from "../fixtures/llm/evaluate.json";
import personaFixture from "../fixtures/llm/persona.json";
import { useReplayMode, resetDb, TRANSCRIPT } from "./helpers";
import type { EvaluationOutput, Turn } from "@/types";

const FLOOR_ENV: Record<string, string> = {
  BOLNA_API_KEY: "test-bolna-key",
  BOLNA_LLM_PROVIDER: "openai",
  BOLNA_LLM_MODEL: "test-model",
  BOLNA_STT_PROVIDER: "sarvam",
  BOLNA_STT_MODEL: "saaras:v4",
  BOLNA_STT_LANGUAGE: "en",
  BOLNA_TTS_PROVIDER: "sarvam",
  BOLNA_TTS_VOICE: "Priya",
  PUBLIC_BASE_URL: "https://floor.test",
  BOLNA_WEBHOOK_SECRET: "hook-secret-123",
  APP_SECRET: "app-secret-0123456789",
  MANAGER_PASSWORD: "manager-pw",
  CRON_SECRET: "cron-secret",
};

function setFloorEnv() {
  Object.assign(process.env, FLOOR_ENV);
  resetEnvCache();
}

function clearFloorEnv() {
  for (const key of Object.keys(FLOOR_ENV)) delete process.env[key];
  resetEnvCache();
}

const DEAL =
  "Buyer is Marcus Vance, Managing Director of Risk at Apex Financial. Second call; he passed the last audit and doubts he needs a pilot.";

/**
 * Bolna's transcript format ("role: text" per line). The replayed evaluation fixture refers to user turns 1 and 3,
 * so these test transcripts start with the rep; real calls start with the agent's welcome (covered in #1).
 */
function bolnaTranscript(turns: ReadonlyArray<{ role: string; content: string }>) {
  return turns.map((t) => `${t.role}: ${t.content}`).join("\n");
}

/** Stand-in for Bolna's API: records requests and serves executions from a map. */
function mockBolna(executions: Record<string, Record<string, unknown>>) {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || "GET";
    calls.push({ method, url, body: init?.body });
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (method === "POST" && url.endsWith("/v2/agent")) return json({ agent_id: "agent-1", state: "created" }, 201);
    if (method === "PUT" && url.includes("/v2/agent/")) return json({ agent_id: "agent-1", status: "updated" });
    if (method === "POST" && url.endsWith("/batches")) return json({ batch_id: "batch1", state: "created" }, 201);
    if (method === "POST" && url.includes("/schedule")) return json({ message: "success", state: "scheduled" });
    const exec = url.match(/\/executions\/([^/?]+)$/);
    if (exec) return executions[exec[1]] ? json(executions[exec[1]]) : json({ message: "not found" }, 404);
    if (url.includes("/v2/batches/")) return json({ data: Object.values(executions), has_more: false });
    return json({ message: `unexpected ${method} ${url}` }, 500);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

async function webhook(body: unknown, token = FLOOR_ENV.BOLNA_WEBHOOK_SECRET) {
  const { POST } = await import("@/app/api/floor/webhook/route");
  return POST(
    new Request(`https://floor.test/api/floor/webhook?token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

/** Sets up one rep, prepares a run (replayed LLM) and launches it against the mocked Bolna. */
async function preparedAndLaunchedRun() {
  await saveSettings({
    product_summary: "Tamper-evident audit logging for regulated banks, sold as a 60-day sandbox pilot.",
    goal: "Agree a pilot success metric",
    daily_enabled: false,
  });
  await addRep({ name: "Asha", phone_e164: "+919876543210", deal_notes: DEAL, consent: true, consent_note: "signed form" });
  const runId = await createRun({ when: "now", autoLaunch: false });
  await processJobs({ budgetMs: 600_000 });
  await launchRun(runId);
  const db = await getReadyDb();
  const call = (await db.execute({ sql: `SELECT id, session_id FROM floor_calls WHERE run_id = ?`, args: [runId] })).rows[0];
  return { runId, callId: call.id as string, sessionId: call.session_id as string };
}

describe("Hotseat Floor: pure helpers", () => {
  it("#1 parses Bolna transcripts verbatim, merging continuation lines and repeated speakers", () => {
    const turns = parseTranscript("assistant: Hi there.\nuser: We cut audit prep\nby 40 percent.\nuser: Across 3 banks.\n\nassistant: Prove it.");
    expect(turns).toEqual([
      { role: "assistant", content: "Hi there." },
      { role: "user", content: "We cut audit prep by 40 percent. Across 3 banks." },
      { role: "assistant", content: "Prove it." },
    ]);
    expect(parseTranscript(null)).toEqual([]);
  });

  it("#2 plans one objection per category, most severe first, without inventing missing categories", () => {
    const plan = pickObjectionPlan(scenariosFixture.objections as never);
    expect(plan.map((p) => p.category)).toEqual(["ROI/Financial", "Risk/Compliance/Security", "Implementation", "Status Quo/Vendor"]);
    const onlyRoi = pickObjectionPlan((scenariosFixture.objections as never[]).filter((o: { category: string }) => o.category === "ROI/Financial"));
    expect(onlyRoi).toHaveLength(1);
  });

  it("#3 builds a one-line brief with no braces, and the agent prompt discloses AI and has a stop word", () => {
    const brief = buildCallBrief({
      persona: { ...personaFixture, background: "Line one\nline {two}" } as never,
      meeting: { product_summary: "X", goal: "Y", meeting_type: "call", duration_minutes: 5 },
      plan: pickObjectionPlan(scenariosFixture.objections as never),
      maxCallSeconds: 300,
    });
    expect(brief).not.toMatch(/[{}\n]/);
    const prompt = getVoiceAgentSystemPrompt();
    expect(prompt).toContain("{call_brief}");
    expect(prompt).toMatch(/AI practice buyer/);
    expect(prompt).toMatch(/stop/);
    expect(prompt).not.toMatch(/NEVER mention that you are an AI/);
  });

  it("#4 escapes the batch CSV and formats Bolna's schedule time with a numeric offset", () => {
    const csv = buildBatchCsv([{ phone: "+919876543210", rep_name: 'A, "B"', buyer_name: "M", buyer_company: "C", call_brief: "x {y}", call_id: "call_1" }]);
    expect(csv.split("\n")[0]).toBe("contact_number,rep_name,buyer_name,buyer_company,call_brief,hotseat_call_id");
    expect(csv).toContain('"A, ""B"""');
    expect(csv).toContain(",x y,");
    expect(formatScheduledAt(new Date("2026-10-30T03:30:00.123Z"))).toBe("2026-10-30T03:30:00+00:00");
  });

  it("#5 picks the next 09:00 IST slot at least 15 minutes ahead", () => {
    // 02:00 UTC = 07:30 IST -> same day 09:00 IST = 03:30 UTC
    expect(nextMorningSlot(Date.parse("2026-10-29T02:00:00Z"), 9).toISOString()).toBe("2026-10-29T03:30:00.000Z");
    // 03:20 UTC = 08:50 IST -> under 15 minutes away, so the next day
    expect(nextMorningSlot(Date.parse("2026-10-29T03:20:00Z"), 9).toISOString()).toBe("2026-10-30T03:30:00.000Z");
  });

  it("#6 forces an unanswered objection to 1 and drops unverifiable objection evidence", () => {
    const data = JSON.parse(JSON.stringify(evaluateFixture)) as EvaluationOutput;
    data.objection_playbook = [
      { ...data.objection_playbook[0], user_turn_number: null, handling_score: 7, evidence: ["invented words"] },
    ];
    const userTurns = TRANSCRIPT.filter((t) => t.role === "user").map((t, i) => ({ ...t, turn_number: i * 2 + 1 })) as unknown as Turn[];
    const { evaluation } = postValidateEvaluation(data, userTurns);
    expect(evaluation.objection_playbook[0].handling_score).toBe(1);
    expect(evaluation.objection_playbook[0].evidence).toEqual([]);
  });
});

describe("Hotseat Floor: auth", () => {
  beforeEach(setFloorEnv);
  afterEach(clearFloorEnv);

  it("#7 manager cookie and report tokens verify, and tampering fails", () => {
    const cookie = createManagerCookieValue();
    const req = (c: string) => new Request("https://floor.test/", { headers: { cookie: `${MANAGER_COOKIE}=${c}` } });
    expect(isManager(req(cookie))).toBe(true);
    expect(isManager(req(cookie.replace(/.$/, (ch) => (ch === "a" ? "b" : "a"))))).toBe(false);
    expect(isManager(req(createManagerCookieValue(Date.now() - 13 * 3600 * 1000)))).toBe(false);
    expect(isManager(new Request("https://floor.test/"))).toBe(false);

    const token = createReportToken("call_abc");
    expect(verifyReportToken(token)).toBe("call_abc");
    expect(verifyReportToken(token.replace("call_abc", "call_xyz"))).toBeNull();

    expect(checkManagerPassword("manager-pw")).toBe(true);
    expect(checkManagerPassword("wrong")).toBe(false);
  });

  it("#8 manager routes reject requests without the login cookie", async () => {
    const { GET } = await import("@/app/api/floor/state/route");
    const res = await GET(new Request("https://floor.test/api/floor/state"), { params: {} as never });
    expect(res.status).toBe(401);
    const ok = await GET(
      new Request("https://floor.test/api/floor/state", { headers: { cookie: `${MANAGER_COOKIE}=${createManagerCookieValue()}` } }),
      { params: {} as never }
    );
    expect(ok.status).toBe(200);
  });
});

describe("Hotseat Floor: end-to-end against a mocked Bolna", () => {
  beforeEach(async () => {
    useReplayMode();
    setFloorEnv();
    await resetDb();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearFloorEnv();
  });

  it("#9 prepares, launches one batch with per-rep variables, ingests the webhook, scores and aggregates", async () => {
    const executions: Record<string, Record<string, unknown>> = {};
    const requests = mockBolna(executions);
    const { runId, callId, sessionId } = await preparedAndLaunchedRun();

    const batchReq = requests.find((r) => r.method === "POST" && r.url.endsWith("/batches"));
    const csv = await ((batchReq!.body as FormData).get("file") as Blob).text();
    expect(csv).toContain(`+919876543210,Asha,${personaFixture.name}`);
    expect(csv).toContain(callId);
    const schedule = requests.find((r) => r.url.includes("/schedule"));
    expect(String((schedule!.body as FormData).get("scheduled_at"))).toMatch(/\+00:00$/);
    expect(requests.find((r) => r.url.endsWith("/v2/agent"))).toBeTruthy();

    executions["11111111-aaaa-bbbb-cccc-000000000001"] = {
      id: "11111111-aaaa-bbbb-cccc-000000000001",
      batch_id: "batch1",
      status: "completed",
      conversation_duration: 182.5,
      transcript: bolnaTranscript(TRANSCRIPT),
      context_details: { recipient_data: { hotseat_call_id: callId } },
      telephony_data: { recording_url: "https://rec.test/1.mp3" },
    };
    // The webhook body is only a pointer; a forged transcript in it is ignored
    const res = await webhook({ id: "11111111-aaaa-bbbb-cccc-000000000001", transcript: "user: forged" });
    expect(res.status).toBe(200);

    const db = await getReadyDb();
    const call = (await db.execute({ sql: `SELECT * FROM floor_calls WHERE id = ?`, args: [callId] })).rows[0];
    expect(call.call_status).toBe("completed");
    expect(call.eval_status).toBe("scored");
    const turns = await db.execute({ sql: `SELECT role, content FROM turns WHERE session_id = ? ORDER BY turn_number`, args: [sessionId] });
    expect(turns.rows.map((t) => t.content)).toContain(TRANSCRIPT[0].content);
    expect(turns.rows.some((t) => String(t.content).includes("forged"))).toBe(false);

    const [run] = await listRuns();
    expect(run.status).toBe("done");
    expect(run.counts).toMatchObject({ planned: 1, connected: 1, scored: 1 });
    const dash = await buildDashboard([runId]);
    const roi = dash.categories.find((c) => c.category === "ROI/Financial")!;
    expect(roi.n).toBe(1);
    expect(roi.mean).toBe(5);
    // n=1 is below the ranking threshold, so nothing is called the weakest
    expect(dash.weakest).toBeNull();

    // A repeat delivery changes nothing
    await webhook({ id: "11111111-aaaa-bbbb-cccc-000000000001" });
    const again = await db.execute({ sql: `SELECT COUNT(*) AS n FROM turns WHERE session_id = ?`, args: [sessionId] });
    expect(Number(again.rows[0].n)).toBe(turns.rows.length);
  });

  it("#10 a short call and an unanswered call are recorded as not scored, never estimated", async () => {
    const executions: Record<string, Record<string, unknown>> = {};
    mockBolna(executions);
    const { callId } = await preparedAndLaunchedRun();
    executions["22222222-aaaa-bbbb-cccc-000000000002"] = {
      id: "22222222-aaaa-bbbb-cccc-000000000002",
      batch_id: "batch1",
      status: "completed",
      transcript: "assistant: Hello?\nuser: Sorry, bad time.",
      context_details: { recipient_data: { hotseat_call_id: callId } },
    };
    await webhook({ id: "22222222-aaaa-bbbb-cccc-000000000002" });
    const db = await getReadyDb();
    const call = (await db.execute({ sql: `SELECT eval_status, eval_error FROM floor_calls WHERE id = ?`, args: [callId] })).rows[0];
    expect(call.eval_status).toBe("not_scored");
    expect(String(call.eval_error)).toMatch(/Short call/);
    expect((await db.execute(`SELECT COUNT(*) AS n FROM evaluations`)).rows[0].n).toBe(0);
  });

  it("#11 a no-answer is not scored; wrong token, wrong batch and unknown executions are rejected", async () => {
    const executions: Record<string, Record<string, unknown>> = {};
    mockBolna(executions);
    const { callId } = await preparedAndLaunchedRun();

    expect((await webhook({ id: "33333333-aaaa-bbbb-cccc-000000000003" }, "wrong")).status).toBe(401);

    executions["44444444-aaaa-bbbb-cccc-000000000004"] = {
      id: "44444444-aaaa-bbbb-cccc-000000000004",
      batch_id: "some-other-batch",
      status: "completed",
      transcript: bolnaTranscript(TRANSCRIPT),
      context_details: { recipient_data: { hotseat_call_id: callId } },
    };
    const otherBatch = await (await webhook({ id: "44444444-aaaa-bbbb-cccc-000000000004" })).json();
    expect(otherBatch.call_id).toBeNull();

    executions["55555555-aaaa-bbbb-cccc-000000000005"] = {
      id: "55555555-aaaa-bbbb-cccc-000000000005",
      batch_id: "batch1",
      status: "no-answer",
      context_details: { recipient_data: { hotseat_call_id: callId } },
    };
    await webhook({ id: "55555555-aaaa-bbbb-cccc-000000000005" });
    const db = await getReadyDb();
    const call = (await db.execute({ sql: `SELECT call_status, eval_status, eval_error FROM floor_calls WHERE id = ?`, args: [callId] })).rows[0];
    expect(call.call_status).toBe("no-answer");
    expect(call.eval_status).toBe("not_scored");
    expect(call.eval_error).toBe("No answer");
  });

  it("#12 a prep failure with no AI provider is reported, and the run can't launch", async () => {
    mockBolna({});
    process.env.LLM_MODE = "live";
    for (const k of ["OPENCODE_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "LOCAL_LLM_URL"]) delete process.env[k];
    resetEnvCache();
    await saveSettings({ product_summary: "Tamper-evident audit logging for regulated banks.", goal: "Pilot", daily_enabled: false });
    await addRep({ name: "Ravi", phone_e164: "+919812345678", deal_notes: DEAL, consent: true, consent_note: "form" });
    const runId = await createRun({ when: "now", autoLaunch: false });
    const db = await getReadyDb();
    // Exhaust the retries without waiting for the back-off
    for (let i = 0; i < 3; i++) {
      await db.execute(`UPDATE floor_jobs SET run_after = 0`);
      await processJobs({ budgetMs: 600_000 });
    }
    const call = (await db.execute({ sql: `SELECT prep_status, prep_error FROM floor_calls WHERE run_id = ?`, args: [runId] })).rows[0];
    expect(call.prep_status).toBe("failed");
    expect(String(call.prep_error)).toMatch(/LLM_UNAVAILABLE/);
    const run = (await db.execute({ sql: `SELECT status FROM floor_runs WHERE id = ?`, args: [runId] })).rows[0];
    expect(run.status).toBe("failed");
    await expect(launchRun(runId)).rejects.toThrow(/No prepared calls/);
  });
});
