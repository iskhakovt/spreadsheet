import { type Anatomy, fakeEncrypted, type KeyCheck, plainSealed, type Sealed } from "@spreadsheet/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { groupEvents } from "../../events.js";
import { silentLogger } from "../../logger.js";
import { groupsSetupCompletedCounter } from "../../metrics.js";
import type { TrpcContext } from "../context.js";
import { createCallerFactory } from "../init.js";
import { appRouter } from "../router.js";

const createCaller = createCallerFactory(appRouter);

afterEach(() => {
  groupEvents.removeAllListeners();
  vi.unstubAllEnvs();
});

/** Build a mock context with stubbed stores */
function mockCtx(
  overrides: Partial<{
    person: TrpcContext["person"];
    group: TrpcContext["group"];
    groups: Partial<TrpcContext["groups"]>;
    sync: Partial<TrpcContext["sync"]>;
    questions: Partial<TrpcContext["questions"]>;
  }>,
): TrpcContext {
  return {
    groups: {
      create: vi.fn(),
      setupAdmin: vi.fn(),
      addPerson: vi.fn(),
      removePerson: vi.fn(),
      setProfile: vi.fn(),
      fillKeyCheck: vi.fn(),
      markReady: vi.fn(),
      getPersonByToken: vi.fn(),
      getGroupById: vi.fn(),
      getStatus: vi.fn(),
      ...overrides.groups,
    },
    sync: { push: vi.fn(), markComplete: vi.fn(), unmarkComplete: vi.fn(), compare: vi.fn(), ...overrides.sync },
    questions: { list: vi.fn(), seed: vi.fn(), ...overrides.questions },
    person: overrides.person ?? null,
    group: overrides.group ?? null,
    // authedProcedure requires personToken alongside person; default to a
    // dummy when a person is provided so mock-based tests mirror real usage.
    personToken: overrides.person ? "mock-token" : null,
    logger: silentLogger,
  } as unknown as TrpcContext;
}

const adminPerson = {
  id: "p1",
  groupId: "g1",
  name: plainSealed("Alice"),
  anatomy: null,
  isAdmin: true,
  isCompleted: false,
};
const readyGroup = {
  id: "g1",
  encrypted: false,
  keyCheck: null,
  isReady: true,
  questionMode: "all",
  anatomyLabels: null,
  anatomyPicker: null,
};
const unreadyGroup = { ...readyGroup, isReady: false };
const encryptedReadyGroup = { ...readyGroup, encrypted: true };
const encryptedUnreadyGroup = { ...unreadyGroup, encrypted: true };

const A = plainSealed("A");
const B = plainSealed("B");
const bob = plainSealed("Bob");
const amab = plainSealed<Anatomy>("amab");

/** A raw string typed as sealed, to get past the compiler and test the runtime schema. */
function unsealed<T>(value: string): Sealed<T> {
  return value as Sealed<T>;
}

const sealedFormatError = { code: "BAD_REQUEST", message: expect.stringContaining("Expected a sealed value") };
const mismatchError = { code: "BAD_REQUEST", message: "Value encryption does not match group setting" };

