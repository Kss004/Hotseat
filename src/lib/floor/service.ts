import { randomUUID } from "crypto";
import { z } from "zod";
import { getReadyDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { AppError, isAppError } from "@/lib/errors";
import { evaluateSession, generatePersona, generateScenarios, loadPersona } from "@/lib/pipeline";
import { scenariosOutputSchema, type MeetingContext } from "@/types";
import { createHash } from "crypto";
import {
  buildAgentPayload,
  createAgent,
  createBatch,
  getExecution,
  listBatchExecutions,
  missingBolnaConfig,
  scheduleBatch,
  stopBatch,
  updateAgent,
  TERMINAL_STATUSES,
  type BolnaExecution,
} from "./bolna";
import { buildCallBrief, pickObjectionPlan, toVariableText } from "./prompt";
import { parseTranscript } from "./transcript";

// ==========================================
// Small helpers
// ==========================================

const nowSec = () => Math.floor(Date.now() / 1000);
const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "")}`;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export const MAX_REPS_PER_RUN = 30;

function errorText(err: unknown): string {
  if (isAppError(err)) return `${err.code}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

// ==========================================
// Settings
// ==========================================

export interface FloorSettings {
  product_summary: string;
  goal: string;
  daily_enabled: boolean;
  bolna_agent_id: string;
}

async function getSetting(key: string): Promise<string> {
  const db = await getReadyDb();
  const res = await db.execute({ sql: `SELECT value FROM floor_settings WHERE key = ?`, args: [key] });
  return res.rows.length ? (res.rows[0].value as string) : "";
}

async function setSetting(key: string, value: string): Promise<void> {
  const db = await getReadyDb();
  await db.execute({
    sql: `INSERT INTO floor_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [key, value],
  });
}

export async function getSettings(): Promise<FloorSettings> {
  return {
    product_summary: await getSetting("product_summary"),
    goal: await getSetting("goal"),
    daily_enabled: (await getSetting("daily_enabled")) === "1",
    bolna_agent_id: getEnv().BOLNA_AGENT_ID || (await getSetting("bolna_agent_id")),
  };
}

export const settingsInputSchema = z.object({
  product_summary: z.string().trim().min(20, "Describe what the team sells in at least 20 characters").max(2000),
  goal: z.string().trim().min(5, "Give the reps' goal for the call").max(500),
  daily_enabled: z.boolean(),
});

export async function saveSettings(input: z.infer<typeof settingsInputSchema>): Promise<void> {
  await setSetting("product_summary", input.product_summary);
  await setSetting("goal", input.goal);
  await setSetting("daily_enabled", input.daily_enabled ? "1" : "0");
  if (input.daily_enabled) await ensureNextDailyRun();
}

/**
 * Creates the Bolna agent once, and pushes the config again whenever the prompt or voice settings change
 * (PUT replaces the whole config, so a hash of the payload tells us when an update is needed).
 */
export async function ensureAgent(): Promise<string> {
  const payloadHash = createHash("sha256").update(JSON.stringify(buildAgentPayload())).digest("hex");
  const settings = await getSettings();
  let agentId = settings.bolna_agent_id;
  if (!agentId) {
    agentId = await createAgent();
    await setSetting("bolna_agent_id", agentId);
    await setSetting("agent_config_hash", payloadHash);
    return agentId;
  }
  if ((await getSetting("agent_config_hash")) !== payloadHash) {
    await updateAgent(agentId);
    await setSetting("agent_config_hash", payloadHash);
  }
  return agentId;
}

// ==========================================
// Roster
// ==========================================

export const repInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  phone_e164: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/, "Phone must be in international format, e.g. +919876543210"),
  deal_notes: z
    .string()
    .trim()
    .min(80, "Deal notes must be at least 80 characters: who the buyer is, their company, and where the deal stands")
    .max(4000),
  consent: z.literal(true, {
    errorMap: () => ({ message: "The rep must have agreed to recorded AI practice calls" }),
  }),
  consent_note: z.string().trim().min(3, "Say how consent was given (e.g. 'signed form 28 Oct')").max(300),
});

export interface FloorRep {
  id: string;
  name: string;
  phone_e164: string;
  deal_notes: string;
  consent_at: string;
  consent_note: string;
  opted_out_at: string | null;
}

export async function addRep(input: z.infer<typeof repInputSchema>): Promise<FloorRep> {
  const db = await getReadyDb();
  const id = newId("rep");
  const consentAt = new Date().toISOString();
  try {
    await db.execute({
      sql: `INSERT INTO floor_reps (id, name, phone_e164, deal_notes, consent_at, consent_note) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [id, input.name, input.phone_e164, input.deal_notes, consentAt, input.consent_note],
    });
  } catch (err) {
    if (String(err).includes("UNIQUE")) {
      throw new AppError("VALIDATION", `A rep with phone ${input.phone_e164} is already on the floor`, 409);
    }
    throw err;
  }
  return {
    id,
    name: input.name,
    phone_e164: input.phone_e164,
    deal_notes: input.deal_notes,
    consent_note: input.consent_note,
    consent_at: consentAt,
    opted_out_at: null,
  };
}

