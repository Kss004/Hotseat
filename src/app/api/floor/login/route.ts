import { NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse, AppError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rateLimit";
import { checkManagerPassword, createManagerCookieValue, managerCookieHeader } from "@/lib/floor/auth";
import { parseBody } from "@/lib/floor/http";

export async function POST(req: Request) {
  try {
    // The tight session-create bucket (10/hour per IP) doubles as login brute-force protection
    await enforceRateLimit(req, "session-create");
    const { password } = parseBody(z.object({ password: z.string().min(1).max(200) }), await req.json());
    if (!checkManagerPassword(password)) throw new AppError("UNAUTHORIZED", "Wrong password", 401);
    const res = NextResponse.json({ ok: true });
    res.headers.set("Set-Cookie", managerCookieHeader(createManagerCookieValue()));
    return res;
  } catch (err) {
    const e = toErrorResponse(err);
    return NextResponse.json(e.body, { status: e.status });
  }
}
