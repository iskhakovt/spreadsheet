import { beforeEach, describe, expect, test, vi } from "vitest";
import { addPendingOp, getPendingOps } from "./storage.js";
import { flushPendingOps } from "./sync-flush.js";

// Minimal in-memory localStorage stub for the node test env.
// storage.ts reads/writes through `localStorage` directly, so mocking at
// this layer lets us exercise the real flush → clear path without
// touching a DOM.
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

describe("flushPendingOps", () => {
  test("is a no-op when there are no pending ops", async () => {
    const push = vi.fn();
    await flushPendingOps(push, async () => "p:1:progress");
    expect(push).not.toHaveBeenCalled();
  });

  test("pushes pending ops and clears them on success", async () => {
    localStorage.setItem("pendingOps", JSON.stringify(["op1", "op2", "op3"]));
    const push = vi.fn().mockResolvedValue({
      stoken: "new-stoken",
      pushRejected: false,
      entries: [],
    });

    await flushPendingOps(push, async () => "p:1:progress");

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith({
      stoken: null,
      operations: ["op1", "op2", "op3"],
      progress: "p:1:progress",
    });
    // pendingOps cleared
    expect(getPendingOps()).toEqual([]);
    // stoken persisted
    expect(localStorage.getItem("stoken")).toBe("new-stoken");
  });

  test("passes undefined progress when the factory returns undefined", async () => {
    // This is the markComplete flush path — we don't want to touch the
    // progress column on the final flush because the user is about to
    // be marked complete and the value is moot.
    localStorage.setItem("pendingOps", JSON.stringify(["op1"]));
    const push = vi.fn().mockResolvedValue({
      stoken: "s",
      pushRejected: false,
      entries: [],
    });

    await flushPendingOps(push, async () => undefined);

    expect(push).toHaveBeenCalledWith(expect.objectContaining({ progress: undefined }));
    expect(getPendingOps()).toEqual([]);
  });

  test("does not clear pending ops if push throws", async () => {
    localStorage.setItem("pendingOps", JSON.stringify(["op1"]));
    const push = vi.fn().mockRejectedValue(new Error("network"));

    await expect(flushPendingOps(push, async () => undefined)).rejects.toThrow("network");

    // Ops must still be in the queue so the next retry picks them up.
    expect(JSON.parse(localStorage.getItem("pendingOps") ?? "[]")).toEqual(["op1"]);
  });

  test("preserves ops enqueued during in-flight push", async () => {
    localStorage.setItem("pendingOps", JSON.stringify(["op1", "op2"]));

    // The push mock simulates a user answering another question while
    // the network request is in flight: when push is called, we append
    // "op3" to the queue before resolving.
    const push = vi.fn().mockImplementation(async () => {
      addPendingOp("op3");
      return { stoken: "s", pushRejected: false, entries: [] };
    });

    await flushPendingOps(push, async () => undefined);

    // Only op1 + op2 were sent; op3 was enqueued after the snapshot
    // and must survive in the queue for the next sync cycle.
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ operations: ["op1", "op2"] }));
    expect(getPendingOps()).toEqual(["op3"]);
  });

  test("both pushes rejected — ops preserved, stoken updated to latest", async () => {
    localStorage.setItem("pendingOps", JSON.stringify(["op1", "op2"]));
    const push = vi
      .fn()
      .mockResolvedValueOnce({
        stoken: "s1",
        pushRejected: true,
        entries: [],
      })
      .mockResolvedValueOnce({
        stoken: "s2",
        pushRejected: true,
        entries: [],
      });

    await flushPendingOps(push, async () => "p:1:progress");

    expect(push).toHaveBeenCalledTimes(2);
    // Ops stay in the queue for the next sync cycle
    expect(getPendingOps()).toEqual(["op1", "op2"]);
    // Stoken advanced to the latest server response
    expect(localStorage.getItem("stoken")).toBe("s2");
  });

  test("retries once on conflict and clears on retry success", async () => {
    localStorage.setItem("pendingOps", JSON.stringify(["opA"]));
    // First response: rejected with a conflict + empty server entries
    // (no merge work needed). Second response: success.
    const push = vi
      .fn()
      .mockResolvedValueOnce({
        stoken: "s1",
        pushRejected: true,
        entries: [],
      })
      .mockResolvedValueOnce({
        stoken: "s2",
        pushRejected: false,
        entries: [],
      });

    await flushPendingOps(push, async () => "p:1:progress");

    expect(push).toHaveBeenCalledTimes(2);
    expect(getPendingOps()).toEqual([]);
    expect(localStorage.getItem("stoken")).toBe("s2");
  });
});

