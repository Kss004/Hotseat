import { managerRoute, parseBody } from "@/lib/floor/http";
import { saveSettings, settingsInputSchema } from "@/lib/floor/service";

export const PUT = managerRoute(async (req) => {
  await saveSettings(parseBody(settingsInputSchema, await req.json()));
  return {};
});
