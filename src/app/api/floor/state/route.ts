import { managerRoute } from "@/lib/floor/http";
import { getSettings, listReps, nextMorningSlot } from "@/lib/floor/service";
import { buildDashboard, listRuns } from "@/lib/floor/dashboard";
import { missingBolnaConfig } from "@/lib/floor/bolna";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Everything the manager screen shows. "week" covers the last 7 runs that produced a scored call. */
export const GET = managerRoute(async () => {
  const runs = await listRuns(14);
  const scoredRunIds = runs.filter((r) => r.counts.scored > 0).slice(0, 7).map((r) => r.id);
  const settings = await getSettings();
  const env = getEnv();
  return {
    settings: { ...settings, bolna_agent_id: settings.bolna_agent_id ? "set" : "" },
    config: {
      missing: missingBolnaConfig(),
      call_hour_ist: env.FLOOR_CALL_HOUR_IST,
      max_call_seconds: env.FLOOR_MAX_CALL_SECONDS,
      next_morning: nextMorningSlot().toISOString(),
    },
    reps: await listReps(),
    runs,
    dashboard: {
      latest: await buildDashboard(scoredRunIds.slice(0, 1)),
      week: await buildDashboard(scoredRunIds),
    },
  };
});