export async function listReps(): Promise<FloorRep[]> {
  const db = await getReadyDb();
  const res = await db.execute(
    `SELECT id, name, phone_e164, deal_notes, consent_at, consent_note, opted_out_at FROM floor_reps ORDER BY created_at ASC`
  );
  return res.rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    phone_e164: r.phone_e164 as string,
    deal_notes: r.deal_notes as string,
    consent_at: r.consent_at as string,
    consent_note: r.consent_note as string,
    opted_out_at: (r.opted_out_at as string | null) || null,
  }));
}

/** Opting out stops future calls but keeps past results; opting back in records fresh consent. */
export async function setRepOptOut(repId: string, optedOut: boolean, consentNote?: string): Promise<void> {
  const db = await getReadyDb();
  const res = optedOut
    ? await db.execute({ sql: `UPDATE floor_reps SET opted_out_at = ? WHERE id = ?`, args: [new Date().toISOString(), repId] })
    : await db.execute({
        sql: `UPDATE floor_reps SET opted_out_at = NULL, consent_at = ?, consent_note = ? WHERE id = ?`,
        args: [new Date().toISOString(), consentNote || "re-consented", repId],
      });
  if (res.rowsAffected === 0) throw new AppError("NOT_FOUND", "Rep not found", 404);
}

/** Removes the rep and every call, transcript and score belonging to them. */
export async function deleteRep(repId: string): Promise<void> {
  const db = await getReadyDb();
  const sessions = await db.execute({
    sql: `SELECT session_id FROM floor_calls WHERE rep_id = ? AND session_id IS NOT NULL`,
    args: [repId],
  });
  for (const row of sessions.rows) {
    await db.execute({ sql: `DELETE FROM sessions WHERE id = ?`, args: [row.session_id as string] });
  }
  await db.execute({ sql: `DELETE FROM floor_jobs WHERE ref_id IN (SELECT id FROM floor_calls WHERE rep_id = ?)`, args: [repId] });
  const res = await db.execute({ sql: `DELETE FROM floor_reps WHERE id = ?`, args: [repId] });
  if (res.rowsAffected === 0) throw new AppError("NOT_FOUND", "Rep not found", 404);
}

// ==========================================
// Runs
// ==========================================

/** Next weekday-agnostic morning slot in IST, at least 15 minutes away (prep runs before it). */
export function nextMorningSlot(now = Date.now(), hourIst = getEnv().FLOOR_CALL_HOUR_IST): Date {
  const ist = new Date(now + IST_OFFSET_MS);
  let slot = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), hourIst, 0, 0) - IST_OFFSET_MS;
  if (slot < now + 15 * 60 * 1000) slot += 24 * 60 * 60 * 1000;
  return new Date(slot);
}

