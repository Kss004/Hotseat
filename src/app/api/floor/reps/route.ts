import { managerRoute, parseBody } from "@/lib/floor/http";
import { addRep, repInputSchema } from "@/lib/floor/service";

export const POST = managerRoute(async (req) => {
  const rep = await addRep(parseBody(repInputSchema, await req.json()));
  return { rep };
});
