import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/index.js";
import { journalEntries } from "../db/schema.js";
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

describe("GroupStore.create", () => {
  it("creates a group with an admin token", async () => {
    const result = await store.create({
      encrypted: false,
      questionMode: "all",
      showTiming: true,
      anatomyLabels: null,
      anatomyPicker: null,
    });
    expect(result.groupId).toBeDefined();
    expect(result.adminToken.length).toBeGreaterThan(10);
  });
});

describe("GroupStore.setupAdmin", () => {
  it("creates admin + partners and marks ready", async () => {
    const { adminToken } = await store.create({
      encrypted: false,
      questionMode: "all",
      showTiming: true,
      anatomyLabels: null,
      anatomyPicker: null,
    });

    const result = await store.setupAdmin(adminToken, {
      name: "Alice",
      anatomy: null,
      partners: [{ name: "Bob", anatomy: null }],
    });

    expect("partnerTokens" in result && result.partnerTokens).toHaveLength(1);

    const status = await store.getStatus(adminToken);
    expect(status).not.toBeNull();
    expect(status!.person!.name).toBe("Alice");
    expect(status!.person!.isAdmin).toBe(true);
    expect(status!.members).toHaveLength(2);
    expect(status!.group.isReady).toBe(true);
  });

  it("returns error for invalid token", async () => {
    const result = await store.setupAdmin("bogus", { name: "A", anatomy: null, partners: [] });
    expect(result).toEqual({ error: "not_found" });
  });

  it("returns not_found for double setup (adminToken cleared after first)", async () => {
    const { adminToken } = await store.create({
      encrypted: false,
      questionMode: "all",
      showTiming: true,
      anatomyLabels: null,
      anatomyPicker: null,
    });
    await store.setupAdmin(adminToken, { name: "Alice", anatomy: null, partners: [] });
    const result = await store.setupAdmin(adminToken, { name: "Alice", anatomy: null, partners: [] });
    expect(result).toEqual({ error: "not_found" });
  });

  it("validates anatomy in admin-pick filtered mode", async () => {
    const { adminToken } = await store.create({
      encrypted: false,
      questionMode: "filtered",
      showTiming: true,
      anatomyLabels: "anatomical",
      anatomyPicker: "admin",
    });
    const result = await store.setupAdmin(adminToken, { name: "Alice", anatomy: null, partners: [] });
    expect(result).toEqual({ error: "anatomy_required" });
  });
});

describe("GroupStore.getStatus", () => {
  it("returns null for invalid token", async () => {
    const status = await store.getStatus("nonexistent");
    expect(status).toBeNull();
  });

  it("returns admin setup status for pre-setup token", async () => {
    const { adminToken } = await store.create({
      encrypted: false,
      questionMode: "all",
      showTiming: true,
      anatomyLabels: null,
      anatomyPicker: null,
    });
    const status = await store.getStatus(adminToken);
    expect(status).not.toBeNull();
    expect(status!.person).toBeNull();
    expect(status!.members).toHaveLength(0);
  });

  it("computes isReady from anatomy in filtered mode", async () => {
    const { adminToken } = await store.create({
      encrypted: false,
      questionMode: "filtered",
      showTiming: true,
      anatomyLabels: "anatomical",
      anatomyPicker: "self",
    });
    await store.setupAdmin(adminToken, {
      name: "Alice",
      anatomy: "afab",
      partners: [{ name: "Bob", anatomy: null }],
    });
    const status = await store.getStatus(adminToken);
    expect(status!.group.isReady).toBe(false);
    expect(status!.group.isAdminReady).toBe(true);
  });
});

describe("GroupStore.removePerson", () => {
  it("removes a person with no journal entries", async () => {
    const { adminToken } = await store.create({
      encrypted: false,
      questionMode: "all",
      showTiming: true,
      anatomyLabels: null,
      anatomyPicker: null,
    });
    const setup = await store.setupAdmin(adminToken, {
      name: "Alice",
      anatomy: null,
      partners: [{ name: "Bob", anatomy: null }],
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
    const { adminToken } = await store.create({
      encrypted: false,
      questionMode: "all",
      showTiming: true,
      anatomyLabels: null,
      anatomyPicker: null,
    });
    const setup = await store.setupAdmin(adminToken, {
      name: "Alice",
      anatomy: null,
      partners: [{ name: "Bob", anatomy: null }],
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
    const { adminToken } = await store.create({
      encrypted: false,
      questionMode: "all",
      showTiming: true,
      anatomyLabels: null,
      anatomyPicker: null,
    });
    await store.setupAdmin(adminToken, { name: "Alice", anatomy: null, partners: [] });
    const status = await store.getStatus(adminToken);

    const result = await store.removePerson(status!.group.id, status!.person!.id, status!.person!.id);
    expect(result).toEqual({ error: "self_remove" });
  });
});
