import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rateLimit";
import { generateScenarios } from "@/lib/pipeline";

// LLM calls (with failover and one repair retry) can outlast the default serverless timeout.
export const maxDuration = 120;
// The AI failover chain must finish inside maxDuration (after research) so a slow provider ends in LLM_UNAVAILABLE, not a platform 504
const ROUTE_BUDGET_MS = 100_000;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const routeStart = Date.now();
  try {
    await enforceRateLimit(req, "scenarios");
    const result = await generateScenarios(params.id, ROUTE_BUDGET_MS - (Date.now() - routeStart));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const errResp = toErrorResponse(err);
    return NextResponse.json(errResp.body, { status: errResp.status });
  }
}
