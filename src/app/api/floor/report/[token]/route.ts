import { NextResponse } from "next/server";
import { AppError, toErrorResponse } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rateLimit";
import { verifyReportToken } from "@/lib/floor/auth";
import { getCallReport } from "@/lib/floor/dashboard";

export const dynamic = "force-dynamic";

/** A rep's own report, opened with the signed link the manager shares. */
export async function GET(req: Request, { params }: { params: { token: string } }) {
  try {
    await enforceRateLimit(req, "read");
    const callId = verifyReportToken(decodeURIComponent(params.token));
    if (!callId) throw new AppError("NOT_FOUND", "This report link is not valid", 404);
    return NextResponse.json({ ok: true, report: await getCallReport(callId) });
  } catch (err) {
    const e = toErrorResponse(err);
    return NextResponse.json(e.body, { status: e.status });
  }
}
