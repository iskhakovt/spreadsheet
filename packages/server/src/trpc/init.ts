import { initTRPC, TRPCError } from "@trpc/server";
import { emitGroupUpdate } from "../events.js";
import type { TrpcContext } from "./context.js";

const t = initTRPC.context<TrpcContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.person || !ctx.group) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid or missing person token" });
  }
  return next({ ctx: { ...ctx, person: ctx.person, group: ctx.group } });
});

export const adminProcedure = authedProcedure.use(({ ctx, next }) => {
  if (!ctx.person.isAdmin) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next({ ctx });
});

/**
 * Wraps {@link authedProcedure} with a side-effect that broadcasts a group
 * update event after a successful mutation. Subscribers to `groups.onStatus`
 * fetch fresh status when the event fires. The broadcast is fire-and-forget;
 * failures must not affect the HTTP response.
 */
export const broadcastingProcedure = authedProcedure.use(async ({ ctx, next }) => {
  const result = await next();
  if (result.ok) emitGroupUpdate(ctx.group.id);
  return result;
});

/** Same as {@link broadcastingProcedure} but requires admin. */
export const broadcastingAdminProcedure = adminProcedure.use(async ({ ctx, next }) => {
  const result = await next();
  if (result.ok) emitGroupUpdate(ctx.group.id);
  return result;
});
