import { decodeOpaque } from "@spreadsheet/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { authedProcedure, broadcastingProcedure, router } from "../init.js";

export const syncRouter = router({
  // Stays as authedProcedure (no broadcast): push happens every 3s per active
  // user, progress is cosmetic, and the polling fallback covers waiting screens.
  push: authedProcedure
    .input(
      z.object({
        stoken: z.string().nullable(),
        operations: z.array(z.string()),
        progress: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      for (const op of input.operations) {
        try {
          decodeOpaque(op);
        } catch {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid operation format" });
        }
      }

      return ctx.sync.push(ctx.person.id, input);
    }),

  markComplete: broadcastingProcedure.mutation(async ({ ctx }) => {
    await ctx.sync.markComplete(ctx.person.id);
    return { ok: true };
  }),

  unmarkComplete: broadcastingProcedure.mutation(async ({ ctx }) => {
    await ctx.sync.unmarkComplete(ctx.person.id);
    return { ok: true };
  }),

  journal: authedProcedure
    .input(z.object({ sinceId: z.number().int().nonnegative().nullable() }).optional())
    .query(async ({ ctx, input }) => {
      const result = await ctx.sync.journalSince(ctx.group.id, input?.sinceId ?? null);
      if ("error" in result) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "All group members must mark complete before viewing journal",
        });
      }
      return result;
    }),
});
