import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { clearRecentSessions, forgetSession, listRecentSessions, rememberSession } from "@/lib/recentSessions";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    raw: data,
  };
}

const id = (n: number) => `sess_${n.toString(16).padStart(32, "0")}`;

describe("Recent sessions (browser-only list)", () => {
  let storage: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("1. Adds new sessions first, and updates in place without losing the date or score", () => {
    rememberSession({ id: id(1), counterpart: "Marcus Vance", company: "Apex" });
    rememberSession({ id: id(2), counterpart: "Sam Patel", company: "HSBC UK" });
    expect(listRecentSessions().map((s) => s.id)).toEqual([id(2), id(1)]);

    const createdAt = listRecentSessions()[1].createdAt;
    rememberSession({ id: id(1), counterpart: "Marcus Vance", company: "Apex", score: 5.5 });
    // A later restore without a score must not wipe it
    rememberSession({ id: id(1), counterpart: "Marcus Vance", company: "Apex" });

    const [second, first] = listRecentSessions();
    expect(second.id).toBe(id(2));
    expect(first).toMatchObject({ id: id(1), score: 5.5, createdAt });
  });

  it("2. Keeps at most 10, and forgets or clears on request", () => {
    for (let n = 1; n <= 12; n++) rememberSession({ id: id(n), counterpart: `P${n}`, company: "C" });
    const list = listRecentSessions();
    expect(list).toHaveLength(10);
    expect(list[0].id).toBe(id(12));

    forgetSession(id(12));
    expect(listRecentSessions().map((s) => s.id)).not.toContain(id(12));
    clearRecentSessions();
    expect(listRecentSessions()).toEqual([]);
  });

  it("3. Ignores invalid ids and corrupted or malformed storage", () => {
    rememberSession({ id: "javascript:alert(1)", counterpart: "x", company: "y" });
    expect(listRecentSessions()).toEqual([]);

    storage.raw.set("hotseat:recent-sessions", "{not json");
    expect(listRecentSessions()).toEqual([]);

    storage.raw.set("hotseat:recent-sessions", JSON.stringify([{ id: "../evil", counterpart: 1 }, { id: id(3), counterpart: "Ok", company: "C", createdAt: "2026-10-20" }]));
    expect(listRecentSessions().map((s) => s.id)).toEqual([id(3)]);
  });

  it("4. Never throws when storage is blocked", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => { throw new Error("blocked"); },
        setItem: () => { throw new Error("blocked"); },
      },
    });
    expect(() => rememberSession({ id: id(1), counterpart: "x", company: "y" })).not.toThrow();
    expect(listRecentSessions()).toEqual([]);
  });
});
