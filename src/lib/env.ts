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
