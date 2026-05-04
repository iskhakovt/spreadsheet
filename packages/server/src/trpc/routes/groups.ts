import { on } from "node:events";
import { AnatomyLabels, AnatomyPicker, groupStatusSchema, QuestionMode } from "@spreadsheet/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { groupEventName, groupEvents } from "../../events.js";
import { groupsCreatedCounter, groupsSetupCompletedCounter } from "../../metrics.js";
import {
  authedProcedure,
  broadcastingAdminProcedure,
  broadcastingProcedure,
  publicProcedure,
  router,
} from "../init.js";

export const groupsRouter = router({
  create: publicProcedure
    .input(
      z.object({
        encrypted: z.boolean(),
        questionMode: QuestionMode,
        anatomyLabels: AnatomyLabels.nullable(),
        anatomyPicker: AnatomyPicker.nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (process.env.REQUIRE_ENCRYPTION !== "false" && !input.encrypted) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Encryption is required" });
      }
      const result = await ctx.groups.create(input);
      groupsCreatedCounter.inc();
      return result;
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

      groupsSetupCompletedCounter.inc();
      return { partnerTokens: result.partnerTokens };
    }),

  addPerson: broadcastingAdminProcedure
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

  setProfile: broadcastingProcedure
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

  removePerson: broadcastingAdminProcedure
    .input(z.object({ personId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
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

  status: publicProcedure.output(groupStatusSchema.nullable()).query(async ({ ctx }) => {
    // Pre-setup admin tokens have no person row but are still recoverable
    // as ctx.personToken (createContext sets it whenever the named cookie
    // resolves to a value). getStatus handles both the person-token and
    // admin-token cases.
    if (!ctx.personToken) return null;
    return ctx.groups.getStatus(ctx.personToken);
  }),

  markReady: broadcastingAdminProcedure.mutation(async ({ ctx }) => {
    if (ctx.group.isReady) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Group is already ready" });
    }
    await ctx.groups.markReady(ctx.group.id);
    return { ok: true };
  }),

  /**
   * Real-time per-person status. Yields the current state immediately, then
   * yields again whenever any mutation in the group emits via {@link groupEvents}.
   * Each subscriber gets a personalized payload (their own `person` field).
   *
   * Authed — the client gates this subscription on `status.person` being
   * non-null (see `useGroupStatus`), so it's never opened during the brief
   * pre-`setupAdmin` window where the URL holds an admin token but no person
   * record exists yet.
   *
   * The event listener is registered BEFORE the initial yield so events that
   * fire between the initial state fetch and the consumer's next pull are
   * queued and delivered (not lost). Cleanup is automatic via `signal`.
   */
  onStatus: authedProcedure.subscription(async function* ({ ctx, signal }) {
    // Register the listener first so any broadcasts fired while we fetch the
    // initial state are queued internally (not lost).
    const eventIterator = on(groupEvents, groupEventName(ctx.group.id), { signal });

    const initial = await ctx.groups.getStatus(ctx.personToken);
    if (initial) yield initial;

    for await (const _evt of eventIterator) {
      const next = await ctx.groups.getStatus(ctx.personToken);
      if (next) yield next;
    }
  }),
});
