import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rateLimit";
import { evaluateSession } from "@/lib/pipeline";

// LLM calls (with failover and one repair retry) can outlast the default serverless timeout.
export const maxDuration = 180;
// The evaluation is the largest output, so each call gets longer, but the chain must still end inside maxDuration
const ROUTE_BUDGET_MS = 160_000;
const EVAL_CALL_TIMEOUT_MS = 75_000;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const routeStart = Date.now();
  try {
    await enforceRateLimit(req, "evaluate");
    const result = await evaluateSession(params.id, {
      budgetMs: ROUTE_BUDGET_MS - (Date.now() - routeStart),
      callTimeoutMs: EVAL_CALL_TIMEOUT_MS,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const errResp = toErrorResponse(err);
    return NextResponse.json(errResp.body, { status: errResp.status });
  }
}
