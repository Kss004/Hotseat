import { z } from "zod";
import { managerRoute, parseBody } from "@/lib/floor/http";
import { createRun } from "@/lib/floor/service";

/**
 * "now": prepare the calls, then the manager launches them (Bolna dials within minutes, 09:00-21:00 IST only).
 * "next_morning": prepare now and launch automatically for the next morning slot.
 */
export const POST = managerRoute(async (req) => {
  const body = parseBody(
    z.object({ when: z.enum(["now", "next_morning"]), rep_ids: z.array(z.string()).min(1).optional() }),
    await req.json()
  );
  const runId = await createRun({ when: body.when, repIds: body.rep_ids, autoLaunch: body.when === "next_morning" });
  return { run_id: runId };
});
