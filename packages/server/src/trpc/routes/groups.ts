import { on } from "node:events";
import {
  type Anatomy,
  AnatomyLabels,
  AnatomyPicker,
  groupStatusSchema,
  type KeyCheck,
  QuestionMode,
  sealed,
} from "@spreadsheet/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { groupEventName, groupEvents } from "../../events.js";
import { groupsCreatedCounter, groupsSetupCompletedCounter, trackSseConnection } from "../../metrics.js";
import { encryptionMismatchError } from "../errors.js";
import {
  adminProcedure,
  authedProcedure,
  broadcastingAdminProcedure,
  broadcastingProcedure,
  publicProcedure,
  router,
} from "../init.js";

/**
 * A person's sealed profile fields. The schema checks the `p:N:` / `e:N:`
 * format; the store checks the mode against the group's `encrypted` flag.
 */
const sealedProfile = z.object({
  name: sealed<string>(),
  anatomy: sealed<Anatomy>().nullable(),
});

export const groupsRouter = router({
  create: publicProcedure
    .input(
      z.object({
        encrypted: z.boolean(),
        questionMode: QuestionMode,
        anatomyLabels: AnatomyLabels.nullable(),
        anatomyPicker: AnatomyPicker.nullable(),
        keyCheck: sealed<KeyCheck>().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (process.env.REQUIRE_ENCRYPTION !== "false" && !input.encrypted) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Encryption is required" });
      }
      const result = await ctx.groups.create(input);
      if ("error" in result) throw encryptionMismatchError();
      groupsCreatedCounter.inc();
      return result;
    }),

  /**
   * Give an older encrypted group its key check. Admins only, since a key
   * check under the wrong key would lock every member out; the client sends
   * one only once its key is proven (design/sync.md § Key verification).
   */
  fillKeyCheck: adminProcedure.input(z.object({ keyCheck: sealed<KeyCheck>() })).mutation(async ({ ctx, input }) => {
    const result = await ctx.groups.fillKeyCheck(ctx.group.id, input.keyCheck, ctx.group.encrypted);
    if ("error" in result) throw encryptionMismatchError();
    return result;
  }),

  setupAdmin: publicProcedure
    .input(
      sealedProfile.extend({
        adminToken: z.string(),
        partners: z.array(sealedProfile),
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
          case "encryption_mismatch":
            throw encryptionMismatchError();
        }
      }

      groupsSetupCompletedCounter.inc();
      return { partnerTokens: result.partnerTokens };
    }),

  addPerson: broadcastingAdminProcedure
    .input(sealedProfile.extend({ isAdmin: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.group.isReady) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Can't add people after group is marked ready" });
      }
      const result = await ctx.groups.addPerson(ctx.group.id, input, ctx.group.encrypted);
      if ("error" in result) throw encryptionMismatchError();
      return result;
    }),

  setProfile: broadcastingProcedure.input(sealedProfile).mutation(async ({ ctx, input }) => {
    const result = await ctx.groups.setProfile(ctx.person.id, input, ctx.group.encrypted);
    if ("error" in result) throw encryptionMismatchError();
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
    trackSseConnection("groups.onStatus", signal);
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
