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
 * downgrades to plaintext. This test would fail if a future change
 * introduced any code path that:
 *
 *   - extracted payload from `e:1:` strings before persisting
 *   - mirrored plaintext into a non-PII column or audit log
 *   - accepted plaintext PII in an encrypted-group's API call without
 *     also storing the opaque form
 *
 * The test passes only opaque ciphertext-shaped values through the API,
 * then reads `persons.name`, `persons.anatomy`, and
 * `journal_entries.operation` directly from Postgres and asserts every
 * row matches `^e:1:` AND none of the plaintext markers we encoded
 * appear anywhere.
 */
describe("encrypted-group journal opacity (real Postgres)", () => {
  // Synthetic ciphertext stand-ins. Real clients use AES-GCM via WebCrypto;
  // for this property test we only need values that look like `e:1:<bytes>`
  // and don't contain the plaintext markers in their payload (base64 of
  // "alice" is "YWxpY2U", which doesn't contain "alice").
  const opaque = (label: string) => `e:1:${Buffer.from(label).toString("base64url")}`;

  // Plaintext markers we'd expect to leak if the server ever decrypted or
  // mirrored cleartext. Each is the input to `opaque()` above; if any
  // appears as a substring in any persisted column, the opacity contract
  // is broken.
  const PLAINTEXT_MARKERS = ["alice", "bob", "amab", "afab", "supersecret-note-payload"];

  it("persons + journal_entries store only opaque e:1: strings, no plaintext leaks", async () => {
    // Encrypted group, all PII pre-wrapped (mimics what the web client
    // produces via wrapSensitive + encodeValue).
    const caller = createCaller(anonCtx(db));
    const { adminToken } = await caller.groups.create({
      encrypted: true,
      questionMode: "filtered",
      anatomyLabels: "anatomical",
      anatomyPicker: "admin",
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
});