export async function createRun(params: {
  when: "now" | "next_morning";
  repIds?: string[];
  autoLaunch: boolean;
}): Promise<string> {
  const settings = await getSettings();
  if (!settings.product_summary || !settings.goal) {
    throw new AppError("VALIDATION", "Set what the team sells and the call goal first", 400);
  }
  let reps = (await listReps()).filter((r) => !r.opted_out_at);
  if (params.repIds) reps = reps.filter((r) => params.repIds!.includes(r.id));
  if (reps.length === 0) throw new AppError("VALIDATION", "No reps with consent to call", 400);
  if (reps.length > MAX_REPS_PER_RUN) {
    throw new AppError("VALIDATION", `At most ${MAX_REPS_PER_RUN} reps per run`, 400);
  }

  const scheduledAt = params.when === "now" ? new Date() : nextMorningSlot();
  const env = getEnv();
  const meeting: MeetingContext = {
    product_summary: settings.product_summary,
    goal: settings.goal,
    meeting_type: "Sales call (phone)",
    duration_minutes: Math.max(1, Math.round(env.FLOOR_MAX_CALL_SECONDS / 60)),
    // Floor calls skip live web research: it costs a search quota per rep and adds latency to prep
    web_research: false,
  };

  const db = await getReadyDb();
  const runId = newId("run");
  await db.execute({
    sql: `INSERT INTO floor_runs (id, scheduled_at, status, auto_launch, product_summary, goal) VALUES (?, ?, 'preparing', ?, ?, ?)`,
    args: [runId, scheduledAt.toISOString(), params.autoLaunch ? 1 : 0, settings.product_summary, settings.goal],
  });

  for (const rep of reps) {
    const sessionId = `sess_${randomUUID().replace(/-/g, "")}`;
    await db.execute({
      sql: `INSERT INTO sessions (id, title, raw_input, meeting_context, difficulty, max_turns, status)
            VALUES (?, ?, ?, ?, 'hostile', 30, 'draft')`,
      args: [sessionId, `Hotseat Floor: ${rep.name}`, rep.deal_notes, JSON.stringify(meeting)],
    });
    const callId = newId("call");
    await db.execute({
      sql: `INSERT INTO floor_calls (id, run_id, rep_id, session_id) VALUES (?, ?, ?, ?)`,
      args: [callId, runId, rep.id, sessionId],
    });
    await enqueueJob("prepare_call", callId);
  }
  return runId;
}

