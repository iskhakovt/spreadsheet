import { initTRPC, TRPCError } from "@trpc/server";
import { emitGroupUpdate } from "../events.js";
import { sseConnectionsGauge } from "../metrics.js";
import type { TrpcContext } from "./context.js";

const t = initTRPC.context<TrpcContext>().create({
  sse: {
    // Server pings every 30s to keep proxies/load-balancers from idle-timing
    // out the response stream. Mirrors the previous WS keepAlive cadence.
    ping: { enabled: true, intervalMs: 30_000 },
    // Client gives up and reconnects if no message (including ping) arrives
    // within this window. Set just above intervalMs so a single missed ping
    // triggers reconnect rather than tolerating a long silent stream.
    client: { reconnectAfterInactivityMs: 35_000 },
  },
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;

const loggingMiddleware = t.middleware(async ({ ctx, path, type, next }) => {
  const start = performance.now();
  const result = await next();
  const durationMs = Math.round(performance.now() - start);
  if (result.ok) {
    ctx.logger.debug({ trpcPath: path, trpcType: type, durationMs }, "trpc ok");
  } else {
    ctx.logger.warn(
      {
        trpcPath: path,
        trpcType: type,
        durationMs,
        code: result.error.code,
        message: result.error.message,
      },
      "trpc error",
    );
  }
  return result;
});

/**
 * Bumps `sse_connections_active{procedure}` for every open subscription stream.
 *
 * Two decrement paths so the gauge always returns to zero:
 *   • `signal.addEventListener("abort", ...)` — fires the moment the request's
 *     AbortSignal trips (client disconnect, page close, server shutdown). This
 *     does NOT depend on the caller draining the iterator, so the gauge
 *     decrements even if the consumer simply abandons the stream.
 *   • `try/finally` around `yield* original` — covers natural completion,
 *     i.e. the inner generator returning on its own (e.g. `maxDurationMs`
 *     elapsed or the resolver explicitly returns).
 *
 * Both paths route through the same `dec()` closure with an idempotency guard
 * so we never double-decrement. Queries and mutations fall through unchanged.
 *
 * Already-aborted-on-entry: if the request was cancelled during the resolver's
 * setup work, the signal is already `aborted` by the time we get here. We skip
 * instrumenting in that case — the outer transport may short-circuit without
 * ever iterating our wrapped iterable, which would leave both the listener
 * (registered for a FUTURE event that already fired) and `try/finally` (never
 * entered) silent and the gauge leaked. Pass through the unwrapped iterable.
 */
const sseTrackingMiddleware = t.middleware(async ({ type, path, signal, next }) => {
  if (type !== "subscription") return next();
  const result = await next();
  if (!result.ok) return result;
  if (signal?.aborted) return result;

  sseConnectionsGauge.inc({ procedure: path });
  let decremented = false;
  const dec = () => {
    if (decremented) return;
    decremented = true;
    sseConnectionsGauge.dec({ procedure: path });
  };
  signal?.addEventListener("abort", dec, { once: true });

  const original = result.data as AsyncIterable<unknown>;
  async function* tracked() {
    try {
      yield* original;
    } finally {
      dec();
    }
  }
  return { ...result, data: tracked() };
});

export const publicProcedure = t.procedure.use(loggingMiddleware).use(sseTrackingMiddleware);

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
