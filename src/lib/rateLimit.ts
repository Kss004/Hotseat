import { createHash } from "crypto";
import { getReadyDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";

/**
 * Fixed-window request limits per client IP. Counters live in the database so they hold across
 * serverless instances; an in-memory counter would reset whenever a new instance starts.
 */
const BUCKETS = {
  "session-create": { limit: 10, windowSec: 3600, usesLlm: false },
  "persona-generate": { limit: 15, windowSec: 3600, usesLlm: true },
  "persona-edit": { limit: 60, windowSec: 3600, usesLlm: false },
  scenarios: { limit: 15, windowSec: 3600, usesLlm: true },
  chat: { limit: 100, windowSec: 3600, usesLlm: true },
  evaluate: { limit: 10, windowSec: 3600, usesLlm: true },
  end: { limit: 30, windowSec: 3600, usesLlm: false },
  "linkedin-fetch": { limit: 20, windowSec: 3600, usesLlm: false },
  read: { limit: 300, windowSec: 3600, usesLlm: false },
} as const satisfies Record<string, { limit: number; windowSec: number; usesLlm: boolean }>;

export type RateLimitBucket = keyof typeof BUCKETS;

const DAY_SEC = 86400;

/** Client IP as reported by the host's proxy. Vercel overwrites x-forwarded-for, so clients can't spoof it there. */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** IPs are hashed so the database never stores them in plain form. */
function hashIp(ip: string): string {
  return createHash("sha256").update(`hotseat-rl:${ip}`).digest("hex").slice(0, 32);
}

async function hit(key: string, windowSec: number): Promise<{ count: number; resetAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSec);
  const db = await getReadyDb();
  // One atomic upsert: increments within the current window, restarts the count when a new window begins
  const res = await db.execute({
    sql: `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
          ON CONFLICT(key) DO UPDATE SET
            count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
            window_start = excluded.window_start
          RETURNING count`,
    args: [key, windowStart],
  });

  // Occasionally drop rows from long-finished windows so the table stays small
  if (Math.random() < 0.02) {
    await db.execute({ sql: `DELETE FROM rate_limits WHERE window_start < ?`, args: [now - 2 * DAY_SEC] });
  }

  return { count: Number(res.rows[0].count), resetAt: windowStart + windowSec };
}

function secondsUntil(resetAt: number): number {
  return Math.max(1, Math.ceil(resetAt - Date.now() / 1000));
}

/**
 * Counts one use of a shared quota (e.g. the daily live-research budget) and returns false once it is used up.
 * Always true when RATE_LIMIT is off.
 */
export async function tryConsumeQuota(key: string, limit: number, windowSec: number): Promise<boolean> {
  if (getEnv().RATE_LIMIT === "off") return true;
  const { count } = await hit(key, windowSec);
  return count <= limit;
}

/**
 * Short-window burst limit per IP, shared by every API route. Normal use (one click at a time) stays far below it;
 * it stops scripts firing a whole hourly allowance in one second. Generous enough for a few people behind one NAT.
 */
const BURST = { limit: 20, windowSec: 10 };
const MINUTE_SEC = 60;

function tooMany(message: string, resetAt: number): AppError {
  return new AppError("RATE_LIMITED", message, 429, { retry_after_seconds: secondsUntil(resetAt) });
}

/** Throws RATE_LIMITED (429) when this client, or all clients together on AI routes, are over a limit. */
export async function enforceRateLimit(req: Request, bucket: RateLimitBucket): Promise<void> {
  const env = getEnv();
  if (env.RATE_LIMIT === "off") return;

  const ipHash = hashIp(clientIp(req));
  const burst = await hit(`burst:${ipHash}`, BURST.windowSec);
  if (burst.count > BURST.limit) {
    throw tooMany("You're sending requests too quickly. Please wait a few seconds and try again.", burst.resetAt);
  }

  const cfg = BUCKETS[bucket];
  const own = await hit(`${bucket}:${ipHash}`, cfg.windowSec);
  if (own.count > cfg.limit) {
    const retryAfter = secondsUntil(own.resetAt);
    const minutes = Math.ceil(retryAfter / 60);
    throw new AppError(
      "RATE_LIMITED",
      `Too many requests from your network. Please wait about ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`,
      429,
      { retry_after_seconds: retryAfter }
    );
  }

  if (cfg.usesLlm) {
    // Keeps all visitors together under the AI providers' own per-minute limits
    const perMinute = await hit("llm-minute:global", MINUTE_SEC);
    if (perMinute.count > env.GLOBAL_LLM_PER_MINUTE) {
      throw tooMany("The coach is busy right now. Please retry in a few seconds.", perMinute.resetAt);
    }

    const global = await hit("llm-daily:global", DAY_SEC);
    if (global.count > env.GLOBAL_DAILY_LLM_LIMIT) {
      throw new AppError(
        "RATE_LIMITED",
        "This demo has reached its daily AI usage limit. Please try again tomorrow.",
        429,
        { retry_after_seconds: secondsUntil(global.resetAt) }
      );
    }
  }
}