async function getRun(runId: string) {
  const db = await getReadyDb();
  const res = await db.execute({ sql: `SELECT * FROM floor_runs WHERE id = ?`, args: [runId] });
  if (res.rows.length === 0) throw new AppError("NOT_FOUND", "Run not found", 404);
  return res.rows[0];
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Builds the Bolna batch CSV: contact_number plus one column per prompt variable. */
export function buildBatchCsv(
  rows: Array<{ phone: string; rep_name: string; buyer_name: string; buyer_company: string; call_brief: string; call_id: string }>
): string {
  const header = "contact_number,rep_name,buyer_name,buyer_company,call_brief,hotseat_call_id";
  const lines = rows.map((r) =>
    [r.phone, r.rep_name, r.buyer_name, r.buyer_company, r.call_brief, r.call_id]
      .map((v) => csvCell(toVariableText(v)))
      .join(",")
  );
  return [header, ...lines].join("\n") + "\n";
}

/** Sends the prepared calls to Bolna as one batch and schedules it. Only a run in 'ready' can launch, once. */
export async function launchRun(runId: string): Promise<void> {
  // Check settings before touching the run, so a missing key leaves it ready to launch once fixed
  const missing = missingBolnaConfig();
  if (missing.length > 0) {
    throw new AppError("NOT_CONFIGURED", `Bolna is not configured. Set: ${missing.join(", ")}`, 503);
  }
  const db = await getReadyDb();
  const claimed = await db.execute({
    // A launch that failed before Bolna accepted a batch can be retried
    sql: `UPDATE floor_runs SET status = 'launching', error = NULL
          WHERE id = ? AND (status = 'ready' OR (status = 'failed' AND bolna_batch_id IS NULL)) RETURNING id`,
    args: [runId],
  });
  if (claimed.rows.length === 0) {
    const run = await getRun(runId);
    throw new AppError("VALIDATION", `Run can't be launched while it is '${run.status}'`, 409);
  }

  try {
    const run = await getRun(runId);
    const calls = await db.execute({
      sql: `SELECT c.id, c.call_brief, c.session_id, r.name, r.phone_e164
            FROM floor_calls c JOIN floor_reps r ON r.id = c.rep_id
            WHERE c.run_id = ? AND c.prep_status = 'ready' AND r.opted_out_at IS NULL`,
      args: [runId],
    });
    if (calls.rows.length === 0) throw new AppError("VALIDATION", "No prepared calls to launch", 400);

    const rows = [];
    for (const c of calls.rows) {
      const persona = await loadPersona(c.session_id as string);
      rows.push({
        phone: c.phone_e164 as string,
        rep_name: c.name as string,
        buyer_name: persona?.name || "the buyer",
        buyer_company: persona?.company || "their company",
        call_brief: c.call_brief as string,
        call_id: c.id as string,
      });
    }

    const agentId = await ensureAgent();
    const batchId = await createBatch(agentId, buildBatchCsv(rows));
    await db.execute({ sql: `UPDATE floor_runs SET bolna_batch_id = ? WHERE id = ?`, args: [batchId, runId] });

    // Bolna needs the time at least 2 minutes ahead; anything under 10 minutes is dispatched immediately
    const at = new Date(Math.max(new Date(run.scheduled_at as string).getTime(), Date.now() + 3 * 60 * 1000));
    await scheduleBatch(batchId, at);

    await db.execute({
      sql: `UPDATE floor_runs SET status = 'scheduled', scheduled_at = ? WHERE id = ?`,
      args: [at.toISOString(), runId],
    });
    await db.execute({
      sql: `UPDATE floor_calls SET call_status = 'scheduled', updated_at = CURRENT_TIMESTAMP
            WHERE run_id = ? AND prep_status = 'ready'`,
      args: [runId],
    });
  } catch (err) {
    await db.execute({
      sql: `UPDATE floor_runs SET status = 'failed', error = ? WHERE id = ?`,
      args: [errorText(err), runId],
    });
    throw err;
  }
}

export async function cancelRun(runId: string): Promise<void> {
  const run = await getRun(runId);
  const db = await getReadyDb();
  if (run.bolna_batch_id && ["scheduled", "calling"].includes(run.status as string)) {
    await stopBatch(run.bolna_batch_id as string);
  }
  await db.execute({ sql: `UPDATE floor_runs SET status = 'cancelled' WHERE id = ?`, args: [runId] });
  await db.execute({
    sql: `UPDATE floor_jobs SET status = 'failed', last_error = 'run cancelled'
          WHERE kind = 'prepare_call' AND status = 'queued' AND ref_id IN (SELECT id FROM floor_calls WHERE run_id = ?)`,
    args: [runId],
  });
  await db.execute({
    sql: `UPDATE floor_calls SET eval_status = 'not_scored', eval_error = 'Run cancelled'
          WHERE run_id = ? AND eval_status = 'waiting'`,
    args: [runId],
  });
}

/** When the morning schedule is on, keep exactly one upcoming run queued up. */
export async function ensureNextDailyRun(): Promise<string | null> {
  const settings = await getSettings();
  if (!settings.daily_enabled) return null;
  const db = await getReadyDb();
  const upcoming = await db.execute({
    sql: `SELECT id FROM floor_runs
          WHERE auto_launch = 1 AND status IN ('preparing', 'ready', 'launching', 'scheduled') AND scheduled_at > ?
          LIMIT 1`,
    args: [new Date().toISOString()],
  });
  if (upcoming.rows.length > 0) return null;
  try {
    return await createRun({ when: "next_morning", autoLaunch: true });
  } catch (err) {
    console.warn("Daily floor run not created:", errorText(err));
    return null;
  }
}

// ==========================================
// Job queue
// ==========================================

type JobKind = "prepare_call" | "evaluate_call";

/** Time a job of each kind may need, so a worker never starts one it can't finish inside the request. */
const JOB_NEEDS_MS: Record<JobKind, number> = { prepare_call: 200_000, evaluate_call: 170_000 };
const LEASE_SEC = 240;

export async function enqueueJob(kind: JobKind, refId: string): Promise<void> {
  const db = await getReadyDb();
  // Re-enqueueing a finished job (e.g. "retry scoring") resets it; a queued or running one is left alone
  await db.execute({
    sql: `INSERT INTO floor_jobs (id, kind, ref_id) VALUES (?, ?, ?)
          ON CONFLICT(kind, ref_id) DO UPDATE SET
            status = 'queued', attempts = 0, run_after = 0, locked_until = 0, last_error = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE floor_jobs.status IN ('done', 'failed')`,
    args: [newId("job"), kind, refId],
  });
}

interface ClaimedJob {
  id: string;
  kind: JobKind;
  ref_id: string;
  attempts: number;
  max_attempts: number;
}

async function claimJob(kinds: JobKind[], onlyRefId?: string): Promise<ClaimedJob | null> {
  if (kinds.length === 0) return null;
  const db = await getReadyDb();
  const now = nowSec();
  const kindList = kinds.map(() => "?").join(", ");
  const eligible = `(status = 'queued' OR (status = 'running' AND locked_until < ?)) AND run_after <= ? AND kind IN (${kindList})${
    onlyRefId ? " AND ref_id = ?" : ""
  }`;
  const eligibleArgs = [now, now, ...kinds, ...(onlyRefId ? [onlyRefId] : [])];
  // One statement, so two workers can never claim the same job
  const res = await db.execute({
    sql: `UPDATE floor_jobs SET status = 'running', attempts = attempts + 1, locked_until = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = (SELECT id FROM floor_jobs WHERE ${eligible} ORDER BY created_at ASC LIMIT 1) AND ${eligible}
          RETURNING id, kind, ref_id, attempts, max_attempts`,
    args: [now + LEASE_SEC, ...eligibleArgs, ...eligibleArgs],
  });
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: r.id as string,
    kind: r.kind as JobKind,
    ref_id: r.ref_id as string,
    attempts: Number(r.attempts),
    max_attempts: Number(r.max_attempts),
  };
}

