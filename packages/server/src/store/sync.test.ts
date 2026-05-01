import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/index.js";
import { groups, persons } from "../db/schema.js";
import { createTestDatabase, truncateAll } from "../test/pglite.js";
import { SyncStore } from "./sync.js";

let db: Database;
let close: () => Promise<void>;
let store: SyncStore;

beforeAll(async () => {
  process.env.STOKEN_SECRET = "test-secret";
  const result = await createTestDatabase();
  db = result.db;
  close = result.close;
  store = new SyncStore(db);
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await truncateAll(db);
});

async function createTestPerson(encrypted = false) {
  const [group] = await db
    .insert(groups)
    .values({ encrypted, isReady: true, questionMode: "all", showTiming: true })
    .returning();
  const [person] = await db
    .insert(persons)
    .values({
      groupId: group.id,
      name: "Alice",
      anatomy: "afab",
      token: `t-${Math.random()}`,
      isAdmin: true,
      isCompleted: false,
    })
    .returning();
  return { groupId: group.id, personId: person.id, encrypted: group.encrypted };
}

describe("SyncStore.push", () => {
  it("accepts first push with null stoken", async () => {
    const { personId, encrypted } = await createTestPerson();
    const result = await store.push(
      personId,
      {
        stoken: null,
        operations: ['p:1:{"key":"a:mutual","data":{"rating":"yes","timing":"now"}}'],
        progress: undefined,
      },
      encrypted,
    );
    expect(result).not.toHaveProperty("error");
    if ("pushRejected" in result) {
      expect(result.pushRejected).toBe(false);
      expect(result.stoken).toBeDefined();
      expect(result.entries).toHaveLength(1);
    }
  });

  it("accepts sequential pushes with correct stoken", async () => {
    const { personId, encrypted } = await createTestPerson();
    const first = await store.push(
      personId,
      {
        stoken: null,
        operations: ['p:1:{"key":"a:mutual","data":{"rating":"yes","timing":"now"}}'],
        progress: undefined,
      },
      encrypted,
    );
    if (!("pushRejected" in first)) throw new Error("unexpected error");
    const second = await store.push(
      personId,
      {
        stoken: first.stoken,
        operations: ['p:1:{"key":"b:mutual","data":{"rating":"no","timing":null}}'],
        progress: undefined,
      },
      encrypted,
    );
    expect(second).not.toHaveProperty("error");
    if ("pushRejected" in second) {
      expect(second.pushRejected).toBe(false);
      expect(second.entries).toHaveLength(1);
    }
  });

  it("rejects push with stale stoken", async () => {
    const { personId, encrypted } = await createTestPerson();
    const first = await store.push(
      personId,
      {
        stoken: null,
        operations: ['p:1:{"key":"a:mutual","data":{"rating":"yes","timing":"now"}}'],
        progress: undefined,
      },
      encrypted,
    );
    if (!("pushRejected" in first)) throw new Error("unexpected error");
    await store.push(
      personId,
      {
        stoken: first.stoken,
        operations: ['p:1:{"key":"b:mutual","data":{"rating":"no","timing":null}}'],
        progress: undefined,
      },
      encrypted,
    );
    const stale = await store.push(
      personId,
      {
        stoken: first.stoken,
        operations: ['p:1:{"key":"c:mutual","data":{"rating":"maybe","timing":null}}'],
        progress: undefined,
      },
      encrypted,
    );
    expect(stale).not.toHaveProperty("error");
    if ("pushRejected" in stale) {
      expect(stale.pushRejected).toBe(true);
      expect(stale.entries.length).toBeGreaterThan(0);
    }
  });

  it("updates progress", async () => {
    const { personId, encrypted } = await createTestPerson();
    await store.push(
      personId,
      {
        stoken: null,
        operations: ['p:1:{"key":"a:mutual","data":{"rating":"yes","timing":"now"}}'],
        progress: 'p:1:{"answered":1,"total":10}',
      },
      encrypted,
    );
    // Verify via raw DB query (store doesn't expose progress directly)
    const [row] = await db.select().from(persons).where(eq(persons.id, personId));
    expect(row.progress).toBe('p:1:{"answered":1,"total":10}');
  });

  it("returns encryption_mismatch when plaintext op sent to encrypted group", async () => {
    const { personId } = await createTestPerson(true);
    const result = await store.push(
      personId,
      {
        stoken: null,
        operations: ['p:1:{"key":"a:mutual","data":{"rating":"yes","timing":"now"}}'],
        progress: undefined,
      },
      true,
    );
    expect(result).toEqual({ error: "encryption_mismatch" });
  });

  it("returns encryption_mismatch when encrypted op sent to plaintext group", async () => {
    const { personId } = await createTestPerson(false);
    const result = await store.push(
      personId,
      {
        stoken: null,
        operations: ["e:1:encryptedpayload"],
        progress: undefined,
      },
      false,
    );
    expect(result).toEqual({ error: "encryption_mismatch" });
  });

  it("returns encryption_mismatch when any op in a batch mismatches", async () => {
    const { personId } = await createTestPerson(false);
    const result = await store.push(
      personId,
      {
        stoken: null,
        operations: ['p:1:{"key":"a:mutual","data":{"rating":"yes","timing":"now"}}', "e:1:encryptedpayload"],
        progress: undefined,
      },
      false,
    );
    expect(result).toEqual({ error: "encryption_mismatch" });
  });

  it("accepts encrypted ops on encrypted group", async () => {
    const { personId } = await createTestPerson(true);
    const result = await store.push(
      personId,
      {
        stoken: null,
        operations: ["e:1:encryptedpayload"],
        progress: undefined,
      },
      true,
    );
    expect(result).not.toHaveProperty("error");
    if ("pushRejected" in result) {
      expect(result.pushRejected).toBe(false);
    }
  });
});

