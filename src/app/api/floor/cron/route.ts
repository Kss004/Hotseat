import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { checkCronAuth } from "@/lib/floor/auth";
import { ensureNextDailyRun, tick } from "@/lib/floor/service";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Vercel Cron, once a day: make sure the next morning's run exists, catch up with Bolna, and work the queue. */
export async function GET(req: Request) {
  try {
    if (!checkCronAuth(req)) {
      return NextResponse.json({ code: "UNAUTHORIZED", message: "Bad cron secret" }, { status: 401 });
    }
    const created = await ensureNextDailyRun();
    const result = await tick(270_000);
    return NextResponse.json({ ok: true, created_run: created, ...result });
  } catch (err) {
    const e = toErrorResponse(err);
    return NextResponse.json(e.body, { status: e.status });
  }
}
