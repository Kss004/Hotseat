import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { isAppError } from "@/lib/errors";
import { enforceRateLimit, clientIp } from "@/lib/rateLimit";
import { createSession, jsonRequest, resetDb, useReplayMode } from "./helpers";
import marcus from "../fixtures/marcus-vance.json";

function fromIp(ip: string, body: unknown = {}): Request {
  const req = jsonRequest(body);
  req.headers.set("x-forwarded-for", `${ip}, 10.0.0.1`);
  return req;
}

async function rateLimitError(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return err;
  }
  return null;
}

describe("Deployment security", () => {
  beforeEach(async () => {
    useReplayMode();
    await resetDb();
  });

  afterEach(() => {
    process.env.RATE_LIMIT = "off";
    delete process.env.GLOBAL_DAILY_LLM_LIMIT;
    delete process.env.GLOBAL_LLM_PER_MINUTE;
    resetEnvCache();
    vi.useRealTimers();
  });

  it("#1 does not expose a route that lists every session", async () => {
    const mod: Record<string, unknown> = await import("@/app/api/sessions/route");
    expect(mod.GET).toBeUndefined();
  });

  it("#2 session ids are random 128-bit hex, not timestamps", async () => {
    const a = await createSession();
    const b = await createSession();
    expect(a).toMatch(/^sess_[0-9a-f]{32}$/);
    expect(b).toMatch(/^sess_[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  describe("rate limiting", () => {
    beforeEach(() => {
      process.env.RATE_LIMIT = "on";
      resetEnvCache();
    });

    it("#3 uses the first x-forwarded-for entry as the client IP", () => {
      expect(clientIp(fromIp("203.0.113.7"))).toBe("203.0.113.7");
      expect(clientIp(jsonRequest({}))).toBe("unknown");
    });

    it("#4 allows the limit per IP, then rejects with RATE_LIMITED 429; other IPs are unaffected", async () => {
      for (let i = 0; i < 10; i++) await enforceRateLimit(fromIp("203.0.113.1"), "evaluate");

      const err = await rateLimitError(enforceRateLimit(fromIp("203.0.113.1"), "evaluate"));
      expect(isAppError(err) && err.code).toBe("RATE_LIMITED");
      expect(isAppError(err) && err.status).toBe(429);
      expect(isAppError(err) && (err.details as { retry_after_seconds: number }).retry_after_seconds).toBeGreaterThan(0);

      await expect(enforceRateLimit(fromIp("203.0.113.2"), "evaluate")).resolves.toBeUndefined();
    });

    it("#5 caps AI requests from all IPs combined per day", async () => {
      process.env.GLOBAL_DAILY_LLM_LIMIT = "3";
      resetEnvCache();
      for (let i = 0; i < 3; i++) await enforceRateLimit(fromIp(`198.51.100.${i}`), "chat");

      const err = await rateLimitError(enforceRateLimit(fromIp("198.51.100.99"), "chat"));
      expect(isAppError(err) && err.message).toMatch(/daily AI usage limit/);
      // Non-AI routes don't count toward or get blocked by the daily AI cap
      await expect(enforceRateLimit(fromIp("198.51.100.99"), "read")).resolves.toBeUndefined();
    });

    it("#6 the count restarts in the next window", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-20T10:00:00Z"));
      for (let i = 0; i < 10; i++) await enforceRateLimit(fromIp("203.0.113.3"), "evaluate");
      expect(await rateLimitError(enforceRateLimit(fromIp("203.0.113.3"), "evaluate"))).not.toBeNull();

      vi.setSystemTime(new Date("2026-10-20T11:00:01Z"));
      await expect(enforceRateLimit(fromIp("203.0.113.3"), "evaluate")).resolves.toBeUndefined();
    });

    it("#7 a route returns 429 RATE_LIMITED once the client is over its limit", async () => {
      const { POST } = await import("@/app/api/sessions/route");
      const body = {
        title: marcus.title,
        raw_input: marcus.raw_input,
        meeting_context: marcus.meeting_context,
        difficulty: marcus.difficulty,
      };
      for (let i = 0; i < 10; i++) expect((await POST(fromIp("192.0.2.5", body))).status).toBe(201);

      const res = await POST(fromIp("192.0.2.5", body));
      expect(res.status).toBe(429);
      expect((await res.json()).code).toBe("RATE_LIMITED");
    });

    it("#8 a burst of more than 20 requests in 10 seconds from one IP is rejected, across routes", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-20T10:00:00Z"));
      // Mixed routes share the burst bucket; none of their own hourly limits is reached here
      for (let i = 0; i < 20; i++) await enforceRateLimit(fromIp("203.0.113.20"), i % 2 ? "read" : "persona-edit");

      const err = await rateLimitError(enforceRateLimit(fromIp("203.0.113.20"), "read"));
      expect(isAppError(err) && err.status).toBe(429);
      expect(isAppError(err) && err.message).toMatch(/too quickly/);
      // Another IP is unaffected
      await expect(enforceRateLimit(fromIp("203.0.113.21"), "read")).resolves.toBeUndefined();

      // The next 10-second window starts fresh
      vi.setSystemTime(new Date("2026-10-20T10:00:10Z"));
      await expect(enforceRateLimit(fromIp("203.0.113.20"), "read")).resolves.toBeUndefined();
    });

    it("#9 caps AI requests from all IPs combined per minute; non-AI routes are unaffected", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-20T10:00:00Z"));
      process.env.GLOBAL_LLM_PER_MINUTE = "3";
      resetEnvCache();
      for (let i = 0; i < 3; i++) await enforceRateLimit(fromIp(`198.51.100.${10 + i}`), "chat");

      const err = await rateLimitError(enforceRateLimit(fromIp("198.51.100.50"), "chat"));
      expect(isAppError(err) && err.status).toBe(429);
      expect(isAppError(err) && err.message).toMatch(/busy/);
      await expect(enforceRateLimit(fromIp("198.51.100.50"), "read")).resolves.toBeUndefined();

      vi.setSystemTime(new Date("2026-10-20T10:01:00Z"));
      await expect(enforceRateLimit(fromIp("198.51.100.51"), "chat")).resolves.toBeUndefined();
    });

    it("#10 a normal full session stays well inside every limit", async () => {
      // persona, scenarios, 10 chat turns, end, evaluate, plus page reads, all from one IP within a minute
      const ip = "192.0.2.77";
      const steps: Array<Parameters<typeof enforceRateLimit>[1]> = [
        "session-create", "persona-generate", "read", "scenarios",
        ...Array<"chat">(10).fill("chat"), "end", "evaluate", "read", "read",
      ];
      for (const step of steps) {
        await expect(enforceRateLimit(fromIp(ip), step)).resolves.toBeUndefined();
      }
    });
  });
});
