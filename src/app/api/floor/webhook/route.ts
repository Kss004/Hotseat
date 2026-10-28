import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rateLimit";
import { checkWebhookToken } from "@/lib/floor/auth";
import { ingestExecutionById, processJobs } from "@/lib/floor/service";

export const maxDuration = 300;

/**
 * Bolna posts execution updates here (agent and batch webhooks). Bolna doesn't sign webhooks, so the body is used
 * only for the execution id: the record is re-fetched from Bolna's API with our key before anything is stored.
 * When a call completes, its scoring runs right here, inside this request's time budget.
 */
export async function POST(req: Request) {
  try {
    await enforceRateLimit(req, "floor-webhook");
    if (!checkWebhookToken(new URL(req.url).searchParams.get("token"))) {
      return NextResponse.json({ code: "UNAUTHORIZED", message: "Bad webhook token" }, { status: 401 });
    }
    const body = (await req.json().catch(() => null)) as { id?: unknown; execution_id?: unknown } | null;
    const raw = typeof body?.id === "string" ? body.id : typeof body?.execution_id === "string" ? body.execution_id : null;
    // Batch-level webhooks carry no execution id; the reconciliation sweep picks those calls up
    if (!raw || !/^[0-9a-f-]{16,64}$/i.test(raw)) return NextResponse.json({ ok: true, ignored: true });

    const callId = await ingestExecutionById(raw);
    if (callId) await processJobs({ budgetMs: 270_000, onlyRefId: callId });
    return NextResponse.json({ ok: true, call_id: callId });
  } catch (err) {
    const e = toErrorResponse(err);
    return NextResponse.json(e.body, { status: e.status });
  }
}
