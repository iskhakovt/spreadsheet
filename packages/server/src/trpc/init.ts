import { initTRPC, TRPCError } from "@trpc/server";
import { emitGroupUpdate } from "../events.js";
import type { TrpcContext } from "./context.js";

const t = initTRPC.context<TrpcContext>().create();

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;

const loggingMiddleware = t.middleware(async ({ ctx, path, type, next }) => {
  const start = performance.now();
  const result = await next();
  const durationMs = Math.round(performance.now() - start);
  if (result.ok) {
    ctx.logger.debug({ trpcPath: path, trpcType: type, durationMs }, "trpc ok");
  } else {
    ctx.logger.warn({ trpcPath: path, trpcType: type, durationMs, code: result.error.code }, "trpc error");
  }
  return result;
});

export const publicProcedure = t.procedure.use(loggingMiddleware);

export const authedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.person || !ctx.group || !ctx.personToken) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid or missing person token" });
  }
  return next({
    ctx: { ...ctx, person: ctx.person, group: ctx.group, personToken: ctx.personToken },
  });
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
