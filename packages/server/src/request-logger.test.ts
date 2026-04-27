import { Hono } from "hono";
import { type Logger, pino } from "pino";
import { describe, expect, it } from "vitest";
import { type HonoLoggerEnv, sanitizeError } from "./logger.js";
import { requestLogger, sanitizePath } from "./request-logger.js";

function captureLogger(): { logger: Logger; records: Array<Record<string, unknown>> } {
  const records: Array<Record<string, unknown>> = [];
  const logger = pino(
    {
      level: "trace",
      formatters: { level: (label: string) => ({ level: label }) },
      serializers: { err: sanitizeError },
    },
    {
      write(line: string) {
        records.push(JSON.parse(line));
      },
    },
  );
  return { logger, records };
}

describe("sanitizePath", () => {
  // Per-person tokens and pre-setup admin tokens share the same `/p/:token`
  // URL shape (`setupAdmin` reuses the admin token as the admin's person
  // token), so one regex covers both.
  it("redacts the token segment of /p/:token", () => {
    expect(sanitizePath("/p/abc123def456ghi789")).toBe("/p/[REDACTED]");
  });

  it("preserves trailing path segments after the token", () => {
    expect(sanitizePath("/p/abc123/results")).toBe("/p/[REDACTED]/results");
    expect(sanitizePath("/p/abc123/questions/oral")).toBe("/p/[REDACTED]/questions/oral");
  });

  it("does not touch the API path (auth travels via X-Session-Key + cookie, not in the URL)", () => {
    expect(sanitizePath("/api/trpc/groups.create")).toBe("/api/trpc/groups.create");
    expect(sanitizePath("/api/trpc/sync.push")).toBe("/api/trpc/sync.push");
    expect(sanitizePath("/api/trpc-ws")).toBe("/api/trpc-ws");
  });

  it("does not touch the health endpoint", () => {
    expect(sanitizePath("/health")).toBe("/health");
  });

  it("does not touch static asset paths", () => {
    expect(sanitizePath("/assets/index-abc.js")).toBe("/assets/index-abc.js");
    expect(sanitizePath("/assets/index-COlosdta.css")).toBe("/assets/index-COlosdta.css");
    expect(sanitizePath("/favicon.svg")).toBe("/favicon.svg");
    expect(sanitizePath("/sw.js")).toBe("/sw.js");
    expect(sanitizePath("/manifest.webmanifest")).toBe("/manifest.webmanifest");
  });

  it("does not touch the root", () => {
    expect(sanitizePath("/")).toBe("/");
  });

  it("does not touch /p with no token segment", () => {
    expect(sanitizePath("/p")).toBe("/p");
    expect(sanitizePath("/p/")).toBe("/p/");
  });

  it("does not touch unrelated /p* prefixes", () => {
    expect(sanitizePath("/pages/about")).toBe("/pages/about");
    expect(sanitizePath("/policy")).toBe("/policy");
    expect(sanitizePath("/people/list")).toBe("/people/list");
  });
});

