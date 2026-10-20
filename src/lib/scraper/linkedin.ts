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

const FALLBACK = "Couldn't read this profile. Paste the About and Experience text instead.";
const MAX_REDIRECTS = 2;

function isLinkedInHost(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return url.protocol === "https:" && (host === "linkedin.com" || host.endsWith(".linkedin.com"));
}

function isAuthWall(url: URL, html: string): boolean {
  if (/\/(authwall|login|checkpoint|signup|uas\/login)/i.test(url.pathname)) return true;
  // Real profiles are titled "Name - Headline | LinkedIn"; the wall is titled "Sign Up | LinkedIn" / "LinkedIn Login"
  const title = (html.match(/<title>([^<]*)<\/title>/i)?.[1] || "").trim();
  return /^(sign up|sign in|log ?in|join linkedin|linkedin login)\b/i.test(title);
}

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Reads a <meta> content value regardless of attribute order or quote style. */
function readMeta(html: string, attr: "property" | "name", key: string): string {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  // Keys are fixed literals like "og:description"; only "." needs escaping
  const escapedKey = key.replace(/\./g, "[.]");
  const keyPattern = new RegExp(String.raw`${attr}\s*=\s*(["'])${escapedKey}\1`, "i");
  for (const tag of tags) {
    if (!keyPattern.test(tag)) continue;
    const content = tag.match(/content\s*=\s*(["'])([\s\S]*?)\1/i);
    if (content) return decodeEntities(content[2]).trim();
  }
  return "";
}

/**
 * Best-effort, logged-out read of a public LinkedIn profile's OpenGraph/meta tags.
 * LinkedIn usually serves a sign-in wall or blocks automated requests, so callers must treat
 * failure as the normal case and fall back to pasted text. Redirects are followed manually,
 * at most twice, and only to https *.linkedin.com hosts (SSRF guard).
 */
export async function scrapeLinkedInMetadata(inputUrl: string): Promise<LinkedInScrapeResult> {
  const validation = validateLinkedInUrl(inputUrl);
  if (!validation.isValid || !validation.parsedUrl) {
    return { ok: false, reason: validation.error || "Invalid LinkedIn URL" };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    let url = validation.parsedUrl;
    let res: Response | null = null;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      res = await fetch(url.toString(), {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "manual",
        signal: controller.signal,
      });

      if (res.status < 300 || res.status >= 400) break;
      const location = res.headers.get("location");
      if (!location) break;
      const next = new URL(location, url);
      if (!isLinkedInHost(next)) {
        return { ok: false, reason: FALLBACK };
      }
      if (isAuthWall(next, "")) {
        return { ok: false, reason: "LinkedIn requires sign-in to view this profile. Paste the About and Experience text instead." };
      }
      url = next;
    }

    if (!res) return { ok: false, reason: FALLBACK };
    if (res.status === 999 || res.status === 429) {
      return { ok: false, reason: "LinkedIn blocked the automated request. Paste the About and Experience text instead." };
    }
    if (!res.ok) return { ok: false, reason: FALLBACK };

    const html = await res.text();
    if (isAuthWall(url, html)) {
      return { ok: false, reason: "LinkedIn requires sign-in to view this profile. Paste the About and Experience text instead." };
    }

    const title =
      readMeta(html, "property", "og:title") || decodeEntities(html.match(/<title>([^<]+)<\/title>/i)?.[1] || "").trim();
    const description = readMeta(html, "property", "og:description") || readMeta(html, "name", "description");
    const combined = [title, description].filter((part) => part.length > 0).join("\n\n");

    if (description.length < 20) {
      return { ok: false, reason: FALLBACK };
    }
    return { ok: true, text: combined };
  } catch {
    return { ok: false, reason: FALLBACK };
  } finally {
    clearTimeout(timeoutId);
  }
}
