import { publicProcedure, router } from "../init.js";

export const questionsRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.questions.list();
  }),
});
