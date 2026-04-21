import { z } from "zod";
import { resultsViewedCounter } from "../../metrics.js";
import { authedProcedure, router } from "../init.js";

export const analyticsRouter = router({
  track: authedProcedure.input(z.object({ event: z.enum(["results_viewed"]) })).mutation(() => {
    resultsViewedCounter.inc();
    return { ok: true };
  }),
});
