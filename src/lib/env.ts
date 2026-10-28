import { z } from "zod";

export const envSchema = z.object({
  OPENCODE_API_KEY: z.string().default(""),
  GEMINI_API_KEY: z.string().default(""),
  GROQ_API_KEY: z.string().default(""),
  // Model IDs come only from the environment (see .env.example); a provider with a key but no model is a config error
  OPENCODE_MODEL: z.string().default(""),
  GEMINI_MODEL: z.string().default(""),
  GROQ_MODEL: z.string().default(""),
  OPENCODE_BASE_URL: z.string().url().default("https://opencode.ai/inference/go/openai/v1"),
  LOCAL_LLM_URL: z.string().default(""),
  LOCAL_LLM_MODEL: z.string().default(""),
  DATABASE_URL: z.string().default("file:./data/app.db"),
  DATABASE_AUTH_TOKEN: z.string().default(""),
  MAX_TURNS: z.coerce.number().int().min(2).max(30).default(10),
  LLM_MODE: z.enum(["live", "replay"]).default("live"),
  // Per-IP request limits (src/lib/rateLimit.ts); "off" is for tests and local debugging only
  RATE_LIMIT: z.enum(["on", "off"]).default("on"),
  // Cap on AI-backed requests from all visitors combined per UTC day, so rotating IPs can't drain the API keys
  GLOBAL_DAILY_LLM_LIMIT: z.coerce.number().int().min(1).default(500),
  // Cap on AI-backed requests from all visitors combined per minute, to stay under the providers' own per-minute limits
  GLOBAL_LLM_PER_MINUTE: z.coerce.number().int().min(1).default(30),
  // Optional Tavily key for live company research at the briefing step (empty = research off)
  TAVILY_API_KEY: z.string().trim().default(""),
  // Live research runs per UTC day across all visitors (cache hits don't count), to protect the Tavily plan's credits
  RESEARCH_DAILY_LIMIT: z.coerce.number().int().min(1).default(30),

  // --- Hotseat Floor (Bolna voice batch). Empty BOLNA_API_KEY = floor calling off ---
  BOLNA_API_KEY: z.string().trim().default(""),
  BOLNA_API_URL: z.string().url().default("https://api.bolna.ai"),
  // Optional: reuse an agent made earlier; otherwise the app creates one and remembers its id
  BOLNA_AGENT_ID: z.string().trim().default(""),
  // Optional caller ID in E.164; empty = the account's default number
  BOLNA_FROM_NUMBER: z.string().trim().default(""),
  // The agent's own voice stack. Model and voice IDs come only from here (see .env.example)
  BOLNA_LLM_PROVIDER: z.string().trim().default(""),
  BOLNA_LLM_MODEL: z.string().trim().default(""),
  BOLNA_STT_PROVIDER: z.string().trim().default(""),
  BOLNA_STT_MODEL: z.string().trim().default(""),
  BOLNA_STT_LANGUAGE: z.string().trim().default(""),
  BOLNA_TTS_PROVIDER: z.string().trim().default(""),
  BOLNA_TTS_MODEL: z.string().trim().default(""),
  BOLNA_TTS_VOICE: z.string().trim().default(""),
  BOLNA_TTS_VOICE_ID: z.string().trim().default(""),
  BOLNA_TTS_LANGUAGE: z.string().trim().default(""),
  BOLNA_TELEPHONY_PROVIDER: z.string().trim().default("plivo"),
  // Longest a practice call may run, in seconds
  FLOOR_MAX_CALL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
  // Hour (IST) the morning calls start; TRAI allows 9 to 21
  FLOOR_CALL_HOUR_IST: z.coerce.number().int().min(9).max(20).default(9),
  // Public https address of this app, used for the Bolna webhook (e.g. https://hotseat.vercel.app)
  PUBLIC_BASE_URL: z.string().trim().default(""),
  // Shared secret in the webhook URL; the execution is then re-fetched from Bolna before anything is stored
  BOLNA_WEBHOOK_SECRET: z.string().trim().default(""),
  // Manager login for /floor, and the key that signs login cookies and rep report links
  MANAGER_PASSWORD: z.string().default(""),
  APP_SECRET: z.string().default(""),
  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>"
  CRON_SECRET: z.string().default(""),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;

  // Empty strings are treated as unset so defaults apply
  const raw = Object.fromEntries(
    Object.keys(envSchema.shape).map((key) => [key, process.env[key] || undefined])
  );
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    console.error("Environment validation failed:", parsed.error.format());
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }

  const env = parsed.data;
  if (env.OPENCODE_API_KEY && !env.OPENCODE_MODEL) {
    throw new Error("OPENCODE_API_KEY is set but OPENCODE_MODEL is empty. Set OPENCODE_MODEL (see .env.example).");
  }
  if (env.GEMINI_API_KEY && !env.GEMINI_MODEL) {
    throw new Error("GEMINI_API_KEY is set but GEMINI_MODEL is empty. Set GEMINI_MODEL (see .env.example).");
  }
  if (env.GROQ_API_KEY && !env.GROQ_MODEL) {
    throw new Error("GROQ_API_KEY is set but GROQ_MODEL is empty. Set GROQ_MODEL (see .env.example).");
  }

  cachedEnv = env;
  return cachedEnv;
}

/** Test helper: forget the cached env so a test can change process.env. */
export function resetEnvCache(): void {
  cachedEnv = null;
}
