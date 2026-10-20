/** Shared by the middleware (edge runtime) and /api/access, so it uses Web Crypto only. */
export const ACCESS_COOKIE = "hotseat_access";
export const ACCESS_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

/** The cookie holds a hash of the access code, never the code itself. */
export async function accessToken(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`hotseat-access-v1:${code}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Only same-origin paths are allowed as the destination after entering the code (no open redirect). */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
