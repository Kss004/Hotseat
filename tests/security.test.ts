import { describe, it, expect, beforeEach } from "vitest";
import { createSession, resetDb, useReplayMode } from "./helpers";

describe("Deployment security", () => {
  beforeEach(async () => {
    useReplayMode();
    await resetDb();
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
});
