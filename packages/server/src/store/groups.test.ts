import {
  type Anatomy,
  fakeEncrypted,
  type KeyCheck,
  plainProgress,
  plainSealed,
  type Sealed,
} from "@spreadsheet/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/index.js";
import { groups, journalEntries, persons } from "../db/schema.js";
import { createTestDatabase, truncateAll } from "../test/pglite.js";
import { GroupStore } from "./groups.js";

let db: Database;
let close: () => Promise<void>;
let store: GroupStore;

beforeAll(async () => {
  const result = await createTestDatabase();
  db = result.db;
  close = result.close;
  store = new GroupStore(db);
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await truncateAll(db);
});

const alice = plainSealed("Alice");
const bob = plainSealed("Bob");
const afab = plainSealed<Anatomy>("afab");

const keyCheck = fakeEncrypted<KeyCheck>("keycheck");

async function createGroup(
  encrypted = false,
  overrides: Partial<
    Pick<Parameters<GroupStore["create"]>[0], "questionMode" | "anatomyLabels" | "anatomyPicker">
  > = {},
) {
  const result = await store.create({
    encrypted,
    questionMode: "all",
    anatomyLabels: null,
    anatomyPicker: null,
    keyCheck: encrypted ? keyCheck : null,
    ...overrides,
  });
  if ("error" in result) throw new Error(`create failed: ${result.error}`);
  return result;
}

/** Set up a group (admin only) in the given mode, with the admin's name sealed to match. */
async function setupGroup(encrypted: boolean) {
  const { groupId, adminToken } = await createGroup(encrypted);
  const result = await store.setupAdmin(adminToken, {
    name: encrypted ? fakeEncrypted("alice") : alice,
    anatomy: null,
    partners: [],
  });
  if ("error" in result) throw new Error(`setup failed: ${result.error}`);
  const status = await store.getStatus(adminToken);
  return { groupId, adminToken, personId: status!.person!.id };
}

async function personRows() {
  return db.select({ name: persons.name, anatomy: persons.anatomy }).from(persons);
}

describe("GroupStore.create", () => {
  it("creates a group with an admin token", async () => {
    const result = await createGroup();
    expect(result.groupId).toBeDefined();
    expect(result.adminToken.length).toBeGreaterThan(10);
  });

  it("stores an encrypted group's key check and returns it with the status, before and after setup", async () => {
    const { adminToken } = await createGroup(true);
    expect((await store.getStatus(adminToken))!.group.keyCheck).toBe(keyCheck);
    await store.setupAdmin(adminToken, { name: fakeEncrypted("alice"), anatomy: null, partners: [] });
    expect((await store.getStatus(adminToken))!.group.keyCheck).toBe(keyCheck);
  });

  it("requires an e: key check for an encrypted group and none for a plaintext one", async () => {
    const base = { questionMode: "all" as const, anatomyLabels: null, anatomyPicker: null };
    for (const input of [
      { encrypted: true, keyCheck: null },
      { encrypted: true, keyCheck: plainSealed<KeyCheck>("group-key-check:1") },
      // A version clients can't open would prove nothing.
      { encrypted: true, keyCheck: "e:2:Y2hlY2s" as Sealed<KeyCheck> },
      { encrypted: false, keyCheck },
    ]) {
      expect(await store.create({ ...base, ...input })).toEqual({ error: "encryption_mismatch" });
    }
    expect(await db.select().from(groups)).toHaveLength(0);
  });
});

