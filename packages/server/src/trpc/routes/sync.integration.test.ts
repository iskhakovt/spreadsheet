import { plainOp, plainProgress } from "@spreadsheet/shared";
import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../../db/index.js";
import { seed } from "../../db/seed.js";
import { QuestionStore } from "../../store/questions.js";
import { anonCtx, authedCtx, createCaller, defaultCreate, tokenCtx } from "../../test/factories.js";

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

async function createGroupWithMembers() {
  const caller = createCaller(anonCtx(db));

  const { adminToken } = await caller.groups.create(defaultCreate());
  const { partnerTokens } = await caller.groups.setupAdmin({
    adminToken,
    name: "Alice",
    anatomy: null,
    partners: [{ name: "Bob", anatomy: null }],
  });
  const bobToken = partnerTokens[0];

  const aliceStatus = await createCaller(tokenCtx(db, adminToken)).groups.status();
  const aliceCtx = authedCtx(db, aliceStatus!, adminToken);

  const bobStatus = await createCaller(tokenCtx(db, bobToken)).groups.status();
  const bobCtx = authedCtx(db, bobStatus!, bobToken);

  return {
    alice: { token: adminToken, caller: createCaller(aliceCtx) },
    bob: { token: bobToken, caller: createCaller(bobCtx) },
  };
}

