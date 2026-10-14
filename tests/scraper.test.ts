import { describe, it, expect } from "vitest";
import { validateLinkedInUrl } from "@/lib/scraper/linkedin";

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
