import { type Logger, type LoggerOptions, pino } from "pino";

const isProduction = process.env.NODE_ENV === "production";
const version = process.env.VERSION ?? "dev";
const env = process.env.NODE_ENV ?? "development";

const baseOptions: LoggerOptions = {
  name: "spreadsheet-server",
  level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
  base: { version, env },
  redact: {
    paths: [
      'req.headers["x-person-token"]',
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers.host",
      "*.adminToken",
      "*.partnerTokens",
      "*.token",
      "*.password",
    ],
    censor: "[REDACTED]",
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

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

export function createSilentLogger(): Logger {
  return pino({ level: "silent" });
}

export type HonoLoggerEnv = {
  Variables: {
    logger: Logger;
    reqId: string;
  };
};