describe("full sync flow (real Postgres)", () => {
  it("create → push → mark complete → journal", async () => {
    const { alice, bob } = await createGroupWithMembers();

    const aliceResult = await alice.caller.sync.push({
      stoken: null,
      operations: [
        plainOp("oral:give", { rating: "yes", note: null }),
        plainOp("blindfold:mutual", { rating: "maybe", note: null }),
      ],
      progress: plainProgress({ answered: 2, total: 10 }),
    });
    expect(aliceResult.pushRejected).toBe(false);
    expect(aliceResult.entries).toHaveLength(2);

    const bobResult = await bob.caller.sync.push({
      stoken: null,
      operations: [
        plainOp("oral:receive", { rating: "yes", note: null }),
        plainOp("blindfold:mutual", { rating: "yes", note: null }),
      ],
      progress: plainProgress({ answered: 2, total: 10 }),
    });
    expect(bobResult.pushRejected).toBe(false);

    await alice.caller.sync.markComplete();
    await bob.caller.sync.markComplete();

    const journal = await alice.caller.sync.journal({ sinceId: undefined });
    expect(journal.members).toHaveLength(2);
    expect(journal.entries).toHaveLength(4);
    // cursor is the highest id; every entry has a numeric id
    expect(journal.cursor).toBe(journal.entries[journal.entries.length - 1].id);
  });

  it("journal delta returns only entries after sinceId", async () => {
    const { alice, bob } = await createGroupWithMembers();

    const alicePushA = await alice.caller.sync.push({
      stoken: null,
      operations: [plainOp("a:give", { rating: "yes", note: null })],
      progress: undefined,
    });
    await bob.caller.sync.push({
      stoken: null,
      operations: [plainOp("a:receive", { rating: "yes", note: null })],
      progress: undefined,
    });
    await alice.caller.sync.markComplete();
    await bob.caller.sync.markComplete();

    const initial = await alice.caller.sync.journal({ sinceId: undefined });
    expect(initial.entries).toHaveLength(2);
    const initialCursor = initial.cursor;

    // Edit while complete — another push lands a new entry. Alice's stoken
    // must be her own head (from alicePushA) to avoid a stoken conflict.
    await alice.caller.sync.push({
      stoken: alicePushA.stoken,
      operations: [plainOp("a:give", { rating: "no", note: null })],
      progress: undefined,
    });

    const delta = await alice.caller.sync.journal({ sinceId: initialCursor ?? undefined });
    expect(delta.entries).toHaveLength(1);
    expect(delta.cursor).toBeGreaterThan(initialCursor ?? 0);

    // Empty delta: fetching again with the new cursor returns nothing new
    const empty = await alice.caller.sync.journal({ sinceId: delta.cursor ?? undefined });
    expect(empty.entries).toHaveLength(0);
    expect(empty.cursor).toBe(delta.cursor);
  });

  it("rejects journal when not all complete", async () => {
    const { alice } = await createGroupWithMembers();
    await alice.caller.sync.markComplete();
    await expect(alice.caller.sync.journal({ sinceId: undefined })).rejects.toThrow("All group members");
  });

  it("handles stale stoken conflict", async () => {
    const { alice } = await createGroupWithMembers();

    const first = await alice.caller.sync.push({
      stoken: null,
      operations: [plainOp("a:mutual", { rating: "yes", note: null })],
      progress: undefined,
    });

    await alice.caller.sync.push({
      stoken: first.stoken,
      operations: [plainOp("b:mutual", { rating: "no", note: null })],
      progress: undefined,
    });

    const stale = await alice.caller.sync.push({
      stoken: first.stoken,
      operations: [plainOp("c:mutual", { rating: "maybe", note: null })],
      progress: undefined,
    });

    expect(stale.pushRejected).toBe(true);
    expect(stale.entries.length).toBeGreaterThan(0);
  });

  it("selfJournal returns only the caller's own entries, ungated", async () => {
    const { alice, bob } = await createGroupWithMembers();

    await alice.caller.sync.push({
      stoken: null,
      operations: [
        plainOp("a:give", { rating: "yes", note: null }),
        plainOp("b:mutual", { rating: "maybe", note: null }),
      ],
      progress: undefined,
    });
    await bob.caller.sync.push({
      stoken: null,
      operations: [plainOp("a:receive", { rating: "no", note: null })],
      progress: undefined,
    });
    // Neither has marked complete — sync.journal would be gated, but selfJournal isn't.

    const aliceView = await alice.caller.sync.selfJournal({ sinceId: undefined });
    expect(aliceView.entries).toHaveLength(2);
    expect(aliceView.cursor).toBe(aliceView.entries[1].id);
    expect(aliceView.stoken).not.toBeNull();
    for (const e of aliceView.entries) {
      expect(e.personId).not.toBe(undefined);
      expect(e.operation.startsWith("p:1:")).toBe(true);
    }

    const bobView = await bob.caller.sync.selfJournal({ sinceId: undefined });
    expect(bobView.entries).toHaveLength(1);
    expect(bobView.entries[0].operation).toBe(plainOp("a:receive", { rating: "no", note: null }));

    // Cursor-based delta
    const delta = await alice.caller.sync.selfJournal({ sinceId: aliceView.cursor ?? undefined });
    expect(delta.entries).toHaveLength(0);
    expect(delta.cursor).toBe(aliceView.cursor);
  });

  it("preserves a non-null note byte-for-byte through push and selfJournal read", async () => {
    // The rest of the suite uses note: null because raw fixtures pre-date
    // the note field. Confirm a real note string survives the wire/store
    // path — selfJournal is the live read path that materializes the
    // answers cache in production.
    const { alice } = await createGroupWithMembers();
    const noteOp = plainOp("oral:give", { rating: "yes", note: "side-lying first" });
    await alice.caller.sync.push({ stoken: null, operations: [noteOp], progress: undefined });

    const view = await alice.caller.sync.selfJournal({ sinceId: undefined });
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0].operation).toBe(noteOp);
  });

  it("handles encrypted group with opaque data", async () => {
    const caller = createCaller(anonCtx(db));

    const { adminToken } = await caller.groups.create(defaultCreate({ encrypted: true }));
    await caller.groups.setupAdmin({
      adminToken,
      name: "e:1:encryptedAlice",
      anatomy: "e:1:encryptedAfab",
      partners: [],
    });

    const status = await createCaller(tokenCtx(db, adminToken)).groups.status();
    expect(status!.group.encrypted).toBe(true);
    expect(status!.person!.name).toBe("e:1:encryptedAlice");
    expect(status!.person!.anatomy).toBe("e:1:encryptedAfab");

    const ctx = authedCtx(db, status!, adminToken);
    const encCaller = createCaller(ctx);

    const result = await encCaller.sync.push({
      stoken: null,
      operations: ["e:1:someEncryptedBlob"],
      progress: "e:1:encryptedProgress",
    });

    expect(result.pushRejected).toBe(false);
    expect(result.entries[0]).toBe("e:1:someEncryptedBlob");
  });
});
