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
    expect("adminAuthToken" in result && result.adminAuthToken).toBeTruthy();

    // Admin auth token should work for getStatus
    if (!("adminAuthToken" in result)) throw new Error("missing adminAuthToken");
    const status = await store.getStatus(result.adminAuthToken);
    expect(status).not.toBeNull();
    expect(status!.person!.name).toBe("Alice");
    expect(status!.person!.isAdmin).toBe(true);
    expect(status!.members).toHaveLength(2);
    expect(status!.group.isReady).toBe(true);
  });

  it("returns admin auth token different from admin token", async () => {
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
      partners: [],
    });

    if ("error" in result) throw new Error("setup failed");
    expect(result.adminAuthToken).not.toBe(adminToken);
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

describe("GroupStore.claimInvite", () => {
  it("generates auth token on first claim", async () => {
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

    const claim = await store.claimInvite(setup.partnerTokens[0]);
    expect("authToken" in claim).toBe(true);
    if ("error" in claim) throw new Error("claim failed");

    // Auth token should differ from invite token
    expect(claim.authToken).not.toBe(setup.partnerTokens[0]);
    expect(claim.authToken.length).toBeGreaterThan(10);
  });

  it("returns already_claimed on repeat claim (one-shot)", async () => {
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

    const first = await store.claimInvite(setup.partnerTokens[0]);
    expect("authToken" in first).toBe(true);

    const second = await store.claimInvite(setup.partnerTokens[0]);
    expect(second).toEqual({ error: "already_claimed" });
  });

  it("returns not_found for invalid invite token", async () => {
    const result = await store.claimInvite("nonexistent");
    expect(result).toEqual({ error: "not_found" });
  });

  it("claimed auth token works with getStatus", async () => {
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

    const claim = await store.claimInvite(setup.partnerTokens[0]);
    if ("error" in claim) throw new Error("claim failed");

    const status = await store.getStatus(claim.authToken);
    expect(status).not.toBeNull();
    expect(status!.person!.name).toBe("Bob");
    expect(status!.person!.isAdmin).toBe(false);
  });

  it("admin cannot use partner invite token for getStatus", async () => {
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

    // Partner invite token (unclaimed) should NOT work for getStatus
    const status = await store.getStatus(setup.partnerTokens[0]);
    expect(status).toBeNull();
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
    const setup = await store.setupAdmin(adminToken, {
      name: "Alice",
      anatomy: "afab",
      partners: [{ name: "Bob", anatomy: null }],
    });
    if ("error" in setup) throw new Error("setup failed");
    const status = await store.getStatus(setup.adminAuthToken);
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

    // Claim Bob's invite token to get his auth token, then look up his status
    const bobClaim = await store.claimInvite(setup.partnerTokens[0]);
    if ("error" in bobClaim) throw new Error("claim failed");
    const bobStatus = await store.getStatus(bobClaim.authToken);
    const bobId = bobStatus!.person!.id;

    const aliceStatus = await store.getStatus(setup.adminAuthToken);
    const aliceId = aliceStatus!.person!.id;

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

    const bobClaim = await store.claimInvite(setup.partnerTokens[0]);
    if ("error" in bobClaim) throw new Error("claim failed");
    const bobStatus = await store.getStatus(bobClaim.authToken);
    const bobId = bobStatus!.person!.id;
    const aliceStatus = await store.getStatus(setup.adminAuthToken);

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
    const setup = await store.setupAdmin(adminToken, { name: "Alice", anatomy: null, partners: [] });
    if ("error" in setup) throw new Error("setup failed");
    const status = await store.getStatus(setup.adminAuthToken);

    const result = await store.removePerson(status!.group.id, status!.person!.id, status!.person!.id);
    expect(result).toEqual({ error: "self_remove" });
  });
});
