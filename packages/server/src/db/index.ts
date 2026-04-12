import { resolve } from "node:path";
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

// In dev (tsx), import.meta.dirname is src/db/ — two levels up is the package root.
// In production (bundled), all chunks are in dist/ — process.cwd() is the package root.
// Using process.cwd() works for both since we always run from the package root.
const MIGRATIONS_DIR = resolve(process.cwd(), "migrations");

export async function runMigrations(db: Database) {
  // biome-ignore lint/suspicious/noExplicitAny: migrate expects driver-specific db type
  await migrate(db as any, { migrationsFolder: MIGRATIONS_DIR });
}
