import { managerRoute } from "@/lib/floor/http";
import { ensureAgent, getSettings } from "@/lib/floor/service";
import { getAgent } from "@/lib/floor/bolna";
import { VOICE_AGENT_PROMPT_VERSION } from "@/lib/floor/prompt";

export const maxDuration = 60;

type Obj = Record<string, unknown>;
const get = (o: unknown, path: string[]): unknown =>
  path.reduce<unknown>((cur, k) => (cur && typeof cur === "object" ? (cur as Obj)[k] : undefined), o);

/** Creates the Bolna agent, or pushes the current prompt and voice settings to it. */
export const POST = managerRoute(async () => {
  await ensureAgent();
  return {};
});

/** Reads the agent back from Bolna and returns its main settings (no secrets) so the manager can confirm them. */
export const GET = managerRoute(async () => {
  const { bolna_agent_id } = await getSettings();
  if (!bolna_agent_id) return { agent: null };
  const a = await getAgent(bolna_agent_id);
  const task = (get(a, ["tasks"]) as unknown[] | undefined)?.[0];
  const tools = get(task, ["tools_config"]);
  const webhook = get(a, ["webhook_url"]);
  return {
    agent: {
      name: get(a, ["agent_name"]),
      status: get(a, ["agent_status"]) ?? get(a, ["status"]),
      llm: `${get(tools, ["llm_agent", "llm_config", "provider"])} / ${get(tools, ["llm_agent", "llm_config", "model"])}`,
      transcriber: `${get(tools, ["transcriber", "provider"])} / ${get(tools, ["transcriber", "model"])} / ${get(tools, ["transcriber", "language"])}`,
      voice: `${get(tools, ["synthesizer", "provider"])} / ${get(tools, ["synthesizer", "provider_config", "voice"])}`,
      telephony: get(tools, ["input", "provider"]),
      max_call_seconds: get(task, ["task_config", "call_terminate"]),
      calling_hours: get(a, ["calling_guardrails"]),
      // Only the host: the full URL carries the webhook secret
      webhook_host: typeof webhook === "string" ? new URL(webhook).host : null,
      welcome_message: get(a, ["agent_welcome_message"]),
      prompt_version: VOICE_AGENT_PROMPT_VERSION,
    },
  };
});
