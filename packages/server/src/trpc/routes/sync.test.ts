import { afterEach, describe, expect, it, vi } from "vitest";
import { groupEvents } from "../../events.js";
import type { TrpcContext } from "../context.js";
import { createCallerFactory } from "../init.js";
import { appRouter } from "../router.js";

const createCaller = createCallerFactory(appRouter);

afterEach(() => {
  groupEvents.removeAllListeners();
});

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
  } as unknown as TrpcContext;
}

const person = { id: "p1", groupId: "g1", name: "Alice", anatomy: "afab", isAdmin: true, isCompleted: false };
const group = {
  id: "g1",
  encrypted: false,
  isReady: true,
  questionMode: "all",
  showTiming: true,
  anatomyLabels: null,
  anatomyPicker: null,
};

describe("sync.push", () => {
  it("validates opaque format before calling store", async () => {
    const ctx = mockCtx({ person, group });
    const caller = createCaller(ctx);
    await expect(caller.sync.push({ stoken: null, operations: ["not-opaque"], progress: null })).rejects.toThrow(
      "Invalid operation format",
    );
  });

  it("passes valid operations to store", async () => {
    const push = vi.fn().mockResolvedValue({ stoken: "s1", entries: [], pushRejected: false });
    const ctx = mockCtx({ person, group, sync: { push } });
    const caller = createCaller(ctx);
    await caller.sync.push({
      stoken: null,
      operations: ['p:1:{"key":"a:mutual","data":{"rating":"yes","timing":"now"}}'],
      progress: null,
    });
    expect(push).toHaveBeenCalledWith("p1", {
      stoken: null,
      operations: ['p:1:{"key":"a:mutual","data":{"rating":"yes","timing":"now"}}'],
      progress: null,
    });
  });

  it("requires auth", async () => {
    const caller = createCaller(mockCtx({}));
    await expect(caller.sync.push({ stoken: null, operations: [], progress: null })).rejects.toThrow(
      "Invalid or missing person token",
    );
  });
});

describe("sync.markComplete / unmarkComplete", () => {
  it("calls store.markComplete", async () => {
    const markComplete = vi.fn().mockResolvedValue(undefined);
    const ctx = mockCtx({ person, group, sync: { markComplete } });
    const caller = createCaller(ctx);
    await caller.sync.markComplete();
    expect(markComplete).toHaveBeenCalledWith("p1");
  });

  it("calls store.unmarkComplete", async () => {
    const unmarkComplete = vi.fn().mockResolvedValue(undefined);
    const ctx = mockCtx({ person, group, sync: { unmarkComplete } });
    const caller = createCaller(ctx);
    await caller.sync.unmarkComplete();
    expect(unmarkComplete).toHaveBeenCalledWith("p1");
  });

  it("emits group:<id> event after successful markComplete", async () => {
    const markComplete = vi.fn().mockResolvedValue(undefined);
    const handler = vi.fn();
    groupEvents.on("group:g1", handler);
    const ctx = mockCtx({ person, group, sync: { markComplete } });
    const caller = createCaller(ctx);
    await caller.sync.markComplete();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("emits group:<id> event after successful unmarkComplete", async () => {
    const unmarkComplete = vi.fn().mockResolvedValue(undefined);
    const handler = vi.fn();
    groupEvents.on("group:g1", handler);
    const ctx = mockCtx({ person, group, sync: { unmarkComplete } });
    const caller = createCaller(ctx);
    await caller.sync.unmarkComplete();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does NOT emit when markComplete throws", async () => {
    const markComplete = vi.fn().mockRejectedValue(new Error("boom"));
    const handler = vi.fn();
    groupEvents.on("group:g1", handler);
    const ctx = mockCtx({ person, group, sync: { markComplete } });
    const caller = createCaller(ctx);
    await expect(caller.sync.markComplete()).rejects.toThrow("boom");
    expect(handler).not.toHaveBeenCalled();
  });

  it("does NOT emit when caller is unauthenticated", async () => {
    const handler = vi.fn();
    groupEvents.on("group:g1", handler);
    const caller = createCaller(mockCtx({}));
    await expect(caller.sync.markComplete()).rejects.toThrow("Invalid or missing person token");
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("sync.push (no broadcast)", () => {
  it("does NOT emit a group event after successful push", async () => {
    const push = vi.fn().mockResolvedValue({ stoken: "s1", entries: [], pushRejected: false });
    const handler = vi.fn();
    groupEvents.on("group:g1", handler);
    const ctx = mockCtx({ person, group, sync: { push } });
    const caller = createCaller(ctx);
    await caller.sync.push({ stoken: null, operations: [], progress: null });
    expect(push).toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("sync.compare", () => {
  it("returns data when store succeeds", async () => {
    const data = { members: [{ id: "p1", name: "A", anatomy: "afab" }], entries: [] };
    const compare = vi.fn().mockResolvedValue(data);
    const ctx = mockCtx({ person, group, sync: { compare } });
    const caller = createCaller(ctx);
    const result = await caller.sync.compare();
    expect(result).toEqual(data);
    expect(compare).toHaveBeenCalledWith("g1");
  });

  it("throws when store returns not_all_complete", async () => {
    const compare = vi.fn().mockResolvedValue({ error: "not_all_complete" });
    const ctx = mockCtx({ person, group, sync: { compare } });
    const caller = createCaller(ctx);
    await expect(caller.sync.compare()).rejects.toThrow("All group members must mark complete");
  });
});
