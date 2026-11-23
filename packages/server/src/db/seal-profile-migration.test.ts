import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { asc, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase } from "../test/pglite.js";
import type { Database } from "./index.js";
import { groups, journalEntries, persons } from "./schema.js";

const MIGRATION = resolve(import.meta.dirname, "../../migrations/0006_seal_profile_fields.sql");

/** Run the migration file the way drizzle's migrator does: one statement per breakpoint. */
async function runMigration(db: Database) {
  const statements = readFileSync(MIGRATION, "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) await db.execute(sql.raw(statement));
}

/** Legacy raw names, chosen to exercise JSON escaping. */
const RAW_NAMES = [
  "Alice",
  `O'Brien "Bobby"`,
  "back\\slash",
  "line\nbreak\r\n\u2028\u2029",
  "tab\there",
  "control\u0001\u001f\u007f",
  "Zoë 名前 Ñandú",
  "🦄 emoji 👩‍❤️‍👨",
  '{"looks":"like json"}',
  "",
  // Near misses of the sealed prefix: still raw.
  "p:x",
  "e:mail",
  "p:1",
  "P:1:caps",
];

const RAW_ANATOMIES = ["afab", "amab", "both", "none"];

/** Values that are already sealed (any mode or version) and must not change. */
const SEALED_NAMES = ['p:1:"Carol"', "e:1:Y2Fyb2w", "p:2:future-version", 'p:12:"x"'];
const SEALED_ANATOMIES = ['p:1:"afab"', "e:1:YW1hYg"];

let db: Database;
let close: () => Promise<void>;

interface Row {
  id: string;
  name: string;
  anatomy: string | null;
  progress: string | null;
}

/** original values, keyed by person id */
const originals = new Map<string, Row>();

let tokenCounter = 0;
async function insertPerson(groupId: string, name: string, anatomy: string | null, progress: string | null = null) {
  const [row] = await db
    .insert(persons)
    .values({ groupId, name, anatomy, progress, token: `t-${tokenCounter++}`, isAdmin: false, isCompleted: false })
    .returning({ id: persons.id, name: persons.name, anatomy: persons.anatomy, progress: persons.progress });
  originals.set(row.id, row);
  return row;
}

async function allRows(): Promise<Row[]> {
  return db
    .select({ id: persons.id, name: persons.name, anatomy: persons.anatomy, progress: persons.progress })
    .from(persons)
    .orderBy(asc(persons.id));
}

function isSealed(value: string) {
  return /^[pe]:[0-9]+:/.test(value);
}

function expectSealedFrom(after: string, original: string) {
  expect(after).toBe(`p:1:${JSON.stringify(original)}`);
  expect(JSON.parse(after.slice("p:1:".length))).toBe(original);
}

beforeAll(async () => {
  ({ db, close } = await createTestDatabase());

  const [plain] = await db.insert(groups).values({ encrypted: false, isReady: true, questionMode: "all" }).returning();
  const [enc] = await db.insert(groups).values({ encrypted: true, isReady: true, questionMode: "all" }).returning();

  // Every raw name × raw/null anatomy, in both group modes: raw values in an
  // encrypted group are plaintext an older client leaked, sealed the same way.
  for (const group of [plain, enc]) {
    for (const [i, name] of RAW_NAMES.entries()) {
      await insertPerson(group.id, name, i % 5 === 4 ? null : RAW_ANATOMIES[i % RAW_ANATOMIES.length]);
    }
  }
  // Already-sealed values, alone and mixed with raw ones on the same row.
  for (const name of SEALED_NAMES) await insertPerson(plain.id, name, null);
  for (const anatomy of SEALED_ANATOMIES) await insertPerson(plain.id, 'p:1:"Dana"', anatomy);
  await insertPerson(enc.id, "e:1:ZW5j", "e:1:YW5h", "e:1:cHJvZ3Jlc3M");
  await insertPerson(plain.id, "Raw name", 'p:1:"both"', 'p:1:{"answered":1,"total":2}');
  await insertPerson(enc.id, "e:1:ZW5j", "afab");

  const someone = [...originals.keys()][0];
  await db.insert(journalEntries).values({ personId: someone, operation: "e:1:b3A" });

  await runMigration(db);
});

afterAll(async () => {
  await close();
});

describe("0006_seal_profile_fields", () => {
  it("rewrites every raw name to p:1:<json> that round-trips through JSON.parse", async () => {
    for (const row of await allRows()) {
      const original = originals.get(row.id)!;
      if (isSealed(original.name)) continue;
      expectSealedFrom(row.name, original.name);
    }
  });

  it("rewrites every raw non-null anatomy and leaves null anatomy null", async () => {
    for (const row of await allRows()) {
      const original = originals.get(row.id)!;
      if (original.anatomy === null) expect(row.anatomy).toBeNull();
      else if (!isSealed(original.anatomy)) expectSealedFrom(row.anatomy!, original.anatomy);
    }
  });

  it("leaves already-sealed names, anatomy and progress byte-for-byte unchanged", async () => {
    const rows = await allRows();
    for (const row of rows) {
      const original = originals.get(row.id)!;
      if (isSealed(original.name)) expect(row.name).toBe(original.name);
      if (original.anatomy !== null && isSealed(original.anatomy)) expect(row.anatomy).toBe(original.anatomy);
      expect(row.progress).toBe(original.progress);
    }
    // Sanity: the fixture actually covers both branches.
    expect(rows.filter((r) => isSealed(originals.get(r.id)!.name)).length).toBe(SEALED_NAMES.length + 4);
    expect(rows.filter((r) => !isSealed(originals.get(r.id)!.name)).length).toBe(2 * RAW_NAMES.length + 1);
  });

  it("leaves journal operations alone", async () => {
    const entries = await db.select({ operation: journalEntries.operation }).from(journalEntries);
    expect(entries).toEqual([{ operation: "e:1:b3A" }]);
  });

  it("is a no-op when run again", async () => {
    const before = await allRows();
    await runMigration(db);
    expect(await allRows()).toEqual(before);
  });
});
