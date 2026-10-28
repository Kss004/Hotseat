import { managerRoute } from "@/lib/floor/http";
import { rescoreCall } from "@/lib/floor/service";

export const POST = managerRoute<{ id: string }>(async (_req, { params }) => {
  await rescoreCall(params.id);
  return {};
});
