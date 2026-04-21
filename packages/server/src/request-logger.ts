import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";
import type { HonoLoggerEnv } from "./logger.js";
import { httpRequestDuration } from "./metrics.js";

// Tokens appear in URL paths via the wouter `/p/:token` client route — the SPA
// fallback serves these on the server, so the raw path would otherwise leak
// the auth token to logs. Both per-person tokens and pre-setup admin tokens
// share this same URL shape.
export function sanitizePath(path: string): string {
  return path.replace(/^\/p\/[^/]+/, "/p/[REDACTED]");
}

export function requestLogger(rootLogger: Logger): MiddlewareHandler<HonoLoggerEnv> {
  return async (c, next) => {
    // Container orchestrators hit /health every few seconds — skip to avoid drowning the signal.
    if (c.req.path === "/health") return next();

    const reqId = randomUUID();
    const child = rootLogger.child({ reqId });
    c.set("logger", child);
    c.set("reqId", reqId);

    const start = performance.now();
    await next();
    const durationMs = Math.round(performance.now() - start);

    // Hono's compose catches handler throws, sets `c.error`, and routes the
    // error through the app's onError handler — `await next()` does NOT
    // rethrow. Inspect `c.error` to detect downstream failures.
    const status = c.res.status;
    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    const sanitizedPath = sanitizePath(c.req.path);
    const fields: Record<string, unknown> = {
      method: c.req.method,
      path: sanitizedPath,
      status,
      durationMs,
    };
    // `fields.err` runs through the logger's `sanitizeError` serializer
    // (logger.ts) — any custom properties on the Error are dropped there.
    if (c.error) fields.err = c.error;
    child[level](fields, "request");

    httpRequestDuration.observe(
      { method: c.req.method, path: sanitizedPath, status: String(status) },
      durationMs / 1000,
    );
  };
}