/** Errors worth retrying: provider outages and timeouts. Bad input or a short call won't change on retry. */
function isRetryable(err: unknown): boolean {
  if (!isAppError(err)) return true;
  return ["LLM_UNAVAILABLE", "LLM_INVALID_OUTPUT", "RATE_LIMITED", "BOLNA_ERROR", "INTERNAL_ERROR"].includes(err.code);
}

async function runJob(job: ClaimedJob): Promise<void> {
  const db = await getReadyDb();
  try {
    if (job.attempts > job.max_attempts) throw new AppError("INTERNAL_ERROR", "Job ran out of attempts", 500);
    if (job.kind === "prepare_call") await prepareCall(job.ref_id);
    else await evaluateCall(job.ref_id);
    await db.execute({
      sql: `UPDATE floor_jobs SET status = 'done', last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      args: [job.id],
    });
  } catch (err) {
    const message = errorText(err);
    const retry = isRetryable(err) && job.attempts < job.max_attempts;
    await db.execute({
      sql: `UPDATE floor_jobs SET status = ?, last_error = ?, run_after = ?, locked_until = 0, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
      args: [retry ? "queued" : "failed", message, nowSec() + 30 * job.attempts, job.id],
    });
    if (!retry) await onJobGaveUp(job, err);
  }
}

async function onJobGaveUp(job: ClaimedJob, err: unknown): Promise<void> {
  const db = await getReadyDb();
  const message = errorText(err);
  if (job.kind === "prepare_call") {
    await db.execute({
      sql: `UPDATE floor_calls SET prep_status = 'failed', prep_error = ?, eval_status = 'not_scored',
              eval_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      args: [message, `Call not prepared (${message})`, job.ref_id],
    });
    const call = await db.execute({ sql: `SELECT run_id FROM floor_calls WHERE id = ?`, args: [job.ref_id] });
    if (call.rows.length) await markRunReadyIfPrepared(call.rows[0].run_id as string);
  } else {
    const shortCall = isAppError(err) && err.code === "INSUFFICIENT_TURNS";
    await db.execute({
      sql: `UPDATE floor_calls SET eval_status = ?, eval_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      args: [shortCall ? "not_scored" : "failed", message, job.ref_id],
    });
    const call = await db.execute({ sql: `SELECT run_id FROM floor_calls WHERE id = ?`, args: [job.ref_id] });
    if (call.rows.length) await updateRunProgress(call.rows[0].run_id as string);
  }
}

