/** @vitest-environment happy-dom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSession } from "./session.js";
import { addPendingOp, setPendingOps } from "./storage.js";

const { pushFn } = vi.hoisted(() => ({ pushFn: vi.fn() }));

vi.mock("./trpc.js", () => ({
  useTRPC: () => ({
    sync: {
      push: {
        mutationOptions: () => ({ mutationFn: pushFn }),
      },
    },
  }),
}));

// Stub `encodeValue` so tests don't depend on the real crypto/progress
// encoding — we only care that flushPendingOps is invoked.
vi.mock("./crypto.js", () => ({
  encodeValue: async (value: unknown) => `encoded:${JSON.stringify(value)}`,
}));

// Import AFTER the mocks are registered.
const { useSyncQueue } = await import("./use-sync-queue.js");

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

const token = "test-token-" + Math.random().toString(36).slice(2);

beforeEach(() => {
  setSession(token);
  localStorage.clear();
  pushFn.mockReset();
  pushFn.mockResolvedValue({ stoken: "s", pushRejected: false, entries: [] });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSyncQueue — scheduling", () => {
  it("fires handleSync after 3s when scheduleSync is called with a positive count", async () => {
    setPendingOps(["op1"]);
    const { result } = renderHook(() => useSyncQueue(10), { wrapper });

    act(() => {
      result.current.scheduleSync(1);
    });

    // Nothing yet at 2999ms
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999);
    });
    expect(pushFn).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(pushFn).toHaveBeenCalledTimes(1);
  });

  it("shows the sync indicator after 5s", async () => {
    const { result } = renderHook(() => useSyncQueue(10), { wrapper });

    act(() => {
      result.current.scheduleSync(1);
    });
    expect(result.current.showSyncIndicator).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4999);
    });
    expect(result.current.showSyncIndicator).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.showSyncIndicator).toBe(true);
  });

  it("resets the 3s debounce each time scheduleSync is called", async () => {
    setPendingOps(["op1"]);
    const { result } = renderHook(() => useSyncQueue(10), { wrapper });

    act(() => {
      result.current.scheduleSync(1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    // Second schedule should push the firing time out to t=2000+3000=5000.
    act(() => {
      result.current.scheduleSync(2);
    });

    // At t=4000 (2000 since the second schedule), the first timer would
    // already have fired — but it was cancelled.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(pushFn).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(pushFn).toHaveBeenCalledTimes(1);
  });

  it("clears the timers and hides the indicator when pendingCount is 0", async () => {
    const { result } = renderHook(() => useSyncQueue(10), { wrapper });

    act(() => {
      result.current.scheduleSync(1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(result.current.showSyncIndicator).toBe(true);

    act(() => {
      result.current.scheduleSync(0);
    });
    expect(result.current.showSyncIndicator).toBe(false);

    // Even past the original debounce window, no push should fire.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(pushFn).not.toHaveBeenCalled();
  });

  it("clears pending timers on unmount", async () => {
    setPendingOps(["op1"]);
    const { result, unmount } = renderHook(() => useSyncQueue(10), { wrapper });

    act(() => {
      result.current.scheduleSync(1);
    });
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(pushFn).not.toHaveBeenCalled();
  });
});

describe("useSyncQueue — handleSync re-entrancy", () => {
  it("bails out if handleSync is already in flight", async () => {
    setPendingOps(["op1"]);

    // Hold the first push open with a deferred resolver so we can fire a
    // second handleSync while it's still pending.
    let resolvePush!: (v: unknown) => void;
    pushFn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePush = resolve;
        }),
    );

    const { result } = renderHook(() => useSyncQueue(10), { wrapper });

    let first!: Promise<void>;
    act(() => {
      first = result.current.handleSync();
    });

    // Second call while the first is in flight — should no-op.
    await act(async () => {
      await result.current.handleSync();
    });
    expect(pushFn).toHaveBeenCalledTimes(1);

    // Release the first push.
    await act(async () => {
      resolvePush({ stoken: "s", pushRejected: false, entries: [] });
      await first;
    });

    // A subsequent call after completion should proceed normally.
    addPendingOp("op2");
    await act(async () => {
      await result.current.handleSync();
    });
    expect(pushFn).toHaveBeenCalledTimes(2);
  });
});

describe("useSyncQueue — stable callback identity", () => {
  it("scheduleSync and handleSync keep identity across re-renders", () => {
    const { result, rerender } = renderHook(({ total }) => useSyncQueue(total), {
      wrapper,
      initialProps: { total: 10 },
    });
    const firstSchedule = result.current.scheduleSync;
    const firstHandle = result.current.handleSync;

    rerender({ total: 20 });
    rerender({ total: 20 });

    // Stable identity is what lets callers safely use these in useEffect deps
    // without triggering spurious re-runs.
    expect(result.current.scheduleSync).toBe(firstSchedule);
    expect(result.current.handleSync).toBe(firstHandle);
  });
});
