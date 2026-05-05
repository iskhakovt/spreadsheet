import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { logger } from "../logger.js";
import * as schema from "./schema.js";

// Postgres severity levels classified as chatter — gets routed to trace so
// LOG_LEVEL=info hides it. WARNING/ERROR/FATAL/PANIC fall through to warn.
// (ERROR+ also rejects the query promise, so it surfaces as a thrown error
// regardless of what we do here — onnotice is the chatter channel.)
const CHATTY_SEVERITIES = new Set(["DEBUG", "LOG", "INFO", "NOTICE"]);

// Driver-agnostic database type — covers postgres.js (prod/dev) and PGlite
// (tests). Each driver subclasses PgDatabase with its own HKT (the first type
// parameter), so we widen that slot to accept any concrete driver. Drizzle
// doesn't expose a uniform driver-agnostic type, see drizzle-team/drizzle-orm#1744.
// biome-ignore lint/suspicious/noExplicitAny: HKT slot is intentionally widened
export type Database = PgDatabase<any, typeof schema>;

/** Transaction handle from db.transaction(). Stores use this exclusively via #tx. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Drizzle handle paired with a close function for the underlying driver. */
export interface DatabaseHandle {
  db: Database;
  close: () => Promise<void>;
}

// Returns the drizzle handle plus a close function that ends the underlying
// postgres.js pool. One-shot commands (migrate/seed/setup) MUST call close
// before exit — otherwise postgres.js's idle TCP sockets keep the event loop
// alive and the process hangs. Long-running serve mode closes from its
// SIGTERM handler so in-flight queries drain gracefully before the orchestrator
// SIGKILLs. Mirrors createTestDatabase's shape.
export function createDatabase(url: string): DatabaseHandle {
  const client = postgres(url, {
    // postgres-js's default onnotice prints the raw notice object via
    // console.log, which bypasses pino and ignores LOG_LEVEL. Route through
    // our logger so it's structured + level-controlled. The dropped fields
    // (`file`, `line`, `routine`) are postgres source locations — useful for
    // debugging postgres itself, noise for us.
    onnotice: (notice) => {
      const fields = { code: notice.code, severity: notice.severity };
      const log = CHATTY_SEVERITIES.has(notice.severity ?? "") ? logger.trace : logger.warn;
      log.call(logger, fields, notice.message ?? "postgres notice");
    },
  });
  return {
    db: drizzle(client, { schema }),
    close: () => client.end(),
  };
}

// CWD-relative because import.meta.dirname changes after bundling (tsup
// flattens to dist/, so the dev-time ../../migrations path won't exist).
// All callers run from the package root: Docker (WORKDIR /app), local dev
// (pnpm --filter sets CWD), integration tests (cwd: serverDir in execSync).
export async function runMigrations(db: Database) {
  await migrate(db, { migrationsFolder: "./migrations" });
}
