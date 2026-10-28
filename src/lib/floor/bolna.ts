import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { getVoiceAgentSystemPrompt, getVoiceWelcomeMessage } from "./prompt";

/**
 * Thin client for the Bolna REST API (https://www.bolna.ai/docs/api-reference).
 * Bolna owns telephony, speech-to-text, the live LLM turn loop, text-to-speech and batch scheduling.
 */

export interface BolnaExecution {
  id: string;
  agent_id?: string;
  batch_id?: string | null;
  status: string;
  termination_reason?: string | null;
  conversation_duration?: number | null;
  transcript?: string | null;
  error_message?: string | null;
  context_details?: { recipient_data?: Record<string, unknown> | null; [k: string]: unknown } | null;
  telephony_data?: {
    recording_url?: string | null;
    to_number?: string | null;
    hangup_reason?: string | null;
    [k: string]: unknown;
  } | null;
  created_at?: string;
  updated_at?: string;
}

/** Statuses after which Bolna will not change the call again. */
export const TERMINAL_STATUSES = new Set([
  "completed",
  "no-answer",
  "busy",
  "failed",
  "canceled",
  "stopped",
  "error",
  "balance-low",
]);

const VOICE_STACK_KEYS = [
  "BOLNA_LLM_PROVIDER",
  "BOLNA_LLM_MODEL",
  "BOLNA_STT_PROVIDER",
  "BOLNA_STT_MODEL",
  "BOLNA_STT_LANGUAGE",
  "BOLNA_TTS_PROVIDER",
  "BOLNA_TTS_VOICE",
] as const;

/** Names of settings that must be set before the floor can call anyone. Empty = ready. */
export function missingBolnaConfig(): string[] {
  const env = getEnv();
  const missing: string[] = [];
  if (!env.BOLNA_API_KEY) missing.push("BOLNA_API_KEY");
  for (const key of VOICE_STACK_KEYS) if (!env[key]) missing.push(key);
  if (!env.PUBLIC_BASE_URL) missing.push("PUBLIC_BASE_URL");
  if (!env.BOLNA_WEBHOOK_SECRET) missing.push("BOLNA_WEBHOOK_SECRET");
  return missing;
}

function assertConfigured() {
  const missing = missingBolnaConfig();
  if (missing.length > 0) {
    throw new AppError("NOT_CONFIGURED", `Bolna is not configured. Set: ${missing.join(", ")}`, 503);
  }
}

export function webhookUrl(): string {
  const env = getEnv();
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/api/floor/webhook?token=${encodeURIComponent(env.BOLNA_WEBHOOK_SECRET)}`;
}

async function bolnaFetch<T>(path: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<T> {
  const env = getEnv();
  const res = await fetch(`${env.BOLNA_API_URL.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.BOLNA_API_KEY}`, ...(init.headers || {}) },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const message =
      (body && typeof body === "object" && "message" in body && String((body as { message: unknown }).message)) ||
      (typeof body === "string" && body.slice(0, 300)) ||
      `HTTP ${res.status}`;
    // Bolna's message is shown to the manager (it names the bad field); the API key is never part of it
    throw new AppError("BOLNA_ERROR", `Bolna ${init.method || "GET"} ${path.split("?")[0]} failed: ${message}`, 502, {
      status: res.status,
    });
  }
  return body as T;
}

/** Full agent configuration. PUT replaces the whole config, so create and update send the same body. */
export function buildAgentPayload() {
  const env = getEnv();
  const telephony = env.BOLNA_TELEPHONY_PROVIDER;
  const ttsConfig: Record<string, unknown> = { voice: env.BOLNA_TTS_VOICE };
  if (env.BOLNA_TTS_VOICE_ID) ttsConfig.voice_id = env.BOLNA_TTS_VOICE_ID;
  if (env.BOLNA_TTS_MODEL) ttsConfig.model = env.BOLNA_TTS_MODEL;
  if (env.BOLNA_TTS_LANGUAGE) ttsConfig.language = env.BOLNA_TTS_LANGUAGE;

  return {
    agent_config: {
      agent_name: "Hotseat Floor - practice buyer",
      agent_welcome_message: getVoiceWelcomeMessage(),
      webhook_url: webhookUrl(),
      agent_type: "other",
      // TRAI: outbound calls only 09:00-21:00 in the recipient's timezone
      calling_guardrails: { call_start_hour: 9, call_end_hour: 21 },
      tasks: [
        {
          task_type: "conversation",
          toolchain: { execution: "sequential", pipelines: [["transcriber", "llm", "synthesizer"]] },
          tools_config: {
            llm_agent: {
              agent_type: "simple_llm_agent",
              agent_flow_type: "streaming",
              llm_config: {
                provider: env.BOLNA_LLM_PROVIDER,
                model: env.BOLNA_LLM_MODEL,
                max_tokens: 120,
                // Bolna requires 1 for reasoning models (e.g. gpt-5.x); fine for others too
                temperature: 1,
              },
            },
            transcriber: {
              provider: env.BOLNA_STT_PROVIDER,
              model: env.BOLNA_STT_MODEL,
              language: env.BOLNA_STT_LANGUAGE,
              stream: true,
              endpointing: 300,
            },
            synthesizer: {
              provider: env.BOLNA_TTS_PROVIDER,
              provider_config: ttsConfig,
              stream: true,
              buffer_size: 200,
              audio_format: "wav",
            },
            input: { provider: telephony, format: "wav" },
            output: { provider: telephony, format: "wav" },
          },
          task_config: {
            call_terminate: env.FLOOR_MAX_CALL_SECONDS,
            hangup_after_silence: 15,
            hangup_after_LLMCall: true,
            call_hangup_message: "Thanks, that's all for today's practice call. Your report will be ready shortly.",
          },
        },
      ],
    },
    agent_prompts: { task_1: { system_prompt: getVoiceAgentSystemPrompt() } },
  };
}

export async function createAgent(): Promise<string> {
  assertConfigured();
  const res = await bolnaFetch<{ agent_id: string }>("/v2/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildAgentPayload()),
  });
  return res.agent_id;
}

export async function updateAgent(agentId: string): Promise<void> {
  assertConfigured();
  await bolnaFetch(`/v2/agent/${encodeURIComponent(agentId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildAgentPayload()),
  });
}