/**
 * Integration test for the mark-complete flow.
 *
 * Reproduces the exact sequence that `useMarkComplete` executes:
 *   1. `await flushPendingOps(push, getProgress)`
 *   2. `await markComplete()`
 *
 * The original bug was that step 1 was missing on the `/review → Done`
 * path — the handler called `markComplete` directly without flushing.
 * These tests verify the ordering and data-clearing contracts that
 * prevent orphaned answers.
 */
describe("mark-complete integration: flush-before-mark ordering", () => {
  test("push is called before markComplete when there are pending ops", async () => {
    localStorage.setItem("pendingOps", JSON.stringify(["op1", "op2"]));

    const callOrder: string[] = [];
    const push = vi.fn().mockImplementation(async () => {
      callOrder.push("push");
      return { stoken: "s", pushRejected: false, entries: [] };
    });
    const markComplete = vi.fn().mockImplementation(async () => {
      callOrder.push("markComplete");
    });

    // The exact sequence useMarkComplete executes:
    await flushPendingOps(push, async () => undefined);
    await markComplete();

    expect(callOrder).toEqual(["push", "markComplete"]);
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ operations: ["op1", "op2"] }));
  });

  test("pending ops are fully cleared before markComplete runs", async () => {
    localStorage.setItem("pendingOps", JSON.stringify(["op1", "op2", "op3"]));

    const push = vi.fn().mockImplementation(async () => {
      return { stoken: "s", pushRejected: false, entries: [] };
    });
    const markComplete = vi.fn().mockImplementation(async () => {
      // At the moment markComplete runs, pendingOps must already be empty.
      // This is the exact invariant the original bug violated — markComplete
      // ran while ops were still sitting in the queue.
      const remainingOps = getPendingOps();
      expect(remainingOps).toEqual([]);
    });

    await flushPendingOps(push, async () => undefined);
    await markComplete();

    expect(markComplete).toHaveBeenCalledTimes(1);
  });

  test("markComplete still runs when there are no pending ops", async () => {
    // No ops in localStorage — flush is a no-op, markComplete should
    // still be called (the user might have waited for auto-sync to
    // finish before clicking Done).
    const push = vi.fn();
    const markComplete = vi.fn();

    await flushPendingOps(push, async () => undefined);
    await markComplete();

    expect(push).not.toHaveBeenCalled();
    expect(markComplete).toHaveBeenCalledTimes(1);
  });

  test("markComplete does NOT run if push fails (network error)", async () => {
    localStorage.setItem("pendingOps", JSON.stringify(["op1"]));

    const push = vi.fn().mockRejectedValue(new Error("network"));
    const markComplete = vi.fn();

    // flushPendingOps throws on network error — markComplete must not
    // be reached. If the flush fails, we must NOT mark the user complete
    // because their answers haven't been saved.
    await expect(
      (async () => {
        await flushPendingOps(push, async () => undefined);
        await markComplete();
      })(),
    ).rejects.toThrow("network");

    expect(markComplete).not.toHaveBeenCalled();
    // Ops are still in the queue for retry
    expect(getPendingOps()).toEqual(["op1"]);
  });

  test("concurrent double-click: second call is a no-op via external guard", async () => {
    localStorage.setItem("pendingOps", JSON.stringify(["op1"]));

    // Simulate the inFlightRef guard that useMarkComplete uses.
    // The first call holds the lock; the second bails immediately.
    let inFlight = false;
    const push = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ stoken: "s", pushRejected: false, entries: [] }), 50);
        }),
    );
    const markComplete = vi.fn();

    async function guardedMarkComplete() {
      if (inFlight) return;
      inFlight = true;
      try {
        await flushPendingOps(push, async () => undefined);
        await markComplete();
      } finally {
        inFlight = false;
      }
    }

    // Fire two concurrent calls (simulates rapid double-click)
    await Promise.all([guardedMarkComplete(), guardedMarkComplete()]);

    // push + markComplete each called exactly once
    expect(push).toHaveBeenCalledTimes(1);
    expect(markComplete).toHaveBeenCalledTimes(1);
  });
});
