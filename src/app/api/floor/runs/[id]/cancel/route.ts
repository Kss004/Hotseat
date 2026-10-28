import { managerRoute } from "@/lib/floor/http";
import { cancelRun } from "@/lib/floor/service";

export const POST = managerRoute<{ id: string }>(async (_req, { params }) => {
  await cancelRun(params.id);
  return {};
});
