import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { isAppError } from "@/lib/errors";
import { enforceRateLimit, clientIp } from "@/lib/rateLimit";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { ACCESS_COOKIE, accessToken, safeNextPath } from "@/lib/access";
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
    delete process.env.ACCESS_CODE;
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
  });

  describe("access code", () => {
    beforeEach(() => {
      process.env.ACCESS_CODE = "demo-2026";
      resetEnvCache();
    });

    it("#8 without the cookie, pages redirect to /access and APIs return 401 ACCESS_REQUIRED", async () => {
      const page = await middleware(new NextRequest("http://localhost/?session=sess_x"));
      expect(page.status).toBe(307);
      const location = new URL(page.headers.get("location")!);
      expect(location.pathname).toBe("/access");
      expect(location.searchParams.get("next")).toBe("/?session=sess_x");

      const api = await middleware(new NextRequest("http://localhost/api/sessions", { method: "POST" }));
      expect(api.status).toBe(401);
      expect((await api.json()).code).toBe("ACCESS_REQUIRED");

      const accessPage = await middleware(new NextRequest("http://localhost/access"));
      expect(accessPage.headers.get("x-middleware-next")).toBe("1");
    });

    it("#9 a wrong code is rejected; the right one sets an httpOnly cookie that the middleware accepts", async () => {
      const { POST } = await import("@/app/api/access/route");

      const wrong = await POST(jsonRequest({ code: "guess" }));
      expect(wrong.status).toBe(401);
      expect(wrong.headers.get("set-cookie")).toBeNull();

      const right = await POST(jsonRequest({ code: "demo-2026" }));
      expect(right.status).toBe(200);
      const setCookie = right.headers.get("set-cookie")!;
      expect(setCookie).toContain(`${ACCESS_COOKIE}=${await accessToken("demo-2026")}`);
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).not.toContain("demo-2026;");

      const withCookie = await middleware(
        new NextRequest("http://localhost/api/sessions", {
          headers: { cookie: `${ACCESS_COOKIE}=${await accessToken("demo-2026")}` },
        })
      );
      expect(withCookie.headers.get("x-middleware-next")).toBe("1");

      const staleCookie = await middleware(
        new NextRequest("http://localhost/api/sessions", {
          headers: { cookie: `${ACCESS_COOKIE}=${await accessToken("old-code")}` },
        })
      );
      expect(staleCookie.status).toBe(401);
    });

    it("#10 code guesses are rate-limited", async () => {
      process.env.RATE_LIMIT = "on";
      resetEnvCache();
      const { POST } = await import("@/app/api/access/route");
      for (let i = 0; i < 10; i++) expect((await POST(fromIp("203.0.113.9", { code: `g${i}` }))).status).toBe(401);
      expect((await POST(fromIp("203.0.113.9", { code: "demo-2026" }))).status).toBe(429);
    });

    it("#11 only same-origin paths are used as the post-login destination", () => {
      expect(safeNextPath("/?session=sess_x")).toBe("/?session=sess_x");
      expect(safeNextPath("//evil.example")).toBe("/");
      expect(safeNextPath("/\\evil.example")).toBe("/");
      expect(safeNextPath("https://evil.example")).toBe("/");
      expect(safeNextPath(null)).toBe("/");
    });

    it("#12 with no ACCESS_CODE set, the app stays open", async () => {
      delete process.env.ACCESS_CODE;
      resetEnvCache();
      const res = await middleware(new NextRequest("http://localhost/api/sessions"));
      expect(res.headers.get("x-middleware-next")).toBe("1");
    });
  });
});
