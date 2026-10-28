import { managerRoute } from "@/lib/floor/http";
import { tick } from "@/lib/floor/service";

// Preparing a call takes up to ~3 minutes of AI time and scoring up to ~2.5, so a tick runs near the platform limit
export const maxDuration = 300;

/** The manager screen calls this while work is pending, one tick at a time. */
export const POST = managerRoute(async () => tick(280_000));
