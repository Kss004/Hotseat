import { describe, it, expect, vi, afterEach } from "vitest";
import { validateLinkedInUrl, scrapeLinkedInMetadata } from "@/lib/scraper/linkedin";

describe("LinkedIn URL Validation & SSRF Guard", () => {
  it("accepts valid LinkedIn profile URLs", () => {
    const valid1 = validateLinkedInUrl("https://www.linkedin.com/in/marcus-vance");
    expect(valid1.isValid).toBe(true);

    const valid2 = validateLinkedInUrl("https://linkedin.com/in/janedoe-risk-123/");
    expect(valid2.isValid).toBe(true);
  });

  it("rejects non-https URLs", () => {
    const res = validateLinkedInUrl("http://www.linkedin.com/in/marcus-vance");
    expect(res.isValid).toBe(false);
    expect(res.error).toContain("https");
  });

  it("rejects SSRF attempts with private or external hosts", () => {
    const localhost = validateLinkedInUrl("https://localhost/in/admin");
    expect(localhost.isValid).toBe(false);

    const internalIp = validateLinkedInUrl("https://169.254.169.254/in/secrets");
    expect(internalIp.isValid).toBe(false);

    const evilHost = validateLinkedInUrl("https://evil-phishing.com/in/marcus");
    expect(evilHost.isValid).toBe(false);
  });

  it("rejects non-profile LinkedIn paths", () => {
    const companyPage = validateLinkedInUrl("https://www.linkedin.com/company/apex-financial");
    expect(companyPage.isValid).toBe(false);
    expect(companyPage.error).toContain("/in/");

    const feed = validateLinkedInUrl("https://www.linkedin.com/feed/");
    expect(feed.isValid).toBe(false);
  });
});

describe("scrapeLinkedInMetadata (fetch stubbed)", () => {
  const respond = (status: number, body = "", headers: Record<string, string> = {}) =>
    new Response(status >= 300 && status < 400 ? null : body, { status, headers });

  afterEach(() => vi.unstubAllGlobals());

  it("parses og tags in either attribute order, with apostrophes and entities", async () => {
    const html = `<html><head><title>x</title>
      <meta content="Siobhán O'Brien - CISO - Apex | LinkedIn" property="og:title">
      <meta property='og:description' content='Security leader &amp; former auditor with 15 years in banking risk.'>
      </head></html>`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(200, html)));
    const res = await scrapeLinkedInMetadata("https://www.linkedin.com/in/siobhan");
    expect(res.ok).toBe(true);
    expect(res.text).toContain("O'Brien");
    expect(res.text).toContain("Security leader & former auditor");
  });

  it("reports the sign-in wall when LinkedIn redirects to /authwall", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(302, "", { location: "https://www.linkedin.com/authwall?trk=x" })));
    const res = await scrapeLinkedInMetadata("https://www.linkedin.com/in/someone");
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/sign-in/i);
  });

  it("never follows a redirect to a non-LinkedIn host", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(302, "", { location: "http://169.254.169.254/latest/meta-data" }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await scrapeLinkedInMetadata("https://www.linkedin.com/in/someone");
    expect(res.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports LinkedIn's 999 bot block", async () => {
    // Response() refuses status 999, but LinkedIn really sends it, so stub a minimal response object
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 999, ok: false, headers: new Headers(), text: async () => "" }));
    const res = await scrapeLinkedInMetadata("https://www.linkedin.com/in/someone");
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/blocked/i);
  });
});