describe("GroupStore.setupAdmin", () => {
  it("creates admin + partners and marks ready", async () => {
    const { adminToken } = await createGroup();

    const result = await store.setupAdmin(adminToken, {
      name: alice,
      anatomy: null,
      partners: [{ name: bob, anatomy: null }],
    });

    expect("partnerTokens" in result && result.partnerTokens).toHaveLength(1);

    const status = await store.getStatus(adminToken);
    expect(status).not.toBeNull();
    expect(status!.person!.name).toBe(alice);
    expect(status!.person!.isAdmin).toBe(true);
    expect(status!.members).toHaveLength(2);
    expect(status!.group.isReady).toBe(true);
  });

  it("returns error for invalid token", async () => {
    const result = await store.setupAdmin("bogus", { name: plainSealed("A"), anatomy: null, partners: [] });
    expect(result).toEqual({ error: "not_found" });
  });

  it("returns not_found for double setup (adminToken cleared after first)", async () => {
    const { adminToken } = await createGroup();
    await store.setupAdmin(adminToken, { name: alice, anatomy: null, partners: [] });
    const result = await store.setupAdmin(adminToken, { name: alice, anatomy: null, partners: [] });
    expect(result).toEqual({ error: "not_found" });
  });

  it("validates anatomy in admin-pick filtered mode", async () => {
    const { adminToken } = await createGroup(false, {
      questionMode: "filtered",
      anatomyLabels: "anatomical",
      anatomyPicker: "admin",
    });
    const result = await store.setupAdmin(adminToken, { name: alice, anatomy: null, partners: [] });
    expect(result).toEqual({ error: "anatomy_required" });
  });

  describe("encryption mode check", () => {
    /** Mismatch must leave the group exactly as created: no persons, not ready, admin token still valid. */
    async function expectNothingWritten(groupId: string, adminToken: string) {
      expect(await personRows()).toEqual([]);
      const [group] = await db.select().from(groups).where(eq(groups.id, groupId));
      expect(group.isReady).toBe(false);
      expect(group.adminToken).toBe(adminToken);
    }

    it("accepts p: values in a plaintext group", async () => {
      const { adminToken } = await createGroup(false);
      const result = await store.setupAdmin(adminToken, {
        name: alice,
        anatomy: afab,
        partners: [{ name: bob, anatomy: null }],
      });
      expect(result).toHaveProperty("partnerTokens");
      expect(await personRows()).toEqual(
        expect.arrayContaining([
          { name: alice, anatomy: afab },
          { name: bob, anatomy: null },
        ]),
      );
    });

    it("accepts e: values in an encrypted group", async () => {
      const { adminToken } = await createGroup(true);
      const name = fakeEncrypted<string>("alice");
      const anatomy = fakeEncrypted<Anatomy>("afab");
      const partner = { name: fakeEncrypted<string>("bob"), anatomy: fakeEncrypted<Anatomy>("amab") };
      const result = await store.setupAdmin(adminToken, { name, anatomy, partners: [partner] });
      expect(result).toHaveProperty("partnerTokens");
      expect(await personRows()).toEqual(expect.arrayContaining([{ name, anatomy }, partner]));
    });

    it.each([
      ["admin name", { name: fakeEncrypted<string>("alice") }, {}],
      ["admin anatomy", { anatomy: fakeEncrypted<Anatomy>("afab") }, {}],
      ["partner name", {}, { name: fakeEncrypted<string>("bob") }],
      ["partner anatomy", {}, { anatomy: fakeEncrypted<Anatomy>("amab") }],
    ])("rejects an e: %s in a plaintext group and writes nothing", async (_label, admin, partner) => {
      const { groupId, adminToken } = await createGroup(false);
      const result = await store.setupAdmin(adminToken, {
        name: alice,
        anatomy: null,
        ...admin,
        partners: [{ name: bob, anatomy: null, ...partner }],
      });
      expect(result).toEqual({ error: "encryption_mismatch" });
      await expectNothingWritten(groupId, adminToken);
    });

    it.each([
      ["admin name", { name: alice }, {}],
      ["admin anatomy", { anatomy: afab }, {}],
      ["partner name", {}, { name: bob }],
      ["partner anatomy", {}, { anatomy: afab }],
    ])("rejects a p: %s in an encrypted group and writes nothing", async (_label, admin, partner) => {
      const { groupId, adminToken } = await createGroup(true);
      const result = await store.setupAdmin(adminToken, {
        name: fakeEncrypted("alice"),
        anatomy: null,
        ...admin,
        partners: [{ name: fakeEncrypted("bob"), anatomy: null, ...partner }],
      });
      expect(result).toEqual({ error: "encryption_mismatch" });
      await expectNothingWritten(groupId, adminToken);
    });

    it("rejects a raw, unsealed name in either mode", async () => {
      // The route's schema rejects these first; the store must not rely on it.
      const raw = "Alice" as Sealed<string>;
      for (const encrypted of [false, true]) {
        const { groupId, adminToken } = await createGroup(encrypted);
        const result = await store.setupAdmin(adminToken, { name: raw, anatomy: null, partners: [] });
        expect(result).toEqual({ error: "encryption_mismatch" });
        await expectNothingWritten(groupId, adminToken);
      }
    });
  });
});