/** Runs queued jobs in parallel until the time budget can't fit another one. */
export async function processJobs(opts: { budgetMs: number; concurrency?: number; onlyRefId?: string }): Promise<number> {
  const deadline = Date.now() + opts.budgetMs;
  let done = 0;
  const worker = async () => {
    for (;;) {
      const remaining = deadline - Date.now();
      const kinds = (Object.keys(JOB_NEEDS_MS) as JobKind[]).filter((k) => JOB_NEEDS_MS[k] <= remaining);
      const job = await claimJob(kinds, opts.onlyRefId);
      if (!job) return;
      await runJob(job);
      done++;
      if (opts.onlyRefId) return;
    }
  };
  await Promise.all(Array.from({ length: opts.onlyRefId ? 1 : opts.concurrency ?? 4 }, worker));
  return done;
}

// ==========================================
// Job handlers
// ==========================================

async function getCall(callId: string) {
  const db = await getReadyDb();
  const res = await db.execute({ sql: `SELECT * FROM floor_calls WHERE id = ?`, args: [callId] });
  if (res.rows.length === 0) throw new AppError("NOT_FOUND", "Call not found", 404);
  return res.rows[0];
}

/** Generates the buyer persona and objection bank for one rep's call, then fixes the objection plan and brief. */
async function prepareCall(callId: string): Promise<void> {
  const call = await getCall(callId);
  const sessionId = call.session_id as string;
  const db = await getReadyDb();

  if (!(await loadPersona(sessionId))) await generatePersona(sessionId, 90_000);
  const scenRes = await db.execute({ sql: `SELECT objections FROM scenarios WHERE session_id = ?`, args: [sessionId] });
  let objections = scenRes.rows.length ? JSON.parse(scenRes.rows[0].objections as string) : null;
  if (!objections) objections = (await generateScenarios(sessionId, 100_000)).scenarios.objections;
  objections = scenariosOutputSchema.shape.objections.parse(objections);

  const plan = pickObjectionPlan(objections);
  if (plan.length === 0) throw new AppError("VALIDATION", "No objections could be planned for this call", 400);

  const persona = await loadPersona(sessionId);
  const session = await db.execute({ sql: `SELECT meeting_context FROM sessions WHERE id = ?`, args: [sessionId] });
  const brief = buildCallBrief({
    persona: persona!,
    meeting: JSON.parse(session.rows[0].meeting_context as string),
    plan,
    maxCallSeconds: getEnv().FLOOR_MAX_CALL_SECONDS,
  });

  await db.execute({
    sql: `UPDATE floor_calls SET prep_status = 'ready', prep_error = NULL, objection_plan = ?, call_brief = ?,
            updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    args: [JSON.stringify(plan), brief, callId],
  });
  await markRunReadyIfPrepared(call.run_id as string);
}

/** Once no call is still being prepared, the run is ready (and launches itself if it is a scheduled morning run). */
async function markRunReadyIfPrepared(runId: string): Promise<void> {
  const db = await getReadyDb();
  const counts = await db.execute({
    sql: `SELECT SUM(prep_status = 'pending') AS pending, SUM(prep_status = 'ready') AS ready FROM floor_calls WHERE run_id = ?`,
    args: [runId],
  });
  if (Number(counts.rows[0].pending) > 0) return;
  const ready = Number(counts.rows[0].ready);
  const moved = await db.execute({
    sql: `UPDATE floor_runs SET status = ?, error = ? WHERE id = ? AND status = 'preparing' RETURNING auto_launch`,
    args: [ready > 0 ? "ready" : "failed", ready > 0 ? null : "No call could be prepared", runId],
  });
  if (moved.rows.length && ready > 0 && Number(moved.rows[0].auto_launch) === 1) {
    try {
      await launchRun(runId);
    } catch (err) {
      console.warn(`Auto-launch of ${runId} failed:`, errorText(err));
    }
  }
}

async function evaluateCall(callId: string): Promise<void> {
  const call = await getCall(callId);
  const db = await getReadyDb();
  await db.execute({
    sql: `UPDATE floor_calls SET eval_status = 'scoring', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    args: [callId],
  });
  await evaluateSession(call.session_id as string, { budgetMs: 160_000, callTimeoutMs: 75_000 });
  await db.execute({
    sql: `UPDATE floor_calls SET eval_status = 'scored', eval_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    args: [callId],
  });
  await updateRunProgress(call.run_id as string);
}

/** Manager action: score a call again (e.g. after a provider outage). */
export async function rescoreCall(callId: string): Promise<void> {
  const call = await getCall(callId);
  if (call.call_status !== "completed") throw new AppError("VALIDATION", "Only completed calls can be scored", 400);
  const db = await getReadyDb();
  await db.execute({
    sql: `UPDATE floor_calls SET eval_status = 'pending', eval_error = NULL WHERE id = ?`,
    args: [callId],
  });
  await enqueueJob("evaluate_call", callId);
}

// ==========================================
// Ingesting calls from Bolna
// ==========================================

const NOT_CONNECTED_REASONS: Record<string, string> = {
  "no-answer": "No answer",
  busy: "Line busy",
  failed: "Call failed",
  error: "Call failed",
  canceled: "Call cancelled",
  stopped: "Call stopped",
  "balance-low": "Bolna balance too low to place the call",
};

/** Applies an execution record from Bolna's API to the matching floor call. Returns the call id it updated. */
export async function applyExecution(exec: BolnaExecution): Promise<string | null> {
  const db = await getReadyDb();
  const hinted = exec.context_details?.recipient_data?.hotseat_call_id;
  const res = await db.execute({
    sql: `SELECT c.*, r.bolna_batch_id FROM floor_calls c JOIN floor_runs r ON r.id = c.run_id
          WHERE c.bolna_execution_id = ? OR c.id = ? LIMIT 1`,
    args: [exec.id, typeof hinted === "string" ? hinted : ""],
  });
  if (res.rows.length === 0) return null;
  const call = res.rows[0];

  // The call must belong to the batch Bolna says it came from
  if (exec.batch_id && call.bolna_batch_id && exec.batch_id !== call.bolna_batch_id) return null;
  // A finished call is never overwritten by a different execution
  if (call.bolna_execution_id && call.bolna_execution_id !== exec.id && call.call_status === "completed") return null;

  const callId = call.id as string;
  const terminal = TERMINAL_STATUSES.has(exec.status);
  await db.execute({
    sql: `UPDATE floor_calls SET bolna_execution_id = ?, call_status = ?, termination_reason = ?, duration_sec = ?,
            recording_url = ?, transcript = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    args: [
      exec.id,
      exec.status,
      exec.termination_reason || exec.telephony_data?.hangup_reason || null,
      typeof exec.conversation_duration === "number" ? exec.conversation_duration : null,
      exec.telephony_data?.recording_url || null,
      terminal ? exec.transcript || null : null,
      callId,
    ],
  });

  if (terminal && call.eval_status === "waiting") {
    if (exec.status === "completed") await queueScoring(callId, call.session_id as string, exec.transcript);
    else {
      const reason = NOT_CONNECTED_REASONS[exec.status] || `Call ended: ${exec.status}`;
      await db.execute({
        sql: `UPDATE floor_calls SET eval_status = 'not_scored', eval_error = ? WHERE id = ? AND eval_status = 'waiting'`,
        args: [exec.error_message ? `${reason} (${exec.error_message})` : reason, callId],
      });
    }
  }
  await updateRunProgress(call.run_id as string);
  return callId;
}

