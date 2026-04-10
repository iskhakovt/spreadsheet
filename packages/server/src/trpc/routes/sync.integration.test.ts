import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../../db/index.js";
import { seed } from "../../db/seed.js";
import { QuestionStore } from "../../store/questions.js";
import { anonCtx, authedCtx, createCaller, defaultCreate } from "../../test/factories.js";

let db: Database;

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  db = createDatabase(url);
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

  const aliceStatus = await caller.groups.status({ token: adminToken });
  const aliceCtx = authedCtx(db, aliceStatus!, adminToken);

  const bobStatus = await caller.groups.status({ token: bobToken });
  const bobCtx = authedCtx(db, bobStatus!, bobToken);

  return {
    alice: { token: adminToken, caller: createCaller(aliceCtx) },
    bob: { token: bobToken, caller: createCaller(bobCtx) },
  };
}

describe("full sync flow (real Postgres)", () => {
  it("create → push → mark complete → compare", async () => {
    const { alice, bob } = await createGroupWithMembers();

    const aliceResult = await alice.caller.sync.push({
      stoken: null,
      operations: [
        'p:1:{"key":"oral:give","data":{"rating":"yes","timing":"now"}}',
        'p:1:{"key":"blindfold:mutual","data":{"rating":"maybe","timing":null}}',
      ],
      progress: 'p:1:{"answered":2,"total":10}',
    });
    expect(aliceResult.pushRejected).toBe(false);
    expect(aliceResult.entries).toHaveLength(2);

    const bobResult = await bob.caller.sync.push({
      stoken: null,
      operations: [
        'p:1:{"key":"oral:receive","data":{"rating":"yes","timing":"now"}}',
        'p:1:{"key":"blindfold:mutual","data":{"rating":"yes","timing":"later"}}',
      ],
      progress: 'p:1:{"answered":2,"total":10}',
    });
    expect(bobResult.pushRejected).toBe(false);

    await alice.caller.sync.markComplete();
    await bob.caller.sync.markComplete();

    const comparison = await alice.caller.sync.compare();
    expect(comparison.members).toHaveLength(2);
    expect(comparison.entries).toHaveLength(4);
  });

  it("rejects compare when not all complete", async () => {
    const { alice } = await createGroupWithMembers();
    await alice.caller.sync.markComplete();
    await expect(alice.caller.sync.compare()).rejects.toThrow("All group members");
  });

  it("handles stale stoken conflict", async () => {
    const { alice } = await createGroupWithMembers();

    const first = await alice.caller.sync.push({
      stoken: null,
      operations: ['p:1:{"key":"a:mutual","data":{"rating":"yes","timing":"now"}}'],
      progress: null,
    });

    await alice.caller.sync.push({
      stoken: first.stoken,
      operations: ['p:1:{"key":"b:mutual","data":{"rating":"no","timing":null}}'],
      progress: null,
    });

    const stale = await alice.caller.sync.push({
      stoken: first.stoken,
      operations: ['p:1:{"key":"c:mutual","data":{"rating":"maybe","timing":null}}'],
      progress: null,
    });

    expect(stale.pushRejected).toBe(true);
    expect(stale.entries.length).toBeGreaterThan(0);
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

    const status = await caller.groups.status({ token: adminToken });
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
