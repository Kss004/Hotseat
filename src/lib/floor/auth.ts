import { createHmac, timingSafeEqual } from "crypto";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";

export const MANAGER_COOKIE = "hotseat_floor";
const SESSION_SECONDS = 12 * 60 * 60;

function secret(): string {
  const env = getEnv();
  if (!env.APP_SECRET || env.APP_SECRET.length < 16) {
    throw new AppError("NOT_CONFIGURED", "APP_SECRET must be set (16+ characters) to use Hotseat Floor.", 503);
  }
  return env.APP_SECRET;
}

function sign(purpose: string, value: string): string {
  return createHmac("sha256", secret()).update(`${purpose}:${value}`).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Constant-time password check. An unset MANAGER_PASSWORD means nobody can log in. */
export function checkManagerPassword(password: string): boolean {
  const expected = getEnv().MANAGER_PASSWORD;
  if (!expected) {
    throw new AppError("NOT_CONFIGURED", "MANAGER_PASSWORD must be set to use Hotseat Floor.", 503);
  }
  // Compare HMACs so the comparison takes the same time whatever the lengths
  return safeEqual(sign("pw", password), sign("pw", expected));
}

export function createManagerCookieValue(now = Date.now()): string {
  const expires = Math.floor(now / 1000) + SESSION_SECONDS;
  return `${expires}.${sign("mgr", String(expires))}`;
}

export function managerCookieHeader(value: string, maxAge = SESSION_SECONDS): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${MANAGER_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

export function isManager(req: Request): boolean {
  const value = readCookie(req, MANAGER_COOKIE);
  if (!value) return false;
  const [expires, sig] = value.split(".");
  if (!expires || !sig || !/^\d+$/.test(expires)) return false;
  if (Number(expires) < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(sig, sign("mgr", expires));
}

export function requireManager(req: Request): void {
  if (!isManager(req)) throw new AppError("UNAUTHORIZED", "Please log in as the floor manager.", 401);
}

/** Rep report links: the call id plus a signature, so a rep can open only their own report. */
export function createReportToken(callId: string): string {
  return `${callId}.${sign("report", callId)}`;
}

export function verifyReportToken(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const callId = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  return safeEqual(sig, sign("report", callId)) ? callId : null;
}

/** Webhook: shared secret in the URL. The payload itself is never trusted; the execution is re-fetched from Bolna. */
export function checkWebhookToken(token: string | null): boolean {
  const expected = getEnv().BOLNA_WEBHOOK_SECRET;
  if (!expected || !token) return false;
  return safeEqual(token, expected);
}

/** Vercel Cron sends Authorization: Bearer <CRON_SECRET>. */
export function checkCronAuth(req: Request): boolean {
  const expected = getEnv().CRON_SECRET;
  const header = req.headers.get("authorization") || "";
  return !!expected && safeEqual(header, `Bearer ${expected}`);
}
