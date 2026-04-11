import { type Logger, pino } from "pino";
import { describe, expect, it } from "vitest";
import { redactPaths } from "./logger.js";

// Build a pino instance using the EXACT redact config the production logger
// uses, but write to an in-memory stream so the test can inspect each record.
function captureLogger(): { logger: Logger; records: Array<Record<string, unknown>> } {
  const records: Array<Record<string, unknown>> = [];
  const logger = pino(
    {
      level: "trace",
      redact: { paths: redactPaths, censor: "[REDACTED]" },
    },
    {
      write(line: string) {
        records.push(JSON.parse(line));
      },
    },
  );
  return { logger, records };
}

const REDACTED = "[REDACTED]";

describe("logger redact paths", () => {
  describe("request headers (deep paths)", () => {
    it("redacts req.headers['x-person-token']", () => {
      const { logger, records } = captureLogger();
      logger.info({ req: { headers: { "x-person-token": "secret" } } }, "test");
      expect((records[0].req as { headers: Record<string, unknown> }).headers["x-person-token"]).toBe(REDACTED);
    });

    it("redacts req.headers.authorization", () => {
      const { logger, records } = captureLogger();
      logger.info({ req: { headers: { authorization: "Bearer secret" } } }, "test");
      expect((records[0].req as { headers: Record<string, unknown> }).headers.authorization).toBe(REDACTED);
    });

    it("redacts req.headers.cookie", () => {
      const { logger, records } = captureLogger();
      logger.info({ req: { headers: { cookie: "session=secret" } } }, "test");
      expect((records[0].req as { headers: Record<string, unknown> }).headers.cookie).toBe(REDACTED);
    });

    it("redacts req.headers.host", () => {
      const { logger, records } = captureLogger();
      logger.info({ req: { headers: { host: "internal.example" } } }, "test");
      expect((records[0].req as { headers: Record<string, unknown> }).headers.host).toBe(REDACTED);
    });
  });

  describe("sensitive keys at the root of a logged object", () => {
    it("redacts adminToken", () => {
      const { logger, records } = captureLogger();
      logger.info({ adminToken: "secret-admin-token" }, "test");
      expect(records[0].adminToken).toBe(REDACTED);
    });

    it("redacts partnerTokens", () => {
      const { logger, records } = captureLogger();
      logger.info({ partnerTokens: ["a", "b", "c"] }, "test");
      expect(records[0].partnerTokens).toBe(REDACTED);
    });

    it("redacts token", () => {
      const { logger, records } = captureLogger();
      logger.info({ token: "secret-person-token" }, "test");
      expect(records[0].token).toBe(REDACTED);
    });

    it("redacts password", () => {
      const { logger, records } = captureLogger();
      logger.info({ password: "hunter2" }, "test");
      expect(records[0].password).toBe(REDACTED);
    });
  });

  describe("sensitive keys one level deep", () => {
    it("redacts user.adminToken", () => {
      const { logger, records } = captureLogger();
      logger.info({ user: { adminToken: "secret" } }, "test");
      expect((records[0].user as Record<string, unknown>).adminToken).toBe(REDACTED);
    });

    it("redacts user.partnerTokens", () => {
      const { logger, records } = captureLogger();
      logger.info({ user: { partnerTokens: ["a"] } }, "test");
      expect((records[0].user as Record<string, unknown>).partnerTokens).toBe(REDACTED);
    });

    it("redacts ctx.token", () => {
      const { logger, records } = captureLogger();
      logger.info({ ctx: { token: "secret" } }, "test");
      expect((records[0].ctx as Record<string, unknown>).token).toBe(REDACTED);
    });

    it("redacts user.password", () => {
      const { logger, records } = captureLogger();
      logger.info({ user: { password: "hunter2" } }, "test");
      expect((records[0].user as Record<string, unknown>).password).toBe(REDACTED);
    });
  });

  describe("non-sensitive fields are NOT redacted", () => {
    it("preserves common log fields", () => {
      const { logger, records } = captureLogger();
      logger.info(
        { method: "GET", path: "/api/trpc/groups.create", status: 200, durationMs: 12, reqId: "abc-123" },
        "request",
      );
      expect(records[0].method).toBe("GET");
      expect(records[0].path).toBe("/api/trpc/groups.create");
      expect(records[0].status).toBe(200);
      expect(records[0].durationMs).toBe(12);
      expect(records[0].reqId).toBe("abc-123");
      expect(records[0].msg).toBe("request");
    });
  });

  describe("known limitation", () => {
    it("does NOT redact tokens nested deeper than one level", () => {
      // Pino's `*` wildcard is single-level. `*.token` matches `{ a: { token } }`
      // but NOT `{ a: { b: { token } } }`. This test pins the limitation so a
      // future reader knows the contract — DO NOT log nested objects with
      // sensitive fields below depth 1. If we ever start, add explicit deeper
      // paths or sanitize at the call site.
      const { logger, records } = captureLogger();
      logger.info({ a: { b: { token: "leaks" } } }, "test");
      expect(((records[0].a as Record<string, unknown>).b as Record<string, unknown>).token).toBe("leaks");
    });
  });
});