describe("GroupStore.addPerson", () => {
  it("adds a person whose values match a plaintext group", async () => {
    const { groupId } = await setupGroup(false);
    const result = await store.addPerson(groupId, { name: bob, anatomy: afab, isAdmin: false }, false);
    if ("error" in result) throw new Error(result.error);
    const [row] = await db.select().from(persons).where(eq(persons.id, result.personId));
    expect(row).toMatchObject({ name: bob, anatomy: afab, token: result.token, isAdmin: false });
  });

  it("adds a person whose values match an encrypted group", async () => {
    const { groupId } = await setupGroup(true);
    const name = fakeEncrypted<string>("bob");
    const result = await store.addPerson(groupId, { name, anatomy: null, isAdmin: false }, true);
    if ("error" in result) throw new Error(result.error);
    const [row] = await db.select().from(persons).where(eq(persons.id, result.personId));
    expect(row).toMatchObject({ name, anatomy: null });
  });

  it.each([
    ["an e: name in a plaintext group", false, { name: fakeEncrypted<string>("bob"), anatomy: null }],
    ["an e: anatomy in a plaintext group", false, { name: bob, anatomy: fakeEncrypted<Anatomy>("amab") }],
    ["a p: name in an encrypted group", true, { name: bob, anatomy: null }],
    ["a p: anatomy in an encrypted group", true, { name: fakeEncrypted<string>("bob"), anatomy: afab }],
  ])("rejects %s and writes nothing", async (_label, encrypted, profile) => {
    const { groupId } = await setupGroup(encrypted);
    const before = await personRows();
    const result = await store.addPerson(groupId, { ...profile, isAdmin: false }, encrypted);
    expect(result).toEqual({ error: "encryption_mismatch" });
    expect(await personRows()).toEqual(before);
  });
});

describe("GroupStore.setProfile", () => {
  it("updates name and anatomy in a plaintext group", async () => {
    const { personId } = await setupGroup(false);
    const name = plainSealed("Alicia");
    expect(await store.setProfile(personId, { name, anatomy: afab }, false)).toEqual({ ok: true });
    expect(await personRows()).toEqual([{ name, anatomy: afab }]);
  });

  it("updates name and anatomy in an encrypted group", async () => {
    const { personId } = await setupGroup(true);
    const name = fakeEncrypted<string>("alicia");
    const anatomy = fakeEncrypted<Anatomy>("afab");
    expect(await store.setProfile(personId, { name, anatomy }, true)).toEqual({ ok: true });
    expect(await personRows()).toEqual([{ name, anatomy }]);
  });

  it("accepts null anatomy in either mode", async () => {
    for (const encrypted of [false, true]) {
      const { personId } = await setupGroup(encrypted);
      const name = encrypted ? fakeEncrypted<string>("alicia") : plainSealed("Alicia");
      expect(await store.setProfile(personId, { name, anatomy: null }, encrypted)).toEqual({ ok: true });
      const [row] = await db.select().from(persons).where(eq(persons.id, personId));
      expect(row).toMatchObject({ name, anatomy: null });
    }
  });

  it.each([
    ["an e: name in a plaintext group", false, { name: fakeEncrypted<string>("alicia"), anatomy: null }],
    ["an e: anatomy in a plaintext group", false, { name: alice, anatomy: fakeEncrypted<Anatomy>("afab") }],
    ["a p: name in an encrypted group", true, { name: alice, anatomy: null }],
    ["a p: anatomy in an encrypted group", true, { name: fakeEncrypted<string>("alicia"), anatomy: afab }],
  ])("rejects %s and leaves the row unchanged", async (_label, encrypted, profile) => {
    const { personId } = await setupGroup(encrypted);
    const before = await personRows();
    expect(await store.setProfile(personId, profile, encrypted)).toEqual({ error: "encryption_mismatch" });
    expect(await personRows()).toEqual(before);
  });
});