describe("SyncStore.markComplete / unmarkComplete", () => {
  it("toggles completion status", async () => {
    const { personId } = await createTestPerson();
    await store.markComplete(personId);
    let [row] = await db.select().from(persons).where(eq(persons.id, personId));
    expect(row.isCompleted).toBe(true);

    await store.unmarkComplete(personId);
    [row] = await db.select().from(persons).where(eq(persons.id, personId));
    expect(row.isCompleted).toBe(false);
  });
});

describe("SyncStore.journalSince", () => {
  async function setupCompleteGroup() {
    const [group] = await db
      .insert(groups)
      .values({ encrypted: false, isReady: true, questionMode: "all", showTiming: true })
      .returning();
    const [alice] = await db
      .insert(persons)
      .values({
        groupId: group.id,
        name: "Alice",
        anatomy: "afab",
        token: `a-${Math.random()}`,
        isAdmin: true,
        isCompleted: true,
      })
      .returning();
    const [bob] = await db
      .insert(persons)
      .values({
        groupId: group.id,
        name: "Bob",
        anatomy: "amab",
        token: `b-${Math.random()}`,
        isAdmin: false,
        isCompleted: true,
      })
      .returning();
    return { group, alice, bob };
  }

  it("returns all entries when sinceId is null", async () => {
    const { group, alice, bob } = await setupCompleteGroup();
    await store.push(
      alice.id,
      {
        stoken: null,
        operations: ['p:1:{"key":"a:give","data":{"rating":"yes","timing":"now"}}'],
        progress: undefined,
      },
      false,
    );
    await store.push(
      bob.id,
      {
        stoken: null,
        operations: ['p:1:{"key":"a:receive","data":{"rating":"yes","timing":"now"}}'],
        progress: undefined,
      },
      false,
    );

    const result = await store.journalSince(group.id, null);
    expect("members" in result && result.members).toHaveLength(2);
    expect("entries" in result && result.entries).toHaveLength(2);
    // cursor is the highest id in the response
    if ("entries" in result) {
      expect(result.cursor).toBe(result.entries[result.entries.length - 1].id);
      // every entry carries its numeric id
      for (const e of result.entries) {
        expect(typeof e.id).toBe("number");
      }
    }
  });

  it("returns only entries with id > sinceId when sinceId is set", async () => {
    const { group, alice, bob } = await setupCompleteGroup();
    await store.push(
      alice.id,
      {
        stoken: null,
        operations: ['p:1:{"key":"a:give","data":{"rating":"yes","timing":"now"}}'],
        progress: undefined,
      },
      false,
    );
    const firstFetch = await store.journalSince(group.id, null);
    if (!("entries" in firstFetch)) throw new Error("expected entries");
    const cursorAfterFirst = firstFetch.cursor;

    // Now a second write
    await store.push(
      bob.id,
      {
        stoken: null,
        operations: ['p:1:{"key":"a:receive","data":{"rating":"maybe","timing":null}}'],
        progress: undefined,
      },
      false,
    );

    const delta = await store.journalSince(group.id, cursorAfterFirst);
    expect("entries" in delta).toBe(true);
    if ("entries" in delta) {
      expect(delta.entries).toHaveLength(1);
      expect(delta.entries[0].personId).toBe(bob.id);
      expect(delta.cursor).toBe(delta.entries[0].id);
      expect(delta.cursor).toBeGreaterThan(cursorAfterFirst ?? 0);
    }
  });

  it("returns empty delta with cursor unchanged when nothing new", async () => {
    const { group, alice } = await setupCompleteGroup();
    await store.push(
      alice.id,
      {
        stoken: null,
        operations: ['p:1:{"key":"a:give","data":{"rating":"yes","timing":"now"}}'],
        progress: undefined,
      },
      false,
    );
    const first = await store.journalSince(group.id, null);
    if (!("entries" in first)) throw new Error("expected entries");

    // Re-fetch with the current cursor — nothing new
    const repeat = await store.journalSince(group.id, first.cursor);
    expect("entries" in repeat).toBe(true);
    if ("entries" in repeat) {
      expect(repeat.entries).toHaveLength(0);
      // cursor echoes the input on empty delta, so repeat calls don't regress
      expect(repeat.cursor).toBe(first.cursor);
    }
  });

  it("populates members list even when delta is empty", async () => {
    const { group } = await setupCompleteGroup();
    // No pushes — journal is empty
    const result = await store.journalSince(group.id, null);
    expect("members" in result && result.members).toHaveLength(2);
    if ("entries" in result) {
      expect(result.entries).toHaveLength(0);
      expect(result.cursor).toBe(null);
    }
  });

  it("returns error when not all members are complete", async () => {
    const [group] = await db
      .insert(groups)
      .values({ encrypted: false, isReady: true, questionMode: "all", showTiming: true })
      .returning();
    await db.insert(persons).values({
      groupId: group.id,
      name: "Alice",
      anatomy: "afab",
      token: `a-${Math.random()}`,
      isAdmin: true,
      isCompleted: true,
    });
    await db.insert(persons).values({
      groupId: group.id,
      name: "Bob",
      anatomy: "amab",
      token: `b-${Math.random()}`,
      isAdmin: false,
      isCompleted: false,
    });

    const result = await store.journalSince(group.id, null);
    expect(result).toEqual({ error: "not_all_complete" });
  });

  it("returns error when not all complete, even with sinceId set", async () => {
    const [group] = await db
      .insert(groups)
      .values({ encrypted: false, isReady: true, questionMode: "all", showTiming: true })
      .returning();
    await db.insert(persons).values({
      groupId: group.id,
      name: "Alice",
      anatomy: "afab",
      token: `a-${Math.random()}`,
      isAdmin: true,
      isCompleted: false,
    });
    const result = await store.journalSince(group.id, 42);
    expect(result).toEqual({ error: "not_all_complete" });
  });
});