describe("requestLogger middleware", () => {
  function makeApp(rootLogger: Logger) {
    const app = new Hono<HonoLoggerEnv>();
    app.use("*", requestLogger(rootLogger));
    // Explicit onError so the throw test doesn't depend on Hono's default
    // behavior. Hono's compose still sets `c.error` before invoking onError
    // (compose.js:25), so the middleware sees the error either way; this just
    // pins the response shape.
    app.onError((_err, c) => c.text("error", 500));
    return app;
  }

  it("emits a single request log with method, sanitized path, status, durationMs, reqId", async () => {
    const { logger, records } = captureLogger();
    const app = makeApp(logger);
    app.get("/p/:token", (c) => c.text("hello"));

    const res = await app.fetch(new Request("http://localhost/p/super-secret-token-value"));
    expect(res.status).toBe(200);

    expect(records).toHaveLength(1);
    const entry = records[0];
    expect(entry.msg).toBe("request");
    expect(entry.method).toBe("GET");
    expect(entry.path).toBe("/p/[REDACTED]");
    expect(entry.status).toBe(200);
    expect(entry.level).toBe("info");
    expect(typeof entry.durationMs).toBe("number");
    expect(typeof entry.reqId).toBe("string");
  });

  it("never lets the raw token appear anywhere in the emitted log entry", async () => {
    const { logger, records } = captureLogger();
    const app = makeApp(logger);
    app.get("/p/:token", (c) => c.text("hello"));

    await app.fetch(new Request("http://localhost/p/leaky-token-value-1234"));

    expect(JSON.stringify(records[0])).not.toContain("leaky-token-value-1234");
  });

  it("logs at warn for 4xx", async () => {
    const { logger, records } = captureLogger();
    const app = makeApp(logger);
    app.get("/missing", (c) => c.text("nope", 404));

    await app.fetch(new Request("http://localhost/missing"));

    expect(records[0].status).toBe(404);
    expect(records[0].level).toBe("warn");
  });

  it("logs at error for 5xx", async () => {
    const { logger, records } = captureLogger();
    const app = makeApp(logger);
    app.get("/boom", (c) => c.text("oops", 500));

    await app.fetch(new Request("http://localhost/boom"));

    expect(records[0].status).toBe(500);
    expect(records[0].level).toBe("error");
  });

  it("logs an err field when the downstream handler throws", async () => {
    const { logger, records } = captureLogger();
    const app = makeApp(logger);
    app.get("/throw", () => {
      throw new Error("kaboom");
    });

    // Hono's compose catches handler throws via the default onError, sets
    // `c.error`, and serves a 500 response. The middleware should still
    // record the failure and surface the error message.
    const res = await app.fetch(new Request("http://localhost/throw"));
    expect(res.status).toBe(500);

    expect(records).toHaveLength(1);
    const entry = records[0];
    expect(entry.status).toBe(500);
    expect(entry.level).toBe("error");
    expect(entry.err).toMatchObject({ name: "Error", message: "kaboom" });
  });

  it("strips custom enumerable fields from thrown errors (no nested leak past single-level redact)", async () => {
    const { logger, records } = captureLogger();
    const app = makeApp(logger);
    app.get("/throw", () => {
      const err = new Error("boom") as Error & { token?: string; params?: Record<string, unknown> };
      err.token = "secret-token-abc";
      err.params = { nested: "nested-secret" };
      throw err;
    });

    await app.fetch(new Request("http://localhost/throw"));

    const serialized = JSON.stringify(records[0]);
    expect(serialized).not.toContain("secret-token-abc");
    expect(serialized).not.toContain("nested-secret");
    expect(records[0].err).toMatchObject({ name: "Error", message: "boom" });
  });

  it("attaches a child logger and reqId to the Hono context", async () => {
    const { logger } = captureLogger();
    const app = makeApp(logger);
    // Wrap in an object so TS doesn't narrow `captured` to `null` after the
    // initializer (closure assignments aren't tracked across function bounds).
    const seen: { logger: unknown; reqId: unknown } = { logger: undefined, reqId: undefined };
    app.get("/", (c) => {
      seen.logger = c.var.logger;
      seen.reqId = c.var.reqId;
      return c.text("ok");
    });

    await app.fetch(new Request("http://localhost/"));

    expect(seen.logger).toBeDefined();
    expect(typeof seen.reqId).toBe("string");
  });

  it("does not log /health (skipped to avoid drowning prod logs in liveness probes)", async () => {
    const { logger, records } = captureLogger();
    const app = makeApp(logger);
    app.get("/health", (c) => c.json({ status: "ok" }));

    const res = await app.fetch(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    expect(records).toHaveLength(0);
  });

  it("gives each request a distinct reqId", async () => {
    const { logger, records } = captureLogger();
    const app = makeApp(logger);
    app.get("/", (c) => c.text("ok"));

    await app.fetch(new Request("http://localhost/"));
    await app.fetch(new Request("http://localhost/"));

    expect(records).toHaveLength(2);
    expect(records[0].reqId).not.toBe(records[1].reqId);
  });
});
