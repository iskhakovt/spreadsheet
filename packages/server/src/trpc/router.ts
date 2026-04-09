import { router } from "./init.js";
import { groupsRouter } from "./routes/groups.js";
import { questionsRouter } from "./routes/questions.js";
import { syncRouter } from "./routes/sync.js";

export const appRouter = router({
  groups: groupsRouter,
  questions: questionsRouter,
  sync: syncRouter,
});

export type AppRouter = typeof appRouter;
