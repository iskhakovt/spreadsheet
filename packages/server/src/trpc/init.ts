import { initTRPC, TRPCError } from "@trpc/server";
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
