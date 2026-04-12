import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema.js";

/** Driver-agnostic database type — works with postgres.js and PGlite */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Transaction handle from db.transaction(). Stores use this exclusively via #tx. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createDatabase(url: string): Database {
  const client = postgres(url);
  // biome-ignore lint/suspicious/noExplicitAny: drizzle returns a driver-specific type
  return drizzle(client, { schema }) as any;
}

// CWD-relative because import.meta.dirname changes after bundling (tsup
// flattens to dist/, so the dev-time ../../migrations path won't exist).
// All callers run from the package root: Docker (WORKDIR /app), local dev
// (pnpm --filter sets CWD), integration tests (cwd: serverDir in execSync).
export async function runMigrations(db: Database) {
  // biome-ignore lint/suspicious/noExplicitAny: migrate expects driver-specific db type
  await migrate(db as any, { migrationsFolder: "./migrations" });
}
