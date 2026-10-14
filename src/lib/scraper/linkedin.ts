export interface LinkedInScrapeResult {
  ok: boolean;
  text?: string;
  reason?: string;
}

export function validateLinkedInUrl(inputUrl: string): { isValid: boolean; parsedUrl?: URL; error?: string } {
  try {
    const parsed = new URL(inputUrl.trim());
    
    // Protocol must be https:
    if (parsed.protocol !== "https:") {
      return { isValid: false, error: "URL must use https protocol" };
    }

    // Host must be linkedin.com or www.linkedin.com (disallow internal IPs, localhost, SSRF)
    const host = parsed.hostname.toLowerCase();
    if (host !== "linkedin.com" && host !== "www.linkedin.com") {
      return { isValid: false, error: "Only linkedin.com or www.linkedin.com is permitted" };
    }

    // Path must start with /in/
    if (!parsed.pathname.startsWith("/in/")) {
      return { isValid: false, error: "URL must be a LinkedIn profile path starting with /in/" };
    }

    return { isValid: true, parsedUrl: parsed };
  } catch {
    return { isValid: false, error: "Invalid URL format" };
  }
}

export async function scrapeLinkedInMetadata(inputUrl: string): Promise<LinkedInScrapeResult> {
  const validation = validateLinkedInUrl(inputUrl);
  if (!validation.isValid || !validation.parsedUrl) {
    return {
      ok: false,
      reason: validation.error || "Invalid LinkedIn URL",
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

  try {
    const res = await fetch(validation.parsedUrl.toString(), {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "error", // Do not follow redirects to arbitrary third-party hosts (SSRF rule)
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      return {
        ok: false,
        reason: "Couldn't read this profile. Paste the text instead.",
      };
    }

    const html = await res.text();

    // Extract OpenGraph tags and title
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
    const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
    const metaDescMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);

    const title = ogTitleMatch?.[1] || titleMatch?.[1] || "";
    const description = ogDescMatch?.[1] || metaDescMatch?.[1] || "";

    const combined = [title, description].filter((s) => s.trim().length > 0).join("\n\n");

    if (combined.length < 20) {
      return {
        ok: false,
        reason: "Couldn't read this profile. Paste the text instead.",
      };
    }

    return {
      ok: true,
      text: combined,
    };
  } catch {
    clearTimeout(timeoutId);
    return {
      ok: false,
      reason: "Couldn't read this profile. Paste the text instead.",
    };
  }
}