/** Stores the transcript as session turns (verbatim) and queues scoring, or records why it can't be scored. */
async function queueScoring(callId: string, sessionId: string, transcript: string | null | undefined): Promise<void> {
  const db = await getReadyDb();
  const turns = parseTranscript(transcript);
  const userTurns = turns.filter((t) => t.role === "user").length;

  if (userTurns < 2) {
    await db.execute({
      sql: `UPDATE floor_calls SET eval_status = 'not_scored', eval_error = ? WHERE id = ? AND eval_status = 'waiting'`,
      args: [
        turns.length === 0
          ? "Call connected but no conversation was transcribed"
          : `Short call: the rep spoke ${userTurns} time${userTurns === 1 ? "" : "s"}; scoring needs at least 2`,
        callId,
      ],
    });
    return;
  }

  const existing = await db.execute({ sql: `SELECT COUNT(*) AS n FROM turns WHERE session_id = ?`, args: [sessionId] });
  if (Number(existing.rows[0].n) === 0) {
    try {
      await db.batch(
        turns.map((t, i) => ({
          sql: `INSERT INTO turns (id, session_id, turn_number, role, content) VALUES (?, ?, ?, ?, ?)`,
          args: [newId("turn"), sessionId, i + 1, t.role, t.content],
        })),
        "write"
      );
    } catch (err) {
      // A concurrent delivery of the same webhook already stored these turns
      if (!String(err).includes("UNIQUE")) throw err;
    }
  }
  const moved = await db.execute({
    sql: `UPDATE floor_calls SET eval_status = 'pending' WHERE id = ? AND eval_status = 'waiting' RETURNING id`,
    args: [callId],
  });
  if (moved.rows.length) await enqueueJob("evaluate_call", callId);
}

