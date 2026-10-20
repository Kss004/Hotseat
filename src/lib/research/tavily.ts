import * as fs from "fs";
import * as path from "path";

/** Tavily search endpoint (POST, bearer auth). */
const TAVILY_URL = "https://api.tavily.com/search";
const DEFAULT_TIMEOUT_MS = 8000;
const RESULTS_PER_QUERY = 4;
const MAX_FINDINGS = 5;
const MAX_SNIPPET = 400;
const FIXTURE_PATH = "fixtures/research/tavily.json";

const SKIPPED_REASON = "The company name isn't known, so live research was skipped.";
const UNAVAILABLE_REASON = "Live research is unavailable right now.";
const LIMIT_REASON = "Live research limit reached for now.";
const NO_COVERAGE_REASON = "No recent public coverage found for this company.";

export interface ResearchFinding {
  title: string;
  url: string;        // http(s) only
  source: string;     // hostname without "www.", e.g. "reuters.com"
  snippet: string;    // whitespace-collapsed, max 400 chars
  published_date?: string;
}
export type ResearchStatus = "ok" | "skipped" | "unavailable" | "not_configured";
export interface ResearchResult {
  status: ResearchStatus;
  reason?: string;            // human-readable, shown in the UI for skipped/unavailable
  queries: string[];
  findings: ResearchFinding[];
}
export interface ResearchInput {
  company: string;
  title: string;              // the counterpart's job title
  product: string;            // what the user is pitching (not sent to Tavily; reserved)
  uncertainFields?: string[]; // persona fields the AI guessed
}
export interface ResearchOptions {
  apiKey: string;
  mode?: "live" | "replay";   // replay reads fixtures/research/tavily.json, no network
  timeoutMs?: number;          // default 8000
  fetchImpl?: typeof fetch;    // for tests; default global fetch
}

const LEGAL_SUFFIXES = new Set([
  "inc", "ltd", "llc", "plc", "corp", "corporation", "co", "company", "gmbh",
  "ag", "sa", "pvt", "private", "limited",
]);

const PLACEHOLDER_NAMES = [
  "unknown", "n/a", "name unknown", "startup", "a startup", "stealth",
  "confidential", "various", "self-employed", "freelance",
];

/**
 * Research is about the company, never individuals: social networks, people-search sites and job boards are
 * excluded (sent to Tavily, and enforced again here). Matches the domain and its subdomains.
 */
export const EXCLUDED_DOMAINS = [
  "linkedin.com", "facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com", "threads.net",
  "reddit.com", "quora.com", "pinterest.com",
  "rocketreach.co", "zoominfo.com", "signalhire.com", "contactout.com", "theorg.com", "apollo.io", "lusha.com",
  "crunchbase.com/person",
  "indeed.com", "glassdoor.com", "glassdoor.co.uk", "efinancialcareers.com", "ziprecruiter.com", "monster.com",
  "reed.co.uk", "totaljobs.com", "naukri.com", "simplyhired.com", "workday.com", "myworkdayjobs.com",
  "greenhouse.io", "lever.co", "smartrecruiters.com",
];

/** Job listings and people profiles on otherwise-allowed sites (e.g. jobs.example.com, /careers/). */
const PERSON_OR_JOB_PATH = /\/(in|pub|people|profile|profiles|person|jobs?|careers?|vacanc(?:y|ies))(\/|$)/i;

