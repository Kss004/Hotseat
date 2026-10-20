import { describe, it, expect, vi, afterEach } from "vitest";
import {
  researchCompany,
  buildQueries,
  brandName,
  normalizeCompanyKey,
  isPlaceholderCompany,
  type ResearchInput,
} from "@/lib/research/tavily";

const TAVILY_URL = "https://api.tavily.com/search";
const KEY = "tvly-test-key";
const input: ResearchInput = {
  company: "Apex Financial Capital",
  title: "VP of Compliance and Risk",
  product: "Managed SOC",
};

const LIMIT_REASON = "Live research limit reached for now.";
const UNAVAILABLE_REASON = "Live research is unavailable right now.";

function okResponse(results: unknown[]): Response {
  return new Response(JSON.stringify({ query: "q", results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body));
}

/** Mock fetch that answers each request based on the topic in its body. */
function fetchByTopic(responders: Record<"news" | "general", () => Promise<Response>>) {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const topic = bodyOf(init).topic as "news" | "general";
    return responders[topic]();
  });
}

function asFetch(mock: unknown): typeof fetch {
  return mock as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("researchCompany guards", () => {
  it("returns not_configured for an empty key without calling fetch", async () => {
    const fetchImpl = vi.fn();
    const result = await researchCompany(input, { apiKey: "", fetchImpl: asFetch(fetchImpl) });
    expect(result).toEqual({ status: "not_configured", queries: [], findings: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("skips placeholder companies without calling fetch", async () => {
    const fetchImpl = vi.fn();
    const unknown = await researchCompany(
      { ...input, company: "EdTech Startup (name unknown)" },
      { apiKey: KEY, fetchImpl: asFetch(fetchImpl) },
    );
    expect(unknown).toEqual({
      status: "skipped",
      reason: "The company name isn't known, so live research was skipped.",
      queries: [],
      findings: [],
    });

    const guessed = await researchCompany(
      { ...input, uncertainFields: ["company"] },
      { apiKey: KEY, fetchImpl: asFetch(fetchImpl) },
    );
    expect(guessed.status).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("researchCompany live requests", () => {
  it("issues both Tavily requests in parallel with the expected body and headers", async () => {
    const pending: Array<(response: Response) => void> = [];
    const fetchImpl = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          pending.push(resolve);
        }),
    );

    const promise = researchCompany(input, { apiKey: KEY, fetchImpl: asFetch(fetchImpl) });
    // Both calls must be in flight before either response resolves.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    pending[0](okResponse([]));
    pending[1](okResponse([]));
    const result = await promise;
    expect(result.status).toBe("ok");

    const calls = fetchImpl.mock.calls.map(([url, init]) => ({ url: String(url), init: init as RequestInit }));
    for (const call of calls) {
      expect(call.url).toBe(TAVILY_URL);
      expect(call.init.method).toBe("POST");
      expect((call.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
      expect((call.init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    }
    expect(bodyOf(calls[0].init)).toMatchObject({
      query: `"Apex Financial Capital" news`,
      topic: "news",
      search_depth: "basic",
      max_results: 4,
    });
    expect(bodyOf(calls[1].init)).toMatchObject({
      query: `"Apex Financial Capital" regulation compliance risk`,
      topic: "general",
      search_depth: "basic",
      max_results: 4,
    });
    expect(result.queries).toEqual([
      `"Apex Financial Capital" news`,
      `"Apex Financial Capital" regulation compliance risk`,
    ]);
  });

  it("filters, dedupes, trims snippets, caps at 5 and sorts by score", async () => {
    const long = "Apex Financial Capital " + "expanded its wealth platform across regions. ".repeat(12);
    const news = [
      {
        title: "Apex Financial Capital faces audit finding",
        url: "https://example-news.com/apex-audit",
        content: "Apex Financial Capital disclosed a material weakness.   \n\n It is remediating controls.",
        score: 0.7,
      },
      {
        title: "Fintech roundup",
        url: "https://example-blog.com/roundup",
        content: "Many firms reported gains this quarter.",
        score: 0.99,
      },
      {
        title: "Apex Financial Capital partner note",
        url: "ftp://example.com/partner",
        content: "Apex Financial Capital shared a partner note.",
        score: 0.95,
      },
      {
        title: "Apex Financial Capital audit finding (syndicated)",
        url: "https://www.example-news.com/apex-audit/",
        content: "Apex Financial Capital disclosed a material weakness.",
        score: 0.5,
      },
    ];
    const general = [
      {
        title: "Apex Financial Capital expands",
        url: "https://example-business.net/apex-expansion",
        content: long,
        score: 0.9,
      },
      ...[0.3, 0.25, 0.2, 0.15, 0.1].map((score, i) => ({
        title: `Apex Financial Capital item ${i}`,
        url: `https://example-business.net/item-${i}`,
        content: "Apex Financial Capital coverage.",
        score,
      })),
    ];
    const fetchImpl = fetchByTopic({
      news: () => Promise.resolve(okResponse(news)),
      general: () => Promise.resolve(okResponse(general)),
    });

    const result = await researchCompany(input, { apiKey: KEY, fetchImpl: asFetch(fetchImpl) });

    expect(result.status).toBe("ok");
    expect(result.findings).toHaveLength(5);
    expect(result.findings.map((f) => f.url)).toEqual([
      "https://example-business.net/apex-expansion",
      "https://example-news.com/apex-audit",
      "https://example-business.net/item-0",
      "https://example-business.net/item-1",
      "https://example-business.net/item-2",
    ]);
    expect(result.findings.some((f) => f.url.includes("roundup"))).toBe(false);
    expect(result.findings.some((f) => f.url.startsWith("ftp"))).toBe(false);
    expect(result.findings.filter((f) => f.url.includes("apex-audit"))).toHaveLength(1);

    const audit = result.findings[1];
    expect(audit.source).toBe("example-news.com");
    expect(audit.snippet).toBe("Apex Financial Capital disclosed a material weakness. It is remediating controls.");

    const expanded = result.findings[0];
    expect(expanded.snippet.length).toBeLessThanOrEqual(400);
    expect(expanded.snippet.endsWith("…")).toBe(true);
  });
});

describe("researchCompany partial and failed requests", () => {
  it("matches the company as whole words, not inside other names", async () => {
    const company: ResearchInput = { company: "Apex", title: "CFO", product: "x" };
    const results = [
      { title: "Apex reports record quarter", url: "https://news.example.com/a", content: "Apex grew 20%.", score: 0.9 },
      { title: "Apexology raises funding", url: "https://news.example.com/b", content: "Apexology is a startup.", score: 0.8 },
      { title: "Bapex ships v2", url: "https://news.example.com/c", content: "Bapex released a product.", score: 0.7 },
    ];
    const fetchImpl = fetchByTopic({
      news: () => Promise.resolve(okResponse(results)),
      general: () => Promise.resolve(okResponse([])),
    });

    const result = await researchCompany(company, { apiKey: KEY, fetchImpl: asFetch(fetchImpl) });

    expect(result.findings.map((f) => f.url)).toEqual(["https://news.example.com/a"]);
  });

  it("uses the successful request when the other one returns 500", async () => {
    const good = {
      title: "Apex Financial Capital expands",
      url: "https://example-business.net/apex-expansion",
      content: "Apex Financial Capital opened a new office.",
      score: 0.8,
    };
    const fetchImpl = fetchByTopic({
      news: () => Promise.resolve(new Response("server error", { status: 500 })),
      general: () => Promise.resolve(okResponse([good])),
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await researchCompany(input, { apiKey: KEY, fetchImpl: asFetch(fetchImpl) });

    expect(result.status).toBe("ok");
    expect(result.findings.map((f) => f.url)).toEqual([good.url]);
  });

  it("reports the limit reason when both requests return 429", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = fetchByTopic({
      news: () => Promise.resolve(new Response("", { status: 429 })),
      general: () => Promise.resolve(new Response("", { status: 429 })),
    });
    const result = await researchCompany(input, { apiKey: KEY, fetchImpl: asFetch(fetchImpl) });
    expect(result).toEqual({ status: "unavailable", reason: LIMIT_REASON, queries: result.queries, findings: [] });
  });

  it("reports the limit reason for a mix of 429 and 432", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = fetchByTopic({
      news: () => Promise.resolve(new Response("", { status: 432 })),
      general: () => Promise.resolve(new Response("", { status: 429 })),
    });
    const result = await researchCompany(input, { apiKey: KEY, fetchImpl: asFetch(fetchImpl) });
    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe(LIMIT_REASON);
  });

  it("reports unavailable when both requests return 500", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = fetchByTopic({
      news: () => Promise.resolve(new Response("", { status: 500 })),
      general: () => Promise.resolve(new Response("", { status: 500 })),
    });
    const result = await researchCompany(input, { apiKey: KEY, fetchImpl: asFetch(fetchImpl) });
    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe(UNAVAILABLE_REASON);
  });

  it("reports unavailable when both requests reject with a network error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = fetchByTopic({
      news: () => Promise.reject(new TypeError("fetch failed")),
      general: () => Promise.reject(new TypeError("fetch failed")),
    });
    const result = await researchCompany(input, { apiKey: KEY, fetchImpl: asFetch(fetchImpl) });
    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe(UNAVAILABLE_REASON);
  });

  it("reports unavailable when both responses are invalid JSON", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = fetchByTopic({
      news: () => Promise.resolve(new Response("<html>not json</html>", { status: 200 })),
      general: () => Promise.resolve(new Response("<html>not json</html>", { status: 200 })),
    });
    const result = await researchCompany(input, { apiKey: KEY, fetchImpl: asFetch(fetchImpl) });
    expect(result.status).toBe("unavailable");
  });

  it("reports unavailable when requests never finish and the timeout aborts them", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    const result = await researchCompany(input, {
      apiKey: KEY,
      fetchImpl: asFetch(fetchImpl),
      timeoutMs: 50,
    });
    expect(result.status).toBe("unavailable");
    expect(result.reason).toBe(UNAVAILABLE_REASON);
  });
});

describe("researchCompany replay mode", () => {
  it("reads the fixture without network and returns the four matching findings", async () => {
    const fetchImpl = vi.fn();
    const result = await researchCompany(input, {
      apiKey: KEY,
      mode: "replay",
      fetchImpl: asFetch(fetchImpl),
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.status).toBe("ok");
    expect(result.findings.map((f) => f.url)).toEqual([
      "https://example-news.com/2026/apex-financial-capital-sox-weakness",
      "https://example-business.net/apex-financial-capital-cloud-migration",
      "https://example-trade-press.com/2026/07/regulator-fines-asset-managers",
      "https://example-jobs.io/listings/apex-financial-capital-head-third-party-risk",
    ]);
    expect(result.findings.some((f) => f.url.includes("nordic"))).toBe(false);
    expect(result.findings[0].published_date).toBe("2026-09-14");
  });
});

describe("helpers", () => {
  it("normalizeCompanyKey lowercases, strips punctuation and legal suffixes", () => {
    expect(normalizeCompanyKey("Apex Financial Capital, Inc.")).toBe("apex financial capital");
    expect(normalizeCompanyKey("  Acme   Ltd. ")).toBe("acme");
    expect(normalizeCompanyKey("Foo GmbH")).toBe("foo");
    expect(normalizeCompanyKey("Bar & Baz Co.")).toBe("bar baz");
  });

  it("isPlaceholderCompany flags unknown and generic names", () => {
    expect(isPlaceholderCompany("EdTech Startup (name unknown)")).toBe(true);
    expect(isPlaceholderCompany("N/A")).toBe(true);
    expect(isPlaceholderCompany("Stealth Inc.")).toBe(true);
    expect(isPlaceholderCompany("   ")).toBe(true);
    expect(isPlaceholderCompany("Acme Corp", ["company"])).toBe(true);
    expect(isPlaceholderCompany("Apex Financial Capital")).toBe(false);
  });

  it("buildQueries searches the company only, never the person's job title", () => {
    expect(buildQueries(input)).toEqual([
      `"Apex Financial Capital" news`,
      `"Apex Financial Capital" regulation compliance risk`,
    ]);
    expect(buildQueries({ ...input, title: "Chief Information Security Officer" })[1]).not.toMatch(/Officer|Security/);
  });

  it("brandName drops trailing region, division and legal words, but never below 4 characters", () => {
    expect(brandName("HSBC UK")).toBe("HSBC");
    expect(brandName("Acme Holdings Ltd.")).toBe("Acme");
    expect(brandName("Standard Chartered Group")).toBe("Standard Chartered");
    expect(brandName("Apex Financial Capital, Inc.")).toBe("Apex Financial Capital");
    expect(brandName("Barclays")).toBe("Barclays");
    // Too short to stand alone: keep the full name
    expect(brandName("BT Group")).toBe("BT Group");
    expect(brandName("UK")).toBe("UK");
  });

  it("matches articles that name only the parent brand, and searches news on the brand", async () => {
    const division: ResearchInput = { company: "HSBC UK", title: "CCO", product: "x" };
    const results = [
      { title: "HSBC fined over AML controls", url: "https://news.example.com/hsbc-fine", content: "HSBC was fined.", score: 0.9 },
      { title: "HSBC UK opens new branch", url: "https://news.example.com/hsbc-uk", content: "HSBC UK expands.", score: 0.8 },
      { title: "HSBCX token launches", url: "https://news.example.com/hsbcx", content: "HSBCX is a crypto token.", score: 0.7 },
    ];
    const fetchImpl = fetchByTopic({
      news: () => Promise.resolve(okResponse(results)),
      general: () => Promise.resolve(okResponse([])),
    });

    const result = await researchCompany(division, { apiKey: KEY, fetchImpl: asFetch(fetchImpl) });

    expect(result.findings.map((f) => f.url)).toEqual([
      "https://news.example.com/hsbc-fine",
      "https://news.example.com/hsbc-uk",
    ]);
    expect(result.queries).toEqual([`"HSBC" news`, `"HSBC UK" regulation compliance risk`]);
  });

  it("drops people profiles, social networks and job listings, and asks Tavily to exclude them", async () => {
    const results = [
      { title: "Apex Financial Capital faces regulator inquiry", url: "https://news.example.com/apex-inquiry", content: "Apex Financial Capital is under review.", score: 0.9 },
      { title: "Jane Doe - Head of Risk at Apex Financial Capital", url: "https://uk.linkedin.com/in/jane-doe", content: "Apex Financial Capital risk leader.", score: 0.8 },
      { title: "Director, Operational Risk at Apex Financial Capital", url: "https://search.jobs.apexfinancial.com/job/123", content: "Apex Financial Capital is hiring.", score: 0.7 },
      { title: "Apex Financial Capital careers", url: "https://apexfinancial.com/careers/risk", content: "Join Apex Financial Capital.", score: 0.6 },
      { title: "Apex Financial Capital trader leaves", url: "https://www.efinancialcareers.com/news/apex", content: "Apex Financial Capital news.", score: 0.5 },
      { title: "Apex Financial Capital team", url: "https://theorg.com/org/apex-financial-capital", content: "Apex Financial Capital org chart.", score: 0.4 },
    ];
    const fetchImpl = fetchByTopic({
      news: () => Promise.resolve(okResponse(results)),
      general: () => Promise.resolve(okResponse([])),
    });

    const result = await researchCompany(input, { apiKey: KEY, fetchImpl: asFetch(fetchImpl) });

    expect(result.findings.map((f) => f.url)).toEqual(["https://news.example.com/apex-inquiry"]);
    const excluded = bodyOf(fetchImpl.mock.calls[0][1] as RequestInit).exclude_domains as string[];
    expect(excluded).toEqual(expect.arrayContaining(["linkedin.com", "glassdoor.com", "efinancialcareers.com"]));
    expect(excluded.every((d) => !d.includes("/"))).toBe(true);
  });
});
