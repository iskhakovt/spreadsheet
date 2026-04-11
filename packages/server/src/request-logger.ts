import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { HonoLoggerEnv } from "./logger.js";

export function requestLogger(rootLogger: Logger): MiddlewareHandler<HonoLoggerEnv> {
  return async (c, next) => {
    const reqId = randomUUID();
    const child = rootLogger.child({ reqId });
    c.set("logger", child);
    c.set("reqId", reqId);

    const start = performance.now();
    await next();
    const durationMs = Math.round(performance.now() - start);

    const status = c.res.status;
    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    child[level]({ method: c.req.method, path: c.req.path, status, durationMs }, "request");
  };
}