describe("groups.create", () => {
  it("calls store.create and returns result", async () => {
    const ctx = mockCtx({
      groups: { create: vi.fn().mockResolvedValue({ groupId: "g1", adminToken: "tok" }) },
    });
    const caller = createCaller(ctx);
    const result = await caller.groups.create({
      encrypted: false,
      questionMode: "all",
      anatomyLabels: null,
      anatomyPicker: null,
      keyCheck: null,
    });
    expect(result).toEqual({ groupId: "g1", adminToken: "tok" });
  });

  it("maps a key check that doesn't match the mode to BAD_REQUEST", async () => {
    const ctx = mockCtx({ groups: { create: vi.fn().mockResolvedValue({ error: "encryption_mismatch" }) } });
    const err = await createCaller(ctx)
      .groups.create({
        encrypted: true,
        questionMode: "all",
        anatomyLabels: null,
        anatomyPicker: null,
        keyCheck: plainSealed<KeyCheck>("group-key-check:1"),
      })
      .catch((e) => e);
    expect(err).toMatchObject(mismatchError);
  });

  it("rejects a key check that isn't a sealed value", async () => {
    const create = vi.fn();
    const err = await createCaller(mockCtx({ groups: { create } }))
      .groups.create({
        encrypted: true,
        questionMode: "all",
        anatomyLabels: null,
        anatomyPicker: null,
        keyCheck: "raw" as Sealed<KeyCheck>,
      })
      .catch((e) => e);
    expect(err).toMatchObject(sealedFormatError);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects invalid questionMode", async () => {
    const caller = createCaller(mockCtx({}));
    await expect(
      caller.groups.create({
        encrypted: false,
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid input rejection
        questionMode: "bogus" as any,
        anatomyLabels: null,
        anatomyPicker: null,
        keyCheck: null,
      }),
    ).rejects.toThrow();
  });

  it("rejects unencrypted group when REQUIRE_ENCRYPTION is enforced", async () => {
    vi.stubEnv("REQUIRE_ENCRYPTION", "true");
    const caller = createCaller(mockCtx({}));
    const err = await caller.groups
      .create({ encrypted: false, questionMode: "all", anatomyLabels: null, anatomyPicker: null, keyCheck: null })
      .catch((e) => e);
    expect(err.message).toBe("Encryption is required");
    expect(err.code).toBe("BAD_REQUEST");
  });
});