describe("GroupStore.getStatus", () => {
  it("returns null for invalid token", async () => {
    const status = await store.getStatus("nonexistent");
    expect(status).toBeNull();
  });

  it("returns admin setup status for pre-setup token", async () => {
    const { adminToken } = await createGroup();
    const status = await store.getStatus(adminToken);
    expect(status).not.toBeNull();
    expect(status!.person).toBeNull();
    expect(status!.members).toHaveLength(0);
  });

  it("computes isReady from anatomy in filtered mode", async () => {
    const { adminToken } = await createGroup(false, {
      questionMode: "filtered",
      anatomyLabels: "anatomical",
      anatomyPicker: "self",
    });
    await store.setupAdmin(adminToken, {
      name: alice,
      anatomy: afab,
      partners: [{ name: bob, anatomy: null }],
    });
    const status = await store.getStatus(adminToken);
    expect(status!.group.isReady).toBe(false);
    expect(status!.group.isAdminReady).toBe(true);
  });

  it("returns sealed fields exactly as stored", async () => {
    const { adminToken, personId } = await setupGroup(true);
    const name = fakeEncrypted<string>("alicia");
    const anatomy = fakeEncrypted<Anatomy>("afab");
    const progress = fakeEncrypted("progress-1-of-10");
    await store.setProfile(personId, { name, anatomy }, true);
    await db.update(persons).set({ progress }).where(eq(persons.id, personId));

    const status = await store.getStatus(adminToken);
    expect(status!.person).toMatchObject({ name, anatomy });
    expect(status!.members).toEqual([expect.objectContaining({ name, anatomy, progress })]);
  });

  it("returns p: progress as stored too", async () => {
    const { adminToken, personId } = await setupGroup(false);
    const progress = plainProgress({ answered: 3, total: 10 });
    await db.update(persons).set({ progress }).where(eq(persons.id, personId));
    const status = await store.getStatus(adminToken);
    expect(status!.members[0].progress).toBe(progress);
  });
});

describe("GroupStore.removePerson", () => {
  it("removes a person with no journal entries", async () => {
    const { adminToken } = await createGroup();
    const setup = await store.setupAdmin(adminToken, {
      name: alice,
      anatomy: null,
      partners: [{ name: bob, anatomy: null }],
    });
    if ("error" in setup) throw new Error("setup failed");

    const status = await store.getStatus(setup.partnerTokens[0]);
    const bobId = status!.person!.id;
    const aliceStatus = await store.getStatus(adminToken);
    const aliceId = aliceStatus!.person!.id;

    // Need to un-ready the group first since removePerson is called from adminProcedure
    // which checks isReady at the route level. Store doesn't check this.
    const result = await store.removePerson(aliceStatus!.group.id, bobId, aliceId);
    expect(result).toEqual({ ok: true });
  });

  it("rejects removing person with journal entries", async () => {
    const { adminToken } = await createGroup();
    const setup = await store.setupAdmin(adminToken, {
      name: alice,
      anatomy: null,
      partners: [{ name: bob, anatomy: null }],
    });
    if ("error" in setup) throw new Error("setup failed");

    const status = await store.getStatus(setup.partnerTokens[0]);
    const bobId = status!.person!.id;
    const aliceStatus = await store.getStatus(adminToken);

    await db.insert(journalEntries).values({ personId: bobId, operation: "p:1:test" });

    const result = await store.removePerson(aliceStatus!.group.id, bobId, aliceStatus!.person!.id);
    expect(result).toEqual({ error: "has_entries" });
  });

  it("rejects self-removal", async () => {
    const { adminToken } = await createGroup();
    await store.setupAdmin(adminToken, { name: alice, anatomy: null, partners: [] });
    const status = await store.getStatus(adminToken);

    const result = await store.removePerson(status!.group.id, status!.person!.id, status!.person!.id);
    expect(result).toEqual({ error: "self_remove" });
  });
});
