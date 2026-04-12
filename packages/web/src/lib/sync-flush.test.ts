import { beforeEach, describe, expect, test, vi } from "vitest";
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
    expect(localStorage.getItem("pendingOps")).toBeNull();
    // stoken persisted
    expect(localStorage.getItem("stoken")).toBe("new-stoken");
  });

  test("passes null progress when the factory returns null", async () => {
    // This is the markComplete flush path — we don't want to touch the
    // progress column on the final flush because the user is about to
    // be marked complete and the value is moot.
    localStorage.setItem("pendingOps", JSON.stringify(["op1"]));
    const push = vi.fn().mockResolvedValue({
      stoken: "s",
      pushRejected: false,
      entries: [],
    });

    await flushPendingOps(push, async () => null);

    expect(push).toHaveBeenCalledWith(expect.objectContaining({ progress: null }));
    expect(localStorage.getItem("pendingOps")).toBeNull();
  });

  test("does not clear pending ops if push throws", async () => {
    localStorage.setItem("pendingOps", JSON.stringify(["op1"]));
    const push = vi.fn().mockRejectedValue(new Error("network"));

    await expect(flushPendingOps(push, async () => null)).rejects.toThrow("network");

    // Ops must still be in the queue so the next retry picks them up.
    expect(JSON.parse(localStorage.getItem("pendingOps") ?? "[]")).toEqual(["op1"]);
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
    expect(localStorage.getItem("pendingOps")).toBeNull();
    expect(localStorage.getItem("stoken")).toBe("s2");
  });
});