/** The agent as Bolna stored it (read back to confirm a create or update took effect). */
export async function getAgent(agentId: string): Promise<Record<string, unknown>> {
  assertConfigured();
  return bolnaFetch<Record<string, unknown>>(`/v2/agent/${encodeURIComponent(agentId)}`);
}

/** Bolna rejects the "Z" suffix and wants a numeric offset with no milliseconds, e.g. 2026-10-30T03:30:00+00:00. */
export function formatScheduledAt(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

export async function createBatch(agentId: string, csv: string): Promise<string> {
  assertConfigured();
  const env = getEnv();
  const form = new FormData();
  form.append("agent_id", agentId);
  form.append("file", new Blob([csv], { type: "text/csv" }), "floor.csv");
  if (env.BOLNA_FROM_NUMBER) form.append("from_phone_numbers", env.BOLNA_FROM_NUMBER);
  form.append("webhook_url", webhookUrl());
  const res = await bolnaFetch<{ batch_id: string }>("/batches", { method: "POST", body: form });
  return res.batch_id;
}

export async function scheduleBatch(batchId: string, at: Date): Promise<void> {
  assertConfigured();
  const form = new FormData();
  form.append("scheduled_at", formatScheduledAt(at));
  await bolnaFetch(`/batches/${encodeURIComponent(batchId)}/schedule`, { method: "POST", body: form });
}

export async function stopBatch(batchId: string): Promise<void> {
  assertConfigured();
  await bolnaFetch(`/batches/${encodeURIComponent(batchId)}/stop`, { method: "POST" });
}

export async function getExecution(executionId: string): Promise<BolnaExecution> {
  assertConfigured();
  return bolnaFetch<BolnaExecution>(`/executions/${encodeURIComponent(executionId)}`);
}

export async function listBatchExecutions(batchId: string): Promise<BolnaExecution[]> {
  assertConfigured();
  const all: BolnaExecution[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await bolnaFetch<{ data: BolnaExecution[]; has_more: boolean }>(
      `/v2/batches/${encodeURIComponent(batchId)}/executions?page_number=${page}&page_size=100`
    );
    all.push(...(res.data || []));
    if (!res.has_more) break;
  }
  return all;
}

/** A single immediate call (used for a rep's test call or a manual redial). */
export async function makeCall(params: {
  agentId: string;
  phone: string;
  userData: Record<string, string>;
}): Promise<string> {
  assertConfigured();
  const env = getEnv();
  const res = await bolnaFetch<{ execution_id: string }>("/call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: params.agentId,
      recipient_phone_number: params.phone,
      ...(env.BOLNA_FROM_NUMBER ? { from_phone_number: env.BOLNA_FROM_NUMBER } : {}),
      user_data: params.userData,
    }),
  });
  return res.execution_id;
}
