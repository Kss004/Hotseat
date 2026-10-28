import { z } from "zod";
import { managerRoute, parseBody } from "@/lib/floor/http";
import { deleteRep, setRepOptOut } from "@/lib/floor/service";

export const PATCH = managerRoute<{ id: string }>(async (req, { params }) => {
  const body = parseBody(
    z.object({ opted_out: z.boolean(), consent_note: z.string().trim().max(300).optional() }),
    await req.json()
  );
  await setRepOptOut(params.id, body.opted_out, body.consent_note);
  return {};
});

/** Deletes the rep with all their calls, transcripts and scores. */
export const DELETE = managerRoute<{ id: string }>(async (_req, { params }) => {
  await deleteRep(params.id);
  return {};
});
