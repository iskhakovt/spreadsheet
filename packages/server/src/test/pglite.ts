import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import type { Database } from "../db/index.js";
import * as schema from "../db/schema.js";

/**
 * Boot an in-memory PGlite instance with the full schema applied.
 * Returns the Drizzle db and a cleanup function.
 */
export async function createTestDatabase(): Promise<{
  db: Database;
  close: () => Promise<void>;
}> {
  const client = new PGlite();

  const rawDb = drizzle({ client, schema });

  // biome-ignore lint/suspicious/noExplicitAny: pushSchema expects PgDatabase<any>
  const { apply } = await pushSchema(schema, rawDb as any);
  await apply();

  // biome-ignore lint/suspicious/noExplicitAny: cast PGlite driver to driver-agnostic Database type
  const db = rawDb as any as Database;

  return {
    db,
    close: () => client.close(),
  };
}

/** Truncate all public tables. */
export async function truncateAll(db: Database): Promise<void> {
  await db.execute(sql`
    DO $$ DECLARE r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
      END LOOP;
    END $$;
  `);
}
