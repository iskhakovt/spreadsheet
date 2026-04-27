import { afterEach, describe, expect, it, vi } from "vitest";
import { groupEvents, journalEvents } from "../../events.js";
import { silentLogger } from "../../logger.js";
import { syncPushCounter } from "../../metrics.js";
import type { TrpcContext } from "../context.js";
import { createCallerFactory } from "../init.js";
import { appRouter } from "../router.js";

const createCaller = createCallerFactory(appRouter);

afterEach(() => {
  groupEvents.removeAllListeners();
  journalEvents.removeAllListeners();
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
    sync: {
      push: vi.fn(),
      markComplete: vi.fn(),
      unmarkComplete: vi.fn(),
      journalSince: vi.fn(),
      ...overrides.sync,
    },
    questions: { list: vi.fn(), seed: vi.fn(), ...overrides.questions },
    person: overrides.person ?? null,
    group: overrides.group ?? null,
    // authedProcedure requires personToken alongside person; default to a
    // dummy when a person is provided so mock-based tests mirror real usage.
    personToken: overrides.person ? "mock-token" : null,
    logger: silentLogger,
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

/** Shared test fixture: what a successful sync.push store call returns. */
const pushOk = (entries: { id: number; personId: string; operation: string }[] = []) => ({
  stoken: "s1",
  entries: [],
  committedEntries: entries,
  pushRejected: false as const,
});

/** Shared test fixture: what a conflict-rejected sync.push store call returns. */
const pushConflict = () => ({
  stoken: "s1",
  entries: [],
  committedEntries: [] as { id: number; personId: string; operation: string }[],
  pushRejected: true as const,
});

describe("sync.push", () => {
  it("validates opaque format before calling store", async () => {
    const ctx = mockCtx({ person, group });
    const caller = createCaller(ctx);
    await expect(caller.sync.push({ stoken: null, operations: ["not-opaque"], progress: null })).rejects.toThrow(
      "Invalid operation format",
    );
  });

  it("throws BAD_REQUEST when store returns encryption_mismatch", async () => {
    const push = vi.fn().mockResolvedValue({ error: "encryption_mismatch" });
    const ctx = mockCtx({ person, group, sync: { push } });
    const caller = createCaller(ctx);
    await expect(
      caller.sync.push({
        stoken: null,
        operations: ["e:1:encryptedpayload"],
        progress: null,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Operation encryption does not match group setting" });
  });

  it("passes valid operations to store", async () => {
    const push = vi.fn().mockResolvedValue(pushOk());
    const ctx = mockCtx({ person, group, sync: { push } });
    const caller = createCaller(ctx);
    await caller.sync.push({
      stoken: null,
      operations: ['p:1:{"key":"a:mutual","data":{"rating":"yes","timing":"now"}}'],
      progress: null,
    });
    expect(push).toHaveBeenCalledWith(
      "p1",
      {
        stoken: null,
        operations: ['p:1:{"key":"a:mutual","data":{"rating":"yes","timing":"now"}}'],
        progress: null,
      },
      false,
    );
  });

  it("requires auth", async () => {
    const caller = createCaller(mockCtx({}));
    await expect(caller.sync.push({ stoken: null, operations: [], progress: null })).rejects.toThrow(
      "Invalid or missing person token",
    );
  });

  it("strips committedEntries from the wire response", async () => {
    const committedEntries = [{ id: 1, personId: "p1", operation: "p:1:blob" }];
    const push = vi.fn().mockResolvedValue(pushOk(committedEntries));
    const ctx = mockCtx({ person, group, sync: { push } });
    const caller = createCaller(ctx);
    const result = await caller.sync.push({
      stoken: null,
      operations: ['p:1:{"key":"a:mutual","data":{"rating":"yes","timing":"now"}}'],
      progress: null,
    });
    expect(result).toEqual({ stoken: "s1", entries: [], pushRejected: false });
    expect("committedEntries" in result).toBe(false);
  });

  it("records result=clean label on successful push", async () => {
    const spy = vi.spyOn(syncPushCounter, "inc");
    const ctx = mockCtx({ person, group, sync: { push: vi.fn().mockResolvedValue(pushOk()) } });
    await createCaller(ctx).sync.push({ stoken: null, operations: [], progress: null });
    expect(spy).toHaveBeenCalledWith({ result: "clean" });
    spy.mockRestore();
  });

  it("records result=conflict label on rejected push", async () => {
    const spy = vi.spyOn(syncPushCounter, "inc");
    const ctx = mockCtx({ person, group, sync: { push: vi.fn().mockResolvedValue(pushConflict()) } });
    await createCaller(ctx).sync.push({ stoken: null, operations: [], progress: null });
    expect(spy).toHaveBeenCalledWith({ result: "conflict" });
    spy.mockRestore();
  });
});

describe("sync.push journal bus emission", () => {
  it("emits journal:<groupId> with committed entries on success", async () => {
    const committedEntries = [
      { id: 1, personId: "p1", operation: "p:1:blob1" },
      { id: 2, personId: "p1", operation: "p:1:blob2" },
    ];
    const push = vi.fn().mockResolvedValue(pushOk(committedEntries));
    const handler = vi.fn();
    journalEvents.on("journal:g1", handler);
    const ctx = mockCtx({ person, group, sync: { push } });
    const caller = createCaller(ctx);
    await caller.sync.push({
      stoken: null,
      operations: ['p:1:{"key":"a:mutual","data":{"rating":"yes","timing":"now"}}'],
      progress: null,
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(committedEntries);
  });

  it("does NOT emit on rejected push", async () => {
    const push = vi.fn().mockResolvedValue({
      stoken: "s1",
      entries: ["p:1:serverEntry"],
      committedEntries: [],
      pushRejected: true as const,
    });
    const handler = vi.fn();
    journalEvents.on("journal:g1", handler);
    const ctx = mockCtx({ person, group, sync: { push } });
    const caller = createCaller(ctx);
    await caller.sync.push({ stoken: "stale-stoken", operations: [], progress: null });
    expect(handler).not.toHaveBeenCalled();
  });

  it("does NOT emit on validation error (invalid op format)", async () => {
    const push = vi.fn();
    const handler = vi.fn();
    journalEvents.on("journal:g1", handler);
    const ctx = mockCtx({ person, group, sync: { push } });
    const caller = createCaller(ctx);
    await expect(caller.sync.push({ stoken: null, operations: ["not-opaque"], progress: null })).rejects.toThrow(
      "Invalid operation format",
    );
    expect(push).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("does NOT emit when committedEntries is empty (progress-only push)", async () => {
    const push = vi.fn().mockResolvedValue(pushOk([]));
    const handler = vi.fn();
    journalEvents.on("journal:g1", handler);
    const ctx = mockCtx({ person, group, sync: { push } });
    const caller = createCaller(ctx);
    await caller.sync.push({ stoken: null, operations: [], progress: 'p:1:{"answered":5,"total":10}' });
    expect(handler).not.toHaveBeenCalled();
  });

  it("does NOT emit a groupEvents update on successful push (no status broadcast)", async () => {
    const push = vi.fn().mockResolvedValue(pushOk([{ id: 1, personId: "p1", operation: "p:1:blob" }]));
    const handler = vi.fn();
    groupEvents.on("group:g1", handler);
    const ctx = mockCtx({ person, group, sync: { push } });
    const caller = createCaller(ctx);
    await caller.sync.push({ stoken: null, operations: [], progress: null });
    expect(handler).not.toHaveBeenCalled();
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

describe("sync.journal", () => {
  it("returns data when store succeeds", async () => {
    const data = {
      members: [{ id: "p1", name: "A", anatomy: "afab" }],
      entries: [],
      cursor: null,
    };
    const journalSince = vi.fn().mockResolvedValue(data);
    const ctx = mockCtx({ person, group, sync: { journalSince } });
    const caller = createCaller(ctx);
    const result = await caller.sync.journal({ sinceId: null });
    expect(result).toEqual(data);
    expect(journalSince).toHaveBeenCalledWith("g1", null);
  });

  it("passes sinceId through to the store", async () => {
    const data = { members: [], entries: [], cursor: 42 };
    const journalSince = vi.fn().mockResolvedValue(data);
    const ctx = mockCtx({ person, group, sync: { journalSince } });
    const caller = createCaller(ctx);
    await caller.sync.journal({ sinceId: 42 });
    expect(journalSince).toHaveBeenCalledWith("g1", 42);
  });

  it("defaults sinceId to null when input is omitted", async () => {
    const data = { members: [], entries: [], cursor: null };
    const journalSince = vi.fn().mockResolvedValue(data);
    const ctx = mockCtx({ person, group, sync: { journalSince } });
    const caller = createCaller(ctx);
    await caller.sync.journal();
    expect(journalSince).toHaveBeenCalledWith("g1", null);
  });

  it("throws when store returns not_all_complete", async () => {
    const journalSince = vi.fn().mockResolvedValue({ error: "not_all_complete" });
    const ctx = mockCtx({ person, group, sync: { journalSince } });
    const caller = createCaller(ctx);
    await expect(caller.sync.journal({ sinceId: null })).rejects.toThrow("All group members must mark complete");
  });
});
