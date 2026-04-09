import { AnatomyLabels, AnatomyPicker, QuestionMode } from "@spreadsheet/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, authedProcedure, publicProcedure, router } from "../init.js";

export const groupsRouter = router({
  create: publicProcedure
    .input(
      z.object({
        encrypted: z.boolean(),
        questionMode: QuestionMode,
        showTiming: z.boolean(),
        anatomyLabels: AnatomyLabels.nullable(),
        anatomyPicker: AnatomyPicker.nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.groups.create(input);
    }),

  setupAdmin: publicProcedure
    .input(
      z.object({
        adminToken: z.string(),
        name: z.string().min(1),
        anatomy: z.string().nullable(),
        partners: z.array(
          z.object({
            name: z.string().min(1),
            anatomy: z.string().nullable(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.groups.setupAdmin(input.adminToken, {
        name: input.name,
        anatomy: input.anatomy,
        partners: input.partners,
      });

      if ("error" in result) {
        switch (result.error) {
          case "not_found":
            throw new TRPCError({ code: "NOT_FOUND", message: "Invalid admin token" });
          case "already_setup":
            throw new TRPCError({ code: "BAD_REQUEST", message: "Group already set up" });
          case "anatomy_required":
            throw new TRPCError({ code: "BAD_REQUEST", message: "Anatomy required in admin-pick mode" });
        }
      }

      return { partnerTokens: result.partnerTokens };
    }),

  addPerson: adminProcedure
    .input(
      z.object({
        name: z.string().min(1),
        anatomy: z.string().nullable(),
        isAdmin: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.group.isReady) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Can't add people after group is marked ready" });
      }
      return ctx.groups.addPerson(ctx.group.id, input);
    }),

  setProfile: authedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        anatomy: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.groups.setProfile(ctx.person.id, input);
      return { ok: true };
    }),

  removePerson: adminProcedure.input(z.object({ personId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const result = await ctx.groups.removePerson(ctx.group.id, input.personId, ctx.person.id);

    if ("error" in result) {
      switch (result.error) {
        case "not_found":
          throw new TRPCError({ code: "NOT_FOUND", message: "Person not found in your group" });
        case "self_remove":
          throw new TRPCError({ code: "BAD_REQUEST", message: "Can't remove yourself" });
        case "has_entries":
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Can't remove a person who has submitted answers",
          });
      }
    }

    return { ok: true };
  }),

  status: publicProcedure.input(z.object({ token: z.string() })).query(async ({ ctx, input }) => {
    return ctx.groups.getStatus(input.token);
  }),

  markReady: adminProcedure.mutation(async ({ ctx }) => {
    if (ctx.group.isReady) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Group is already ready" });
    }
    await ctx.groups.markReady(ctx.group.id);
    return { ok: true };
  }),
});
