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

async function createTestPerson() {
  const [group] = await db
    .insert(groups)
    .values({ encrypted: false, isReady: true, questionMode: "all", showTiming: true })
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
  return { groupId: group.id, personId: person.id };
}

describe("SyncStore.push", () => {
  it("accepts first push with null stoken", async () => {
    const { personId } = await createTestPerson();
    const result = await store.push(personId, {
      stoken: null,
      operations: ['p:1:{"key":"a:mutual","data":{"rating":"yes","timing":"now"}}'],
      progress: null,
    });
    expect(result.pushRejected).toBe(false);
    expect(result.stoken).toBeDefined();
    expect(result.entries).toHaveLength(1);
  });

  it("accepts sequential pushes with correct stoken", async () => {
    const { personId } = await createTestPerson();
    const first = await store.push(personId, {
      stoken: null,
      operations: ['p:1:{"key":"a:mutual","data":{"rating":"yes","timing":"now"}}'],
      progress: null,
    });
    const second = await store.push(personId, {
      stoken: first.stoken,
      operations: ['p:1:{"key":"b:mutual","data":{"rating":"no","timing":null}}'],
      progress: null,
    });
    expect(second.pushRejected).toBe(false);
    expect(second.entries).toHaveLength(1);
  });

  it("rejects push with stale stoken", async () => {
    const { personId } = await createTestPerson();
    const first = await store.push(personId, {
      stoken: null,
      operations: ['p:1:{"key":"a:mutual","data":{"rating":"yes","timing":"now"}}'],
      progress: null,
    });
    await store.push(personId, {
      stoken: first.stoken,
      operations: ['p:1:{"key":"b:mutual","data":{"rating":"no","timing":null}}'],
      progress: null,
    });
    const stale = await store.push(personId, {
      stoken: first.stoken,
      operations: ['p:1:{"key":"c:mutual","data":{"rating":"maybe","timing":null}}'],
      progress: null,
    });
    expect(stale.pushRejected).toBe(true);
    expect(stale.entries.length).toBeGreaterThan(0);
  });

  it("updates progress", async () => {
    const { personId } = await createTestPerson();
    await store.push(personId, {
      stoken: null,
      operations: ['p:1:{"key":"a:mutual","data":{"rating":"yes","timing":"now"}}'],
      progress: 'p:1:{"answered":1,"total":10}',
    });
    // Verify via raw DB query (store doesn't expose progress directly)
    const [row] = await db.select().from(persons).where(eq(persons.id, personId));
    expect(row.progress).toBe('p:1:{"answered":1,"total":10}');
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
    await store.push(alice.id, {
      stoken: null,
      operations: ['p:1:{"key":"a:give","data":{"rating":"yes","timing":"now"}}'],
      progress: null,
    });
    await store.push(bob.id, {
      stoken: null,
      operations: ['p:1:{"key":"a:receive","data":{"rating":"yes","timing":"now"}}'],
      progress: null,
    });

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
    await store.push(alice.id, {
      stoken: null,
      operations: ['p:1:{"key":"a:give","data":{"rating":"yes","timing":"now"}}'],
      progress: null,
    });
    const firstFetch = await store.journalSince(group.id, null);
    if (!("entries" in firstFetch)) throw new Error("expected entries");
    const cursorAfterFirst = firstFetch.cursor;

    // Now a second write
    await store.push(bob.id, {
      stoken: null,
      operations: ['p:1:{"key":"a:receive","data":{"rating":"maybe","timing":null}}'],
      progress: null,
    });

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
    await store.push(alice.id, {
      stoken: null,
      operations: ['p:1:{"key":"a:give","data":{"rating":"yes","timing":"now"}}'],
      progress: null,
    });
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
