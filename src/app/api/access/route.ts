import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { AppError, toErrorResponse } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rateLimit";
import { ACCESS_COOKIE, ACCESS_COOKIE_MAX_AGE, accessToken } from "@/lib/access";

const accessBodySchema = z.object({
  code: z.string().trim().min(1, "Enter the access code").max(200, "Access code is too long"),
});

export async function POST(req: Request) {
  try {
    await enforceRateLimit(req, "access");

    const expected = getEnv().ACCESS_CODE;
    if (!expected) return NextResponse.json({ ok: true });

    const body = accessBodySchema.safeParse(await req.json().catch(() => null));
    if (!body.success) {
      throw new AppError("VALIDATION", body.error.issues[0]?.message || "Invalid request body", 400);
    }

    const [given, wanted] = await Promise.all([accessToken(body.data.code), accessToken(expected)]);
    if (!timingSafeEqual(Buffer.from(given), Buffer.from(wanted))) {
      throw new AppError("ACCESS_REQUIRED", "That access code is not correct.", 401);
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set(ACCESS_COOKIE, wanted, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: ACCESS_COOKIE_MAX_AGE,
    });
    return res;
  } catch (err) {
    const errResp = toErrorResponse(err);
    return NextResponse.json(errResp.body, { status: errResp.status });
  }
}
