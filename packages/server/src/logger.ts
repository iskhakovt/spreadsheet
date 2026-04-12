import { type Logger, type LoggerOptions, pino } from "pino";

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

// Allowlist-only error serializer. Extracts the fields we want in logs and
// drops everything else — crucially, any custom enumerable properties the
// thrower may have attached (tokens, nested `params`, headers) are discarded
// so they can never reach the transport. Exported for tests.
export function sanitizeError(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== "object") return { message: String(err) };
  const e = err as Error & { code?: unknown; status?: unknown };
  const out: Record<string, unknown> = {
    name: typeof e.name === "string" ? e.name : "Error",
    message: typeof e.message === "string" ? e.message : "",
  };
  if (typeof e.stack === "string") out.stack = e.stack;
  if (typeof e.code === "string" || typeof e.code === "number") out.code = e.code;
  if (typeof e.status === "number") out.status = e.status;
  return out;
}

const baseOptions: LoggerOptions = {
  name: "spreadsheet-server",
  level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
  base: { version, env },
  redact: {
    paths: redactPaths,
    censor: "[REDACTED]",
  },
  // Allowlist-based `err` serializer. Pino's stdSerializers.err copies every
  // enumerable own property of an Error verbatim, which slips past our
  // single-level redact list whenever a custom error subclass carries nested
  // `params` / `headers` / tokens. Keeping the serialized shape flat and
  // primitive-only means nothing nested can escape, regardless of what the
  // thrower attached. Applies to every `{ err }` call site — defense in depth.
  serializers: {
    err: sanitizeError,
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
