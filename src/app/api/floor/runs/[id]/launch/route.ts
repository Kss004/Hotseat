import { managerRoute } from "@/lib/floor/http";
import { launchRun } from "@/lib/floor/service";

export const maxDuration = 60;

export const POST = managerRoute<{ id: string }>(async (_req, { params }) => {
  await launchRun(params.id);
  return {};
});
