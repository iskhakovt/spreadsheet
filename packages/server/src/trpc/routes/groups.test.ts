import { afterEach, describe, expect, it, vi } from "vitest";
import { groupEvents } from "../../events.js";
import { silentLogger } from "../../logger.js";
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

const adminPerson = { id: "p1", groupId: "g1", name: "Alice", anatomy: null, isAdmin: true, isCompleted: false };
const readyGroup = {
  id: "g1",
  encrypted: false,
  isReady: true,
  questionMode: "all",
  showTiming: true,
  anatomyLabels: null,
  anatomyPicker: null,
};
const unreadyGroup = { ...readyGroup, isReady: false };

describe("groups.create", () => {
  it("calls store.create and returns result", async () => {
    const ctx = mockCtx({
      groups: { create: vi.fn().mockResolvedValue({ groupId: "g1", adminToken: "tok" }) },
    });
    const caller = createCaller(ctx);
    const result = await caller.groups.create({
      encrypted: false,
      questionMode: "all",
      showTiming: true,
      anatomyLabels: null,
      anatomyPicker: null,
    });
    expect(result).toEqual({ groupId: "g1", adminToken: "tok" });
  });

  it("rejects invalid questionMode", async () => {
    const caller = createCaller(mockCtx({}));
    await expect(
      caller.groups.create({
        encrypted: false,
        // biome-ignore lint/suspicious/noExplicitAny: testing invalid input rejection
        questionMode: "bogus" as any,
        showTiming: true,
        anatomyLabels: null,
        anatomyPicker: null,
      }),
    ).rejects.toThrow();
  });

  it("rejects unencrypted group when REQUIRE_ENCRYPTION is enforced", async () => {
    vi.stubEnv("REQUIRE_ENCRYPTION", "true");
    const caller = createCaller(mockCtx({}));
    await expect(
      caller.groups.create({
        encrypted: false,
        questionMode: "all",
        showTiming: true,
        anatomyLabels: null,
        anatomyPicker: null,
      }),
    ).rejects.toThrow("Encryption is required");
  });
});

describe("groups.setupAdmin", () => {
  it("maps store not_found error to TRPCError", async () => {
    const ctx = mockCtx({
      groups: { setupAdmin: vi.fn().mockResolvedValue({ error: "not_found" }) },
    });
    const caller = createCaller(ctx);
    await expect(caller.groups.setupAdmin({ adminToken: "x", name: "A", anatomy: null, partners: [] })).rejects.toThrow(
      "Invalid admin token",
    );
  });

  it("maps store already_setup error", async () => {
    const ctx = mockCtx({
      groups: { setupAdmin: vi.fn().mockResolvedValue({ error: "already_setup" }) },
    });
    const caller = createCaller(ctx);
    await expect(caller.groups.setupAdmin({ adminToken: "x", name: "A", anatomy: null, partners: [] })).rejects.toThrow(
      "already set up",
    );
  });

  it("maps store anatomy_required error", async () => {
    const ctx = mockCtx({
      groups: { setupAdmin: vi.fn().mockResolvedValue({ error: "anatomy_required" }) },
    });
    const caller = createCaller(ctx);
    await expect(caller.groups.setupAdmin({ adminToken: "x", name: "A", anatomy: null, partners: [] })).rejects.toThrow(
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
      name: "A",
      anatomy: null,
      partners: [{ name: "B", anatomy: null }],
    });
    expect(result.partnerTokens).toEqual(["t1"]);
  });
});

describe("groups.addPerson", () => {
  it("rejects if group is ready", async () => {
    const ctx = mockCtx({ person: adminPerson, group: readyGroup });
    const caller = createCaller(ctx);
    await expect(caller.groups.addPerson({ name: "Bob", anatomy: null, isAdmin: false })).rejects.toThrow(
      "marked ready",
    );
  });

  it("calls store when group is not ready", async () => {
    const addPerson = vi.fn().mockResolvedValue({ personId: "p2", token: "t2" });
    const ctx = mockCtx({ person: adminPerson, group: unreadyGroup, groups: { addPerson } });
    const caller = createCaller(ctx);
    const result = await caller.groups.addPerson({ name: "Bob", anatomy: null, isAdmin: false });
    expect(result.token).toBe("t2");
    expect(addPerson).toHaveBeenCalledWith("g1", { name: "Bob", anatomy: null, isAdmin: false });
  });

  it("requires admin (rejects non-admin)", async () => {
    const ctx = mockCtx({
      person: { ...adminPerson, isAdmin: false },
      group: unreadyGroup,
    });
    const caller = createCaller(ctx);
    await expect(caller.groups.addPerson({ name: "Bob", anatomy: null, isAdmin: false })).rejects.toThrow(
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

describe("groups.setProfile", () => {
  it("requires auth (rejects anon)", async () => {
    const caller = createCaller(mockCtx({}));
    await expect(caller.groups.setProfile({ name: "Bob", anatomy: null })).rejects.toThrow(
      "Invalid or missing person token",
    );
  });

  it("calls store when authenticated", async () => {
    const setProfile = vi.fn().mockResolvedValue(undefined);
    const ctx = mockCtx({ person: adminPerson, group: readyGroup, groups: { setProfile } });
    const caller = createCaller(ctx);
    await caller.groups.setProfile({ name: "Bob", anatomy: "amab" });
    expect(setProfile).toHaveBeenCalledWith("p1", { name: "Bob", anatomy: "amab" });
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
    const setProfile = vi.fn().mockResolvedValue(undefined);
    const handler = vi.fn();
    groupEvents.on("group:g1", handler);
    const ctx = mockCtx({ person: adminPerson, group: readyGroup, groups: { setProfile } });
    const caller = createCaller(ctx);
    await caller.groups.setProfile({ name: "B", anatomy: null });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("emits group event after successful addPerson", async () => {
    const addPerson = vi.fn().mockResolvedValue({ personId: "p2", token: "t2" });
    const handler = vi.fn();
    groupEvents.on("group:g1", handler);
    const ctx = mockCtx({ person: adminPerson, group: unreadyGroup, groups: { addPerson } });
    const caller = createCaller(ctx);
    await caller.groups.addPerson({ name: "Bob", anatomy: null, isAdmin: false });
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
    await expect(caller.groups.setProfile({ name: "B", anatomy: null })).rejects.toThrow("db down");
    expect(handler).not.toHaveBeenCalled();
  });

  it("does NOT emit when addPerson is rejected by isReady guard (BAD_REQUEST)", async () => {
    const addPerson = vi.fn();
    const handler = vi.fn();
    groupEvents.on("group:g1", handler);
    const ctx = mockCtx({ person: adminPerson, group: readyGroup, groups: { addPerson } });
    const caller = createCaller(ctx);
    await expect(caller.groups.addPerson({ name: "Bob", anatomy: null, isAdmin: false })).rejects.toThrow();
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