/** Webhook path: the posted body only names the execution; its contents are fetched from Bolna's API. */
export async function ingestExecutionById(executionId: string): Promise<string | null> {
  return applyExecution(await getExecution(executionId));
}

const SETTLED_EVAL = new Set(["scored", "not_scored", "failed"]);

/** Moves a launched run through calling -> scoring -> done from its calls' states. */
export async function updateRunProgress(runId: string): Promise<void> {
  const db = await getReadyDb();
  const run = await getRun(runId);
  if (!["scheduled", "calling", "scoring"].includes(run.status as string)) return;
  const calls = await db.execute({
    sql: `SELECT call_status, eval_status FROM floor_calls WHERE run_id = ? AND prep_status = 'ready'`,
    args: [runId],
  });
  const all = calls.rows;
  const anyStarted = all.some((c) => c.call_status !== "scheduled");
  const allCallsEnded = all.every((c) => TERMINAL_STATUSES.has(c.call_status as string));
  const allSettled = all.every((c) => SETTLED_EVAL.has(c.eval_status as string));
  const next = allSettled ? "done" : allCallsEnded ? "scoring" : anyStarted ? "calling" : "scheduled";
  if (next !== run.status) {
    await db.execute({ sql: `UPDATE floor_runs SET status = ? WHERE id = ?`, args: [next, runId] });
    if (next === "done") await ensureNextDailyRun();
  }
}

/** Catches anything a lost webhook missed by asking Bolna for every execution of the active batches. */
export async function reconcileActiveRuns(): Promise<{ checked: number; errors: string[] }> {
  const db = await getReadyDb();
  const last = Number((await getSetting("last_reconcile")) || 0);
  if (nowSec() - last < 20) return { checked: 0, errors: [] };
  await setSetting("last_reconcile", String(nowSec()));

  const runs = await db.execute({
    sql: `SELECT id, bolna_batch_id FROM floor_runs
          WHERE status IN ('scheduled', 'calling') AND bolna_batch_id IS NOT NULL AND scheduled_at <= ?`,
    args: [new Date(Date.now() + 60_000).toISOString()],
  });
  let checked = 0;
  const errors: string[] = [];
  for (const run of runs.rows) {
    try {
      for (const exec of await listBatchExecutions(run.bolna_batch_id as string)) {
        await applyExecution(exec);
        checked++;
      }
    } catch (err) {
      errors.push(errorText(err));
    }
  }
  return { checked, errors };
}

/** One unit of background progress: catch up with Bolna, then work the job queue. */
export async function tick(budgetMs: number): Promise<{ jobs: number; checked: number; errors: string[] }> {
  const start = Date.now();
  let reconcile = { checked: 0, errors: [] as string[] };
  try {
    reconcile = await reconcileActiveRuns();
  } catch (err) {
    reconcile.errors.push(errorText(err));
  }
  const jobs = await processJobs({ budgetMs: budgetMs - (Date.now() - start) });
  return { jobs, ...reconcile };
}
