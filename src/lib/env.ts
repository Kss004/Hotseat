import { z } from "zod";

export const envSchema = z.object({
  GEMINI_API_KEY: z.string().optional().default(""),
  GROQ_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  GROQ_MODEL: z.string().default("llama-3.3-70b-versatile"),
  LOCAL_LLM_URL: z.string().optional().default(""),
  DATABASE_URL: z.string().default("file:./data/app.db"),
  MAX_TURNS: z.coerce.number().int().positive().default(10),
  LLM_MODE: z.enum(["live", "replay"]).default("live"),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;
  
  const parsed = envSchema.safeParse({
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    GROQ_MODEL: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    LOCAL_LLM_URL: process.env.LOCAL_LLM_URL,
    DATABASE_URL: process.env.DATABASE_URL || "file:./data/app.db",
    MAX_TURNS: process.env.MAX_TURNS || "10",
    LLM_MODE: process.env.LLM_MODE || "live",
  });

  if (!parsed.success) {
    console.error("Environment validation failed:", parsed.error.format());
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}
