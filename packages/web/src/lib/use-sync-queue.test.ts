/** @vitest-environment happy-dom */
import { type Answer, Progress, plainOp } from "@spreadsheet/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGroupCodec } from "./codec.js";
import { generateGroupKey } from "./crypto.js";
import { adoptSession } from "./session.js";
import { addPendingOp, setAnswer, setPendingOps } from "./storage.js";

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

// Import AFTER the mocks are registered.
const { useSyncQueue } = await import("./use-sync-queue.js");

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

const token = "test-token-" + Math.random().toString(36).slice(2);
// Module-level so the hook's useCallback deps stay stable across renders.
const codec = createGroupCodec(false, null);
const yes: Answer = { rating: "yes", note: null };
const op1 = plainOp("q1:mutual", yes);
const op2 = plainOp("q2:mutual", yes);

beforeEach(() => {
  adoptSession(token);
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
    setPendingOps([op1]);
    const { result } = renderHook(() => useSyncQueue(10, codec), { wrapper });

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
    const { result } = renderHook(() => useSyncQueue(10, codec), { wrapper });

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
    setPendingOps([op1]);
    const { result } = renderHook(() => useSyncQueue(10, codec), { wrapper });

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
    const { result } = renderHook(() => useSyncQueue(10, codec), { wrapper });

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

  it("manual handleSync during a pending debounce flushes immediately and consumes the timer", async () => {
    // The "Sync now" indicator path: while a scheduled push is debouncing,
    // tapping the manual flush should push exactly once — not push manually
    // AND then push again when the debounce timer fires.
    setPendingOps([op1]);
    const { result } = renderHook(() => useSyncQueue(10, codec), { wrapper });

    act(() => {
      result.current.scheduleSync(1);
    });
    // Halfway through the debounce window — manual flush.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    await act(async () => {
      await result.current.handleSync();
    });
    expect(pushFn).toHaveBeenCalledTimes(1);

    // Past the original debounce deadline — no second push.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(pushFn).toHaveBeenCalledTimes(1);
  });

  it("clears pending timers on unmount", async () => {
    setPendingOps([op1]);
    const { result, unmount } = renderHook(() => useSyncQueue(10, codec), { wrapper });

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
    setPendingOps([op1]);

    // Hold the first push open with a deferred resolver so we can fire a
    // second handleSync while it's still pending.
    let resolvePush!: (v: unknown) => void;
    pushFn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePush = resolve;
        }),
    );

    const { result } = renderHook(() => useSyncQueue(10, codec), { wrapper });

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
    addPendingOp(op2);
    await act(async () => {
      await result.current.handleSync();
    });
    expect(pushFn).toHaveBeenCalledTimes(2);
  });
});

describe("useSyncQueue — progress", () => {
  it("seals the progress it pushes with the group's codec", async () => {
    const encrypted = createGroupCodec(true, await generateGroupKey());
    setAnswer("q1:mutual", yes);
    setPendingOps([await encrypted.seal({ key: "q1:mutual", data: yes })]);
    const { result } = renderHook(() => useSyncQueue(10, encrypted), { wrapper });

    await act(async () => {
      await result.current.handleSync();
    });

    expect(pushFn).toHaveBeenCalledTimes(1);
    const { progress } = pushFn.mock.calls[0][0];
    expect(await encrypted.open(progress, Progress)).toEqual({ answered: 1, total: 10 });
  });
});
