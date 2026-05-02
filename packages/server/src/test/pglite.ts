import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import type { Database, DatabaseHandle } from "../db/index.js";
import * as schema from "../db/schema.js";

/**
 * Boot an in-memory PGlite instance with the full schema applied.
 * Returns the Drizzle db and a cleanup function.
 */
export async function createTestDatabase(): Promise<DatabaseHandle> {
  const client = new PGlite();

  const db: Database = drizzle({ client, schema });

  // pushSchema's signature wants a schema-less PgDatabase (Record<string, never>),
  // so we widen here. Runtime is fine — pushSchema only uses the connection.
  // biome-ignore lint/suspicious/noExplicitAny: pushSchema typing is overly narrow
  const { apply } = await pushSchema(schema, db as any);
  await apply();

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
