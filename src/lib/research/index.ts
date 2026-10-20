import { getReadyDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { tryConsumeQuota } from "@/lib/rateLimit";
import {
  isExcludedResult,
  isPlaceholderCompany,
  normalizeCompanyKey,
  researchCompany,
  type ResearchResult,
} from "@/lib/research/tavily";
import type { MeetingContext, PersonaData, ResearchRecord } from "@/types";

const CACHE_TTL_SEC = 24 * 60 * 60;
// Bumped whenever result filtering changes, so entries filtered under older rules are never served (v2: brand matching)
const CACHE_VERSION = "v2";
const DAY_SEC = 86400;

const OFF_REASON = "Live research was turned off for this session.";
const DAILY_LIMIT_REASON = "Daily research limit reached, so this briefing was generated without live research.";

/**
 * Re-applies the people/job filter to stored findings, so results saved before a filter change (in the cache or a
 * session) are never shown or sent to the model.
 */
function allowedFindings(value: unknown): ResearchRecord["findings"] {
  return parseList<ResearchRecord["findings"][number]>(value).filter((f) => {
    try {
      return !isExcludedResult(new URL(f.url));
    } catch {
      return false;
    }
  });
}

function parseList<T>(value: unknown): T[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readCache(companyKey: string): Promise<ResearchRecord | null> {
  const db = await getReadyDb();
  const res = await db.execute({
    sql: `SELECT reason, queries, findings, fetched_at FROM research_cache WHERE company_key = ?`,
    args: [companyKey],
  });
  const row = res.rows[0];
  if (!row || Number(row.fetched_at) < Math.floor(Date.now() / 1000) - CACHE_TTL_SEC) return null;
  return {
    status: "ok",
    reason: (row.reason as string | null) || undefined,
    queries: parseList(row.queries),
    findings: allowedFindings(row.findings),
    cached: true,
  };
}

async function writeCache(companyKey: string, result: ResearchResult): Promise<void> {
  const db = await getReadyDb();
  await db.execute({
    sql: `INSERT INTO research_cache (company_key, reason, queries, findings, fetched_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(company_key) DO UPDATE SET
            reason = excluded.reason, queries = excluded.queries,
            findings = excluded.findings, fetched_at = excluded.fetched_at`,
    args: [
      companyKey,
      result.reason ?? null,
      JSON.stringify(result.queries),
      JSON.stringify(result.findings),
      Math.floor(Date.now() / 1000),
    ],
  });
}

async function saveForSession(sessionId: string, record: ResearchRecord): Promise<void> {
  const db = await getReadyDb();
  await db.execute({
    sql: `INSERT INTO research (session_id, status, reason, queries, findings) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET
            status = excluded.status, reason = excluded.reason, queries = excluded.queries,
            findings = excluded.findings, created_at = CURRENT_TIMESTAMP`,
    args: [
      sessionId,
      record.status,
      record.reason ?? null,
      JSON.stringify(record.queries),
      JSON.stringify(record.findings),
    ],
  });
}

async function runResearch(persona: PersonaData, meeting: MeetingContext): Promise<ResearchRecord> {
  const env = getEnv();
  if (meeting.web_research === false) {
    return { status: "skipped", reason: OFF_REASON, queries: [], findings: [] };
  }
  if (!env.TAVILY_API_KEY) return { status: "not_configured", queries: [], findings: [] };

  const input = {
    company: persona.company,
    title: persona.title,
    product: meeting.product_summary,
    uncertainFields: persona.uncertain_fields,
  };
  const name = normalizeCompanyKey(persona.company);
  const companyKey = name ? `${CACHE_VERSION}:${name}` : "";

  // Unknown or placeholder companies: let the client report "skipped" (no request) before any cache or quota use
  if (isPlaceholderCompany(input.company, input.uncertainFields)) {
    return researchCompany(input, { apiKey: env.TAVILY_API_KEY });
  }

  if (companyKey) {
    const cached = await readCache(companyKey);
    if (cached) return cached;
  }

  if (!(await tryConsumeQuota("research-daily:global", env.RESEARCH_DAILY_LIMIT, DAY_SEC))) {
    return { status: "skipped", reason: DAILY_LIMIT_REASON, queries: [], findings: [] };
  }

  const result = await researchCompany(input, {
    apiKey: env.TAVILY_API_KEY,
    mode: env.LLM_MODE === "replay" ? "replay" : "live",
  });
  // Only successful searches are cached; a failure should be retried by the next session
  if (result.status === "ok" && companyKey) {
    await writeCache(companyKey, result).catch((e) => console.error("Failed to cache research:", e));
  }
  return result;
}

/**
 * Runs (or reuses) live company research for a session and stores it. Never throws: any failure is
 * recorded as "unavailable", and the briefing is generated without research.
 */
export async function researchForSession(
  sessionId: string,
  persona: PersonaData,
  meeting: MeetingContext
): Promise<ResearchRecord> {
  let record: ResearchRecord;
  try {
    record = await runResearch(persona, meeting);
  } catch (err) {
    console.error("Live research failed:", err);
    record = { status: "unavailable", reason: "Live research is unavailable right now.", queries: [], findings: [] };
  }
  await saveForSession(sessionId, record).catch((e) => console.error("Failed to save research:", e));
  return record;
}

/** The research stored for a session, or null if none was run. */
export async function loadSessionResearch(sessionId: string): Promise<ResearchRecord | null> {
  const db = await getReadyDb();
  const res = await db.execute({
    sql: `SELECT status, reason, queries, findings FROM research WHERE session_id = ?`,
    args: [sessionId],
  });
  const row = res.rows[0];
  if (!row) return null;
  return {
    status: row.status as ResearchRecord["status"],
    reason: (row.reason as string | null) || undefined,
    queries: parseList(row.queries),
    findings: allowedFindings(row.findings),
  };
}
