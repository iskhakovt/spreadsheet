/** @vitest-environment happy-dom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setSession } from "./session.js";
import { getPendingOps, setPendingOps } from "./storage.js";

const { pushFn, markCompleteFn, navigate } = vi.hoisted(() => ({
  pushFn: vi.fn(),
  markCompleteFn: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("./trpc.js", () => ({
  useTRPC: () => ({
    sync: {
      push: { mutationOptions: () => ({ mutationFn: pushFn }) },
      markComplete: {
        mutationOptions: (opts?: { onSuccess?: () => void }) => ({
          mutationFn: markCompleteFn,
          onSuccess: opts?.onSuccess,
        }),
      },
    },
    groups: {
      status: { pathKey: () => ["groups", "status"] as const },
    },
  }),
}));

vi.mock("wouter", () => ({
  useLocation: () => [undefined, navigate],
}));

const { useMarkComplete } = await import("./use-mark-complete.js");

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

const token = "test-token-" + Math.random().toString(36).slice(2);

beforeEach(() => {
  setSession(token);
  localStorage.clear();
  pushFn.mockReset();
  markCompleteFn.mockReset();
  navigate.mockReset();
  pushFn.mockResolvedValue({ stoken: "s", pushRejected: false, entries: [] });
  markCompleteFn.mockResolvedValue(undefined);
});

describe("useMarkComplete", () => {
  it("flushes pending ops, then marks complete, then navigates to /waiting", async () => {
    setPendingOps(["op1", "op2"]);

    const callOrder: string[] = [];
    pushFn.mockImplementation(async () => {
      callOrder.push("push");
      return { stoken: "s", pushRejected: false, entries: [] };
    });
    markCompleteFn.mockImplementation(async () => {
      callOrder.push("markComplete");
    });
    navigate.mockImplementation((path: string) => {
      callOrder.push(`navigate:${path}`);
    });

    const { result } = renderHook(() => useMarkComplete(), { wrapper });

    await act(async () => {
      await result.current();
    });

    expect(callOrder).toEqual(["push", "markComplete", "navigate:/waiting"]);
    expect(pushFn.mock.calls[0][0]).toMatchObject({ operations: ["op1", "op2"] });
    expect(getPendingOps()).toEqual([]);
  });

  it("skips push when there are no pending ops, still marks complete + navigates", async () => {
    const { result } = renderHook(() => useMarkComplete(), { wrapper });

    await act(async () => {
      await result.current();
    });

    expect(pushFn).not.toHaveBeenCalled();
    expect(markCompleteFn).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/waiting");
  });

  it("does NOT mark complete or navigate if push fails — ops stay queued", async () => {
    setPendingOps(["op1"]);
    pushFn.mockRejectedValue(new Error("network"));

    const { result } = renderHook(() => useMarkComplete(), { wrapper });

    await act(async () => {
      await expect(result.current()).rejects.toThrow("network");
    });

    expect(markCompleteFn).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(getPendingOps()).toEqual(["op1"]);
  });

  it("re-entrancy guard: concurrent calls don't double-fire push/markComplete", async () => {
    setPendingOps(["op1"]);

    // Hold push in flight so the second call collides with the first.
    let resolvePush!: (v: unknown) => void;
    pushFn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePush = resolve;
        }),
    );

    const { result } = renderHook(() => useMarkComplete(), { wrapper });

    let first!: Promise<void>;
    act(() => {
      first = result.current();
    });

    // Second call arrives while the first is still awaiting push — should
    // bail immediately via inFlightRef.
    await act(async () => {
      await result.current();
    });
    expect(pushFn).toHaveBeenCalledTimes(1);
    expect(markCompleteFn).not.toHaveBeenCalled();

    await act(async () => {
      resolvePush({ stoken: "s", pushRejected: false, entries: [] });
      await first;
    });
    expect(markCompleteFn).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("releases the re-entrancy guard after an error — a retry can proceed", async () => {
    setPendingOps(["op1"]);
    pushFn.mockRejectedValueOnce(new Error("network"));

    const { result } = renderHook(() => useMarkComplete(), { wrapper });

    await act(async () => {
      await expect(result.current()).rejects.toThrow("network");
    });
    expect(markCompleteFn).not.toHaveBeenCalled();

    // Retry: push now succeeds.
    pushFn.mockResolvedValueOnce({ stoken: "s", pushRejected: false, entries: [] });
    await act(async () => {
      await result.current();
    });
    expect(markCompleteFn).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/waiting");
  });

  it("returns a stable callback across re-renders", () => {
    const { result, rerender } = renderHook(() => useMarkComplete(), { wrapper });
    const first = result.current;
    rerender();
    rerender();
    expect(result.current).toBe(first);
  });
});
