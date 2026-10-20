/**
 * The user's recent sessions, kept only in this browser (localStorage). There is deliberately no server route that
 * lists sessions: a session link is the only key to it, so the list lives where the links already are.
 * Every access is wrapped in try/catch: storage can be blocked, full, or cleared at any time.
 */
export interface RecentSession {
  id: string;
  counterpart: string;
  company: string;
  createdAt: string;
  score?: number;
}

const STORAGE_KEY = "hotseat:recent-sessions";
const MAX_ENTRIES = 10;
const SESSION_ID = /^sess_[A-Za-z0-9_-]+$/;

function isRecentSession(value: unknown): value is RecentSession {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    SESSION_ID.test(v.id) &&
    typeof v.counterpart === "string" &&
    typeof v.company === "string" &&
    typeof v.createdAt === "string" &&
    (v.score === undefined || typeof v.score === "number")
  );
}

export function listRecentSessions(): RecentSession[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(isRecentSession).slice(0, MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

function save(entries: RecentSession[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // Storage unavailable: the list is a convenience, so the app carries on without it
  }
}

/** Adds or updates a session, keeping its original date and position; new sessions go first. */
export function rememberSession(entry: Omit<RecentSession, "createdAt">): void {
  if (!SESSION_ID.test(entry.id)) return;
  const entries = listRecentSessions();
  const existing = entries.find((e) => e.id === entry.id);
  if (existing) {
    save(entries.map((e) => (e.id === entry.id ? { ...e, ...entry, score: entry.score ?? e.score } : e)));
  } else {
    save([{ ...entry, createdAt: new Date().toISOString() }, ...entries]);
  }
}

export function forgetSession(id: string): void {
  save(listRecentSessions().filter((e) => e.id !== id));
}

export function clearRecentSessions(): void {
  save([]);
}
