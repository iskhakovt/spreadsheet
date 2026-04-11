import { type Logger, type LoggerOptions, pino, stdSerializers } from "pino";

const isProduction = process.env.NODE_ENV === "production";
const version = process.env.VERSION ?? "dev";
const env = process.env.NODE_ENV ?? "development";

// Pino's `*` wildcard is single-level only — `*.token` matches `{ x: { token } }`
// but NOT `{ token }` at the root, and NOT `{ a: { b: { token } } }` at depth 2.
// So for each sensitive key we list both the root form and the one-level-deep
// form. Anything nested deeper is by convention NOT logged — see logger.test.ts
// for the cases this list provably covers.
export const redactPaths = [
  // Request headers carrying credentials. `host` is intentionally NOT here
  // — it's the public-facing hostname the client sent and is useful for
  // debugging which vhost was hit.
  'req.headers["x-person-token"]',
  "req.headers.authorization",
  "req.headers.cookie",
  // Sensitive keys at root of a logged object
  "adminToken",
  "partnerTokens",
  "token",
  "password",
  // Same keys one level deep
  "*.adminToken",
  "*.partnerTokens",
  "*.token",
  "*.password",
];

const baseOptions: LoggerOptions = {
  name: "spreadsheet-server",
  level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
  base: { version, env },
  redact: {
    paths: redactPaths,
    censor: "[REDACTED]",
  },
  // Pino does not log enumerable properties of Error objects by default —
  // without this serializer, `logger.error({ err }, ...)` drops the message
  // and stack entirely.
  serializers: {
    err: stdSerializers.err,
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

// pino-pretty is a devDependency (per pino's official guidance — it pulls in
// chalk/dateformat that have no place in a prod image). The branch below
// gates on `isProduction` BEFORE constructing the transport target string,
// so the prod path never tries to require pino-pretty. The contract is:
// production deployments must run with NODE_ENV=production. The Dockerfile
// sets this, so the contract holds for our shipped build.
export const logger: Logger = isProduction
  ? pino(baseOptions)
  : pino({
      ...baseOptions,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss.l",
          ignore: "pid,hostname,name,version,env",
        },
      },
    });

// Shared no-op logger for tests. A singleton is fine — silent loggers have no
// state worth isolating, and reusing one instance saves ~150ms across the suite.
export const silentLogger: Logger = pino({ level: "silent" });

export interface HonoLoggerEnv {
  Variables: {
    logger: Logger;
    reqId: string;
  };
}