/** True for results from excluded domains, job subdomains, or profile/job pages. */
export function isExcludedResult(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const hostAndPath = `${host}${url.pathname.toLowerCase()}`;
  if (EXCLUDED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`) || hostAndPath.startsWith(d))) return true;
  if (/^(jobs|careers|search\.jobs)\./.test(host)) return true;
  return PERSON_OR_JOB_PATH.test(url.pathname);
}

/** ASCII punctuation, replaced with spaces before comparing text. */
const PUNCTUATION = /[!-\/:-@\[-`{-~]/g;

/** Lowercases, removes apostrophes, turns other punctuation into spaces, collapses whitespace. */
function squash(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(PUNCTUATION, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Collapses all whitespace runs to single spaces and trims. */
function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Lowercased company name without punctuation or trailing legal suffixes. */
export function normalizeCompanyKey(company: string): string {
  const words = squash(company).split(" ").filter(Boolean);
  while (words.length > 0 && LEGAL_SUFFIXES.has(words[words.length - 1])) {
    words.pop();
  }
  return words.join(" ");
}

/** Trailing region or division words: "HSBC UK" and "Acme Holdings" are covered in news as "HSBC" and "Acme". */
const DIVISION_WORDS = new Set([
  "uk", "us", "usa", "europe", "emea", "apac", "asia", "americas", "india",
  "group", "holdings", "holding", "international", "global", "worldwide",
]);
/** A brand shorter than this is too generic to match on its own, so the full name is kept. */
const MIN_BRAND_LENGTH = 4;

/** The parent brand as written: trailing division, region and legal words removed ("HSBC UK" → "HSBC"). */
export function brandName(company: string): string {
  const full = company.replace(/"/g, "").trim();
  const tokens = full.split(/\s+/).filter(Boolean);
  while (tokens.length > 1) {
    const last = squash(tokens[tokens.length - 1]);
    if (!DIVISION_WORDS.has(last) && !LEGAL_SUFFIXES.has(last)) break;
    tokens.pop();
  }
  const brand = tokens.join(" ").replace(/[,;.\s]+$/, "");
  return squash(brand).replace(/ /g, "").length >= MIN_BRAND_LENGTH ? brand : full;
}

/** Normalized names a result may mention: the full company name, and its parent brand when different. */
function companyMatchKeys(company: string): string[] {
  return [...new Set([normalizeCompanyKey(company), normalizeCompanyKey(brandName(company))])].filter(Boolean);
}

const PLACEHOLDER_KEYS = new Set(PLACEHOLDER_NAMES.map(squash));

/** True when the company is unknown or a generic stand-in, so live research makes no sense. */
export function isPlaceholderCompany(company: string, uncertainFields?: string[]): boolean {
  if (uncertainFields?.includes("company")) return true;
  const trimmed = (company ?? "").trim();
  if (!trimmed) return true;
  if (PLACEHOLDER_KEYS.has(normalizeCompanyKey(trimmed))) return true;
  return /\bunknown\b/.test(squash(trimmed));
}

/**
 * Two search queries about the company only: recent news on the parent brand (where coverage is), and the regulatory
 * and risk situation of the named entity. The person's job title is deliberately left out: it makes search engines
 * return individuals' profiles.
 */
export function buildQueries(input: ResearchInput): string[] {
  const company = input.company.replace(/"/g, "").trim();
  return [`"${brandName(company)}" news`, `"${company}" regulation compliance risk`];
}

class HttpStatusError extends Error {
  status: number;

  constructor(status: number) {
    super(`HTTP ${status}`);
    this.name = "HttpStatusError";
    this.status = status;
  }
}

/** Returns the URL only if it is http(s). */
function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Dedupe key: host without "www.", path without trailing slash, plus query. */
function dedupeKey(url: URL): string {
  const host = url.hostname.replace(/^www\./, "");
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${host}${pathname}${url.search}`;
}

/** Cuts long text at a word boundary and appends an ellipsis, staying within MAX_SNIPPET. */
function truncateSnippet(text: string): string {
  if (text.length <= MAX_SNIPPET) return text;
  const cut = text.slice(0, MAX_SNIPPET - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

/** Validates raw Tavily results, keeps only company mentions on http(s) URLs, dedupes, sorts and caps. */
function toFindings(raw: unknown[], company: string): ResearchFinding[] {
  const matchKeys = companyMatchKeys(company);
  if (matchKeys.length === 0) return [];

  const candidates: { finding: ResearchFinding; score: number; key: string }[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const url = typeof entry.url === "string" ? parseHttpUrl(entry.url) : null;
    if (!url || isExcludedResult(url)) continue;

    const title = collapse(typeof entry.title === "string" ? entry.title : "");
    const content = collapse(typeof entry.content === "string" ? entry.content : "");
    // Whole-word match on the full name or parent brand, so "Apex" doesn't match "Apexology" or "Bapex"
    const text = ` ${squash(`${title} ${content}`)} `;
    if (!matchKeys.some((key) => text.includes(` ${key} `))) continue;

    const finding: ResearchFinding = {
      title: title || url.hostname,
      url: url.href,
      source: url.hostname.replace(/^www\./, ""),
      snippet: truncateSnippet(content),
    };
    if (typeof entry.published_date === "string" && entry.published_date.trim()) {
      finding.published_date = entry.published_date.trim();
    }
    const score = typeof entry.score === "number" && Number.isFinite(entry.score) ? entry.score : 0;
    candidates.push({ finding, score, key: dedupeKey(url) });
  }

  candidates.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const findings: ResearchFinding[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.key)) continue;
    seen.add(candidate.key);
    findings.push(candidate.finding);
    if (findings.length >= MAX_FINDINGS) break;
  }
  return findings;
}

/** Runs one Tavily search with its own timeout. Rejects on network error, timeout, non-2xx or invalid JSON. */
async function runSearch(
  query: string,
  topic: "news" | "general",
  apiKey: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<unknown[]> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("timeout"));
    }, timeoutMs);
  });

  const work = (async () => {
    const res = await fetchImpl(TAVILY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        topic,
        search_depth: "basic",
        max_results: RESULTS_PER_QUERY,
        include_answer: false,
        // Bare domains only (Tavily takes domains, not paths); paths are filtered in toFindings
        exclude_domains: EXCLUDED_DOMAINS.filter((d) => !d.includes("/")),
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new HttpStatusError(res.status);
    const data: unknown = await res.json();
    const results = data && typeof data === "object" ? (data as Record<string, unknown>).results : undefined;
    if (!Array.isArray(results)) throw new Error("Invalid Tavily response");
    return results;
  })();

  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Short description of a failure for logs. Never includes the API key. */
function describeError(error: unknown): string {
  if (error instanceof HttpStatusError) return `HTTP ${error.status}`;
  if (error instanceof Error) return error.name;
  return "unknown error";
}

/** Reads the recorded Tavily response used by replay mode. */
function readReplayResults(): unknown[] {
  const text = fs.readFileSync(path.resolve(process.cwd(), FIXTURE_PATH), "utf8");
  const data: unknown = JSON.parse(text);
  const results = data && typeof data === "object" ? (data as Record<string, unknown>).results : undefined;
  if (!Array.isArray(results)) throw new Error("Replay fixture has no results array");
  return results;
}

function resultFromRaw(queries: string[], raw: unknown[], company: string): ResearchResult {
  const findings = toFindings(raw, company);
  if (findings.length === 0) {
    return { status: "ok", reason: NO_COVERAGE_REASON, queries, findings };
  }
  return { status: "ok", queries, findings };
}

/** Looks up recent public coverage of a company on Tavily. Never throws. */
export async function researchCompany(input: ResearchInput, opts: ResearchOptions): Promise<ResearchResult> {
  try {
    const apiKey = (opts.apiKey || "").trim();
    if (!apiKey) return { status: "not_configured", queries: [], findings: [] };
    if (isPlaceholderCompany(input.company, input.uncertainFields)) {
      return { status: "skipped", reason: SKIPPED_REASON, queries: [], findings: [] };
    }

    const queries = buildQueries(input);

    if (opts.mode === "replay") {
      return resultFromRaw(queries, readReplayResults(), input.company);
    }

    const fetchImpl = opts.fetchImpl ?? fetch;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const settled = await Promise.allSettled([
      runSearch(queries[0], "news", apiKey, fetchImpl, timeoutMs),
      runSearch(queries[1], "general", apiKey, fetchImpl, timeoutMs),
    ]);

    const raw: unknown[] = [];
    const failures: unknown[] = [];
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") raw.push(...outcome.value);
      else failures.push(outcome.reason);
    }

    for (const failure of failures) {
      console.warn(`Tavily research request failed: ${describeError(failure)}`);
    }

    if (failures.length === settled.length) {
      const limited = failures.every(
        (failure) => failure instanceof HttpStatusError && (failure.status === 429 || failure.status === 432),
      );
      return {
        status: "unavailable",
        reason: limited ? LIMIT_REASON : UNAVAILABLE_REASON,
        queries,
        findings: [],
      };
    }

    return resultFromRaw(queries, raw, input.company);
  } catch (error) {
    console.warn(`Tavily research failed unexpectedly: ${describeError(error)}`);
    return { status: "unavailable", reason: UNAVAILABLE_REASON, queries: [], findings: [] };
  }
}