describe("groups.setupAdmin", () => {
  it("maps store not_found error to TRPCError", async () => {
    const ctx = mockCtx({
      groups: { setupAdmin: vi.fn().mockResolvedValue({ error: "not_found" }) },
    });
    const caller = createCaller(ctx);
    await expect(caller.groups.setupAdmin({ adminToken: "x", name: A, anatomy: null, partners: [] })).rejects.toThrow(
      "Invalid admin token",
    );
  });

  it("maps store already_setup error", async () => {
    const ctx = mockCtx({
      groups: { setupAdmin: vi.fn().mockResolvedValue({ error: "already_setup" }) },
    });
    const caller = createCaller(ctx);
    await expect(caller.groups.setupAdmin({ adminToken: "x", name: A, anatomy: null, partners: [] })).rejects.toThrow(
      "already set up",
    );
  });

  it("maps store anatomy_required error", async () => {
    const ctx = mockCtx({
      groups: { setupAdmin: vi.fn().mockResolvedValue({ error: "anatomy_required" }) },
    });
    const caller = createCaller(ctx);
    await expect(caller.groups.setupAdmin({ adminToken: "x", name: A, anatomy: null, partners: [] })).rejects.toThrow(
      "Anatomy required",
    );
  });

  it("returns partnerTokens on success", async () => {
    const ctx = mockCtx({
      groups: { setupAdmin: vi.fn().mockResolvedValue({ partnerTokens: ["t1"] }) },
    });
    const caller = createCaller(ctx);
    const result = await caller.groups.setupAdmin({
      adminToken: "x",
      name: A,
      anatomy: null,
      partners: [{ name: B, anatomy: null }],
    });
    expect(result.partnerTokens).toEqual(["t1"]);
  });

  it("does not increment setup counter on store error", async () => {
    const spy = vi.spyOn(groupsSetupCompletedCounter, "inc");
    const ctx = mockCtx({
      groups: { setupAdmin: vi.fn().mockResolvedValue({ error: "not_found" }) },
    });
    await createCaller(ctx)
      .groups.setupAdmin({ adminToken: "x", name: A, anatomy: null, partners: [] })
      .catch(() => {});
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("maps store encryption_mismatch error to BAD_REQUEST", async () => {
    const ctx = mockCtx({
      groups: { setupAdmin: vi.fn().mockResolvedValue({ error: "encryption_mismatch" }) },
    });
    await expect(
      createCaller(ctx).groups.setupAdmin({ adminToken: "x", name: A, anatomy: null, partners: [] }),
    ).rejects.toMatchObject(mismatchError);
  });

  it.each([
    ["admin name", { name: unsealed<string>("Alice") }, {}],
    ["admin anatomy", { anatomy: unsealed<Anatomy>("afab") }, {}],
    ["partner name", {}, { name: unsealed<string>("Bob") }],
    ["partner anatomy", {}, { anatomy: unsealed<Anatomy>("amab") }],
  ])("rejects a raw %s before calling the store", async (_label, admin, partner) => {
    const setupAdmin = vi.fn();
    const ctx = mockCtx({ groups: { setupAdmin } });
    await expect(
      createCaller(ctx).groups.setupAdmin({
        adminToken: "x",
        name: A,
        anatomy: null,
        ...admin,
        partners: [{ name: B, anatomy: null, ...partner }],
      }),
    ).rejects.toMatchObject(sealedFormatError);
    expect(setupAdmin).not.toHaveBeenCalled();
  });

  it("passes sealed values through to the store unchanged", async () => {
    const setupAdmin = vi.fn().mockResolvedValue({ partnerTokens: ["t1"] });
    const ctx = mockCtx({ groups: { setupAdmin } });
    const input = {
      name: fakeEncrypted<string>("alice"),
      anatomy: fakeEncrypted<Anatomy>("afab"),
      partners: [{ name: fakeEncrypted<string>("bob"), anatomy: null }],
    };
    await createCaller(ctx).groups.setupAdmin({ adminToken: "x", ...input });
    expect(setupAdmin).toHaveBeenCalledWith("x", input);
  });

  it("increments setup counter on success", async () => {
    const spy = vi.spyOn(groupsSetupCompletedCounter, "inc");
    const ctx = mockCtx({
      groups: { setupAdmin: vi.fn().mockResolvedValue({ partnerTokens: ["t1"] }) },
    });
    await createCaller(ctx).groups.setupAdmin({ adminToken: "x", name: A, anatomy: null, partners: [] });
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

describe("groups.addPerson", () => {
  it("rejects if group is ready", async () => {
    const ctx = mockCtx({ person: adminPerson, group: readyGroup });
    const caller = createCaller(ctx);
    await expect(caller.groups.addPerson({ name: bob, anatomy: null, isAdmin: false })).rejects.toThrow("marked ready");
  });

  it("calls store when group is not ready", async () => {
    const addPerson = vi.fn().mockResolvedValue({ personId: "p2", token: "t2" });
    const ctx = mockCtx({ person: adminPerson, group: unreadyGroup, groups: { addPerson } });
    const caller = createCaller(ctx);
    const result = await caller.groups.addPerson({ name: bob, anatomy: null, isAdmin: false });
    expect(result.token).toBe("t2");
    expect(addPerson).toHaveBeenCalledWith("g1", { name: bob, anatomy: null, isAdmin: false }, false);
  });

  it("passes the group's encrypted flag to the store", async () => {
    const addPerson = vi.fn().mockResolvedValue({ personId: "p2", token: "t2" });
    const ctx = mockCtx({ person: adminPerson, group: encryptedUnreadyGroup, groups: { addPerson } });
    const name = fakeEncrypted<string>("bob");
    await createCaller(ctx).groups.addPerson({ name, anatomy: null, isAdmin: false });
    expect(addPerson).toHaveBeenCalledWith("g1", { name, anatomy: null, isAdmin: false }, true);
  });

  it("maps store encryption_mismatch error to BAD_REQUEST without broadcasting", async () => {
    const addPerson = vi.fn().mockResolvedValue({ error: "encryption_mismatch" });
    const handler = vi.fn();
    groupEvents.on("group:g1", handler);
    const ctx = mockCtx({ person: adminPerson, group: encryptedUnreadyGroup, groups: { addPerson } });
    await expect(
      createCaller(ctx).groups.addPerson({ name: bob, anatomy: null, isAdmin: false }),
    ).rejects.toMatchObject(mismatchError);
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    ["name", { name: unsealed<string>("Bob"), anatomy: null }],
    ["anatomy", { name: bob, anatomy: unsealed<Anatomy>("amab") }],
  ])("rejects a raw %s before calling the store", async (_label, profile) => {
    const addPerson = vi.fn();
    const ctx = mockCtx({ person: adminPerson, group: unreadyGroup, groups: { addPerson } });
    await expect(createCaller(ctx).groups.addPerson({ ...profile, isAdmin: false })).rejects.toMatchObject(
      sealedFormatError,
    );
    expect(addPerson).not.toHaveBeenCalled();
  });

  it("requires admin (rejects non-admin)", async () => {
    const ctx = mockCtx({
      person: { ...adminPerson, isAdmin: false },
      group: unreadyGroup,
    });
    const caller = createCaller(ctx);
    await expect(caller.groups.addPerson({ name: bob, anatomy: null, isAdmin: false })).rejects.toThrow(
      "Admin access required",
    );
  });
});

describe("groups.removePerson", () => {
  it("maps store errors to TRPCError", async () => {
    const ctx = mockCtx({
      person: adminPerson,
      group: readyGroup,
      groups: { removePerson: vi.fn().mockResolvedValue({ error: "not_found" }) },
    });
    const caller = createCaller(ctx);
    await expect(caller.groups.removePerson({ personId: "a0000000-0000-4000-8000-000000000002" })).rejects.toThrow(
      "not found",
    );
  });

  it("maps self_remove error", async () => {
    const ctx = mockCtx({
      person: adminPerson,
      group: readyGroup,
      groups: { removePerson: vi.fn().mockResolvedValue({ error: "self_remove" }) },
    });
    const caller = createCaller(ctx);
    await expect(caller.groups.removePerson({ personId: "a0000000-0000-4000-8000-000000000001" })).rejects.toThrow(
      "yourself",
    );
  });

  it("maps has_entries error", async () => {
    const ctx = mockCtx({
      person: adminPerson,
      group: readyGroup,
      groups: { removePerson: vi.fn().mockResolvedValue({ error: "has_entries" }) },
    });
    const caller = createCaller(ctx);
    await expect(caller.groups.removePerson({ personId: "a0000000-0000-4000-8000-000000000002" })).rejects.toThrow(
      "submitted answers",
    );
  });
});

describe("groups.fillKeyCheck", () => {
  const keyCheck = fakeEncrypted<KeyCheck>("keycheck");

  it("passes the caller's group and its encrypted flag to the store", async () => {
    const fillKeyCheck = vi.fn().mockResolvedValue({ filled: true });
    const ctx = mockCtx({ person: adminPerson, group: encryptedReadyGroup, groups: { fillKeyCheck } });
    await expect(createCaller(ctx).groups.fillKeyCheck({ keyCheck })).resolves.toEqual({ filled: true });
    expect(fillKeyCheck).toHaveBeenCalledWith("g1", keyCheck, true);
  });

  it("is admin-only: a key check under a wrong key would lock every member out", async () => {
    const fillKeyCheck = vi.fn();
    const ctx = mockCtx({
      person: { ...adminPerson, isAdmin: false },
      group: encryptedReadyGroup,
      groups: { fillKeyCheck },
    });
    await expect(createCaller(ctx).groups.fillKeyCheck({ keyCheck })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fillKeyCheck).not.toHaveBeenCalled();
  });

  it("maps store encryption_mismatch error to BAD_REQUEST", async () => {
    const fillKeyCheck = vi.fn().mockResolvedValue({ error: "encryption_mismatch" });
    const ctx = mockCtx({ person: adminPerson, group: readyGroup, groups: { fillKeyCheck } });
    await expect(createCaller(ctx).groups.fillKeyCheck({ keyCheck })).rejects.toMatchObject(mismatchError);
  });
});

describe("groups.setProfile", () => {
  it("requires auth (rejects anon)", async () => {
    const caller = createCaller(mockCtx({}));
    await expect(caller.groups.setProfile({ name: bob, anatomy: null })).rejects.toThrow(
      "Invalid or missing person token",
    );
  });

  it("calls store when authenticated", async () => {
    const setProfile = vi.fn().mockResolvedValue({ ok: true });
    const ctx = mockCtx({ person: adminPerson, group: readyGroup, groups: { setProfile } });
    const caller = createCaller(ctx);
    await expect(caller.groups.setProfile({ name: bob, anatomy: amab })).resolves.toEqual({ ok: true });
    expect(setProfile).toHaveBeenCalledWith("p1", { name: bob, anatomy: amab }, false);
  });

  it("passes the group's encrypted flag to the store", async () => {
    const setProfile = vi.fn().mockResolvedValue({ ok: true });
    const ctx = mockCtx({ person: adminPerson, group: encryptedReadyGroup, groups: { setProfile } });
    const profile = { name: fakeEncrypted<string>("bob"), anatomy: fakeEncrypted<Anatomy>("amab") };
    await createCaller(ctx).groups.setProfile(profile);
    expect(setProfile).toHaveBeenCalledWith("p1", profile, true);
  });

  it("maps store encryption_mismatch error to BAD_REQUEST", async () => {
    const setProfile = vi.fn().mockResolvedValue({ error: "encryption_mismatch" });
    const ctx = mockCtx({ person: adminPerson, group: encryptedReadyGroup, groups: { setProfile } });
    await expect(createCaller(ctx).groups.setProfile({ name: bob, anatomy: null })).rejects.toMatchObject(
      mismatchError,
    );
  });

  it.each([
    ["name", { name: unsealed<string>("Bob"), anatomy: null }],
    ["anatomy", { name: bob, anatomy: unsealed<Anatomy>("amab") }],
    ["empty name", { name: unsealed<string>(""), anatomy: null }],
  ])("rejects a raw %s before calling the store", async (_label, profile) => {
    const setProfile = vi.fn();
    const ctx = mockCtx({ person: adminPerson, group: readyGroup, groups: { setProfile } });
    await expect(createCaller(ctx).groups.setProfile(profile)).rejects.toMatchObject(sealedFormatError);
    expect(setProfile).not.toHaveBeenCalled();
  });
});

describe("groups.status", () => {
  it("returns stored sealed fields unchanged, including a legacy raw value", async () => {
    // The output schema only checks for strings: the client opens each field
    // and drops what doesn't open, so one bad row can't fail the response.
    const status = {
      person: { id: "p1", name: "e:1:bmFtZQ", anatomy: null, isAdmin: true, isCompleted: false },
      group: { ...readyGroup, encrypted: true, keyCheck: "e:1:Y2hlY2s", isAdminReady: true },
      members: [
        { id: "p1", name: "e:1:bmFtZQ", anatomy: "e:1:YW5h", isAdmin: true, isCompleted: false, progress: null },
        { id: "p2", name: "Legacy raw", anatomy: 'p:1:"afab"', isAdmin: false, isCompleted: false, progress: "p:1:{}" },
      ],
    };
    const ctx = { ...mockCtx({ groups: { getStatus: vi.fn().mockResolvedValue(status) } }), personToken: "tok" };
    await expect(createCaller(ctx).groups.status()).resolves.toEqual(status);
  });
});

describe("groups.markReady", () => {
  it("rejects if already ready", async () => {
    const ctx = mockCtx({ person: adminPerson, group: readyGroup });
    const caller = createCaller(ctx);
    await expect(caller.groups.markReady()).rejects.toThrow("already ready");
  });

  it("calls store when not ready", async () => {
    const markReady = vi.fn().mockResolvedValue(undefined);
    const ctx = mockCtx({ person: adminPerson, group: unreadyGroup, groups: { markReady } });
    const caller = createCaller(ctx);
    await caller.groups.markReady();
    expect(markReady).toHaveBeenCalledWith("g1");
  });
});

describe("broadcasting middleware", () => {
  it("emits group event after successful setProfile", async () => {
    const setProfile = vi.fn().mockResolvedValue({ ok: true });
    const handler = vi.fn();
    groupEvents.on("group:g1", handler);
    const ctx = mockCtx({ person: adminPerson, group: readyGroup, groups: { setProfile } });
    const caller = createCaller(ctx);
    await caller.groups.setProfile({ name: B, anatomy: null });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("emits group event after successful addPerson", async () => {
    const addPerson = vi.fn().mockResolvedValue({ personId: "p2", token: "t2" });
    const handler = vi.fn();
    groupEvents.on("group:g1", handler);
    const ctx = mockCtx({ person: adminPerson, group: unreadyGroup, groups: { addPerson } });
    const caller = createCaller(ctx);
    await caller.groups.addPerson({ name: bob, anatomy: null, isAdmin: false });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("emits group event after successful removePerson", async () => {
    const removePerson = vi.fn().mockResolvedValue({ ok: true });
    const handler = vi.fn();
    groupEvents.on("group:g1", handler);
    const ctx = mockCtx({ person: adminPerson, group: readyGroup, groups: { removePerson } });
    const caller = createCaller(ctx);
    await caller.groups.removePerson({ personId: "a0000000-0000-4000-8000-000000000002" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("emits group event after successful markReady", async () => {
    const markReady = vi.fn().mockResolvedValue(undefined);
    const handler = vi.fn();
    groupEvents.on("group:g1", handler);
    const ctx = mockCtx({ person: adminPerson, group: unreadyGroup, groups: { markReady } });
    const caller = createCaller(ctx);
    await caller.groups.markReady();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does NOT emit when setProfile throws", async () => {
    const setProfile = vi.fn().mockRejectedValue(new Error("db down"));
    const handler = vi.fn();
    groupEvents.on("group:g1", handler);
    const ctx = mockCtx({ person: adminPerson, group: readyGroup, groups: { setProfile } });
    const caller = createCaller(ctx);
    await expect(caller.groups.setProfile({ name: B, anatomy: null })).rejects.toThrow("db down");
    expect(handler).not.toHaveBeenCalled();
  });

  it("does NOT emit when setProfile is rejected for encryption mismatch", async () => {
    const setProfile = vi.fn().mockResolvedValue({ error: "encryption_mismatch" });
    const handler = vi.fn();
    groupEvents.on("group:g1", handler);
    const ctx = mockCtx({ person: adminPerson, group: readyGroup, groups: { setProfile } });
    await expect(createCaller(ctx).groups.setProfile({ name: B, anatomy: null })).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("does NOT emit when addPerson is rejected by isReady guard (BAD_REQUEST)", async () => {
    const addPerson = vi.fn();
    const handler = vi.fn();
    groupEvents.on("group:g1", handler);
    const ctx = mockCtx({ person: adminPerson, group: readyGroup, groups: { addPerson } });
    const caller = createCaller(ctx);
    await expect(caller.groups.addPerson({ name: bob, anatomy: null, isAdmin: false })).rejects.toThrow();
    expect(addPerson).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("does NOT emit when admin check fails", async () => {
    const handler = vi.fn();
    groupEvents.on("group:g1", handler);
    const ctx = mockCtx({
      person: { ...adminPerson, isAdmin: false },
      group: unreadyGroup,
    });
    const caller = createCaller(ctx);
    await expect(caller.groups.markReady()).rejects.toThrow("Admin access required");
    expect(handler).not.toHaveBeenCalled();
  });
});
