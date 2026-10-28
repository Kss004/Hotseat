import { NextResponse } from "next/server";
import type { z } from "zod";
import { AppError, toErrorResponse } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rateLimit";
import { requireManager } from "./auth";

type Handler<P> = (req: Request, ctx: { params: P }) => Promise<unknown>;

/** Manager-only JSON route: rate limit, login check, then the handler; errors become the usual { code, message }. */
export function managerRoute<P = Record<string, never>>(handler: Handler<P>) {
  return async (req: Request, ctx: { params: P }) => {
    try {
      await enforceRateLimit(req, "floor");
      requireManager(req);
      const body = await handler(req, ctx);
      return NextResponse.json({ ok: true, ...(body as object) });
    } catch (err) {
      const e = toErrorResponse(err);
      return NextResponse.json(e.body, { status: e.status });
    }
  };
}

/** Parses a request body with a Zod schema, throwing VALIDATION with readable messages. */
export function parseBody<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new AppError(
      "VALIDATION",
      parsed.error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message).join("; "),
      400
    );
  }
  return parsed.data;
}
