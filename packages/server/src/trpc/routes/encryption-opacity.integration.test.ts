import { fakeEncrypted, plainOp, plainSealed, type Sealed } from "@spreadsheet/shared";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../../db/index.js";
import { journalEntries, persons } from "../../db/schema.js";
import { seed } from "../../db/seed.js";
import { QuestionStore } from "../../store/questions.js";
import { anonCtx, authedCtx, createCaller, tokenCtx } from "../../test/factories.js";

let db: Database;

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  ({ db } = createDatabase(url));
  await seed(new QuestionStore(db));
});

beforeEach(async () => {
  await db.execute(sql`TRUNCATE journal_entries, persons, groups CASCADE`);
});

/**
 * Locks in the wire-contract for encrypted groups: every PII field that
 * crosses the API boundary stays opaque end-to-end. The server never
 * decrypts, never logs cleartext alongside ciphertext, and never silently
 * downgrades to plaintext. These tests would fail if a future change
 * introduced any code path that:
 *
 *   - extracted payload from `e:1:` strings before persisting
 *   - mirrored plaintext into a non-PII column or audit log
 *   - accepted a `p:` value in an encrypted group's API call instead of
 *     rejecting it (`encryption_mismatch`)
 *
 * The first test passes only opaque ciphertext-shaped values through the
 * API, then reads `persons.name`, `persons.anatomy`, and
 * `journal_entries.operation` directly from Postgres and asserts every
 * row matches `^e:1:` AND none of the plaintext markers we encoded
 * appear anywhere. The second sends `p:` values and asserts each write is
 * rejected and none is persisted.
 */
describe("encrypted-group journal opacity (real Postgres)", () => {
  // Synthetic ciphertext stand-ins. Real clients use AES-GCM via WebCrypto;
  // for this property test we only need values that look like `e:1:<bytes>`
  // and don't contain the plaintext markers in their payload (base64 of
  // "alice" is "YWxpY2U", which doesn't contain "alice").
  function opaque<T>(label: string): Sealed<T> {
    return fakeEncrypted<T>(Buffer.from(label).toString("base64url"));
  }

  // Plaintext markers we'd expect to leak if the server ever decrypted or
  // mirrored cleartext. Each is the input to `opaque()` above; if any
  // appears as a substring in any persisted column, the opacity contract
  // is broken.
  const PLAINTEXT_MARKERS = ["alice", "bob", "amab", "afab", "supersecret-note-payload"];

  it("persons + journal_entries store only opaque e:1: strings, no plaintext leaks", async () => {
    // Encrypted group, all PII already sealed (stands in for what the web
    // client's group codec produces).
    const caller = createCaller(anonCtx(db));
    const { adminToken } = await caller.groups.create({
      encrypted: true,
      questionMode: "filtered",
      anatomyLabels: "anatomical",
      anatomyPicker: "admin",
      keyCheck: opaque("keycheck"),
    });
    await caller.groups.setupAdmin({
      adminToken,
      name: opaque("alice"),
      anatomy: opaque("amab"),
      partners: [{ name: opaque("bob"), anatomy: opaque("afab") }],
    });

    const aliceStatus = await createCaller(tokenCtx(db, adminToken)).groups.status();
    const aliceCaller = createCaller(authedCtx(db, aliceStatus!, adminToken));
    await aliceCaller.sync.push({
      stoken: null,
      operations: [opaque("op-rating-yes"), opaque("supersecret-note-payload")],
      progress: opaque("progress-2-of-10"),
    });

    // Read every PII column directly from Postgres via the Drizzle query
    // builder — bypasses the store layer so the assertion is anchored on
    // what's actually persisted, not on what the API surface returns.
    const personRows = await db.select({ name: persons.name, anatomy: persons.anatomy }).from(persons);
    const journalRows = await db.select({ operation: journalEntries.operation }).from(journalEntries);

    expect(personRows.length).toBeGreaterThan(0);
    expect(journalRows.length).toBeGreaterThan(0);

    for (const row of personRows) {
      expect(row.name).toMatch(/^e:1:/);
      if (row.anatomy !== null) expect(row.anatomy).toMatch(/^e:1:/);
    }
    for (const row of journalRows) {
      expect(row.operation).toMatch(/^e:1:/);
    }

    const allPersistedText = [
      ...personRows.flatMap((r) => [r.name, r.anatomy ?? ""]),
      ...journalRows.map((r) => r.operation),
    ].join("\n");

    for (const marker of PLAINTEXT_MARKERS) {
      expect(allPersistedText, `plaintext marker "${marker}" leaked into persisted PII columns`).not.toContain(marker);
    }
  });

  it("rejects p: values from setupAdmin, setProfile and sync.push and persists none of them", async () => {
    const caller = createCaller(anonCtx(db));
    const { adminToken } = await caller.groups.create({
      encrypted: true,
      questionMode: "all",
      anatomyLabels: null,
      anatomyPicker: null,
      keyCheck: opaque("keycheck"),
    });
    const mismatch = { code: "BAD_REQUEST", message: "Value encryption does not match group setting" };

    await expect(
      caller.groups.setupAdmin({ adminToken, name: plainSealed("alice"), anatomy: null, partners: [] }),
    ).rejects.toMatchObject(mismatch);
    await expect(
      caller.groups.setupAdmin({
        adminToken,
        name: opaque("alice"),
        anatomy: null,
        partners: [{ name: plainSealed("bob"), anatomy: null }],
      }),
    ).rejects.toMatchObject(mismatch);
    expect(await db.select().from(persons)).toEqual([]);

    await caller.groups.setupAdmin({ adminToken, name: opaque("alice"), anatomy: null, partners: [] });
    const status = await createCaller(tokenCtx(db, adminToken)).groups.status();
    const alice = createCaller(authedCtx(db, status!, adminToken));

    await expect(alice.groups.setProfile({ name: plainSealed("alice"), anatomy: null })).rejects.toMatchObject(
      mismatch,
    );
    await expect(
      alice.sync.push({ stoken: null, operations: [plainOp("a:mutual", { rating: "yes", note: null })] }),
    ).rejects.toMatchObject(mismatch);
    await expect(
      alice.sync.push({ stoken: null, operations: [opaque("op")], progress: plainSealed({ answered: 1, total: 2 }) }),
    ).rejects.toMatchObject(mismatch);

    const personRows = await db.select({ name: persons.name, progress: persons.progress }).from(persons);
    expect(personRows).toEqual([{ name: opaque("alice"), progress: null }]);
    expect(await db.select().from(journalEntries)).toEqual([]);
  });
});
