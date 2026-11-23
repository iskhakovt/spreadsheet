/** @vitest-environment happy-dom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { setProfileFn, showBoundary, wrapSensitive } = vi.hoisted(() => ({
  setProfileFn: vi.fn(),
  showBoundary: vi.fn(),
  wrapSensitive: vi.fn(),
}));

vi.mock("./trpc.js", () => ({
  useTRPC: () => ({
    groups: {
      setProfile: { mutationOptions: (opts?: object) => ({ mutationFn: setProfileFn, ...opts }) },
      status: { pathKey: () => ["groups", "status"] as const },
    },
  }),
}));

vi.mock("./crypto.js", () => ({ wrapSensitive }));

vi.mock("react-error-boundary", () => ({ useErrorBoundary: () => ({ showBoundary }) }));

const { useSaveProfile } = await import("./use-save-profile.js");

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  setProfileFn.mockReset().mockResolvedValue({ ok: true });
  showBoundary.mockReset();
  wrapSensitive.mockReset().mockImplementation(async (v: string) => `e:1:wrapped(${v})`);
});

describe("useSaveProfile", () => {
  it("wraps name and anatomy before sending them", async () => {
    const { result } = renderHook(() => useSaveProfile(), { wrapper });
    await act(() => result.current.save({ name: "Alice", anatomy: "afab" }));
    expect(setProfileFn).toHaveBeenCalledTimes(1);
    expect(setProfileFn.mock.calls[0][0]).toEqual({ name: "e:1:wrapped(Alice)", anatomy: "e:1:wrapped(afab)" });
  });

  it("sends null anatomy without wrapping it", async () => {
    const { result } = renderHook(() => useSaveProfile(), { wrapper });
    await act(() => result.current.save({ name: "Alice", anatomy: null }));
    expect(setProfileFn.mock.calls[0][0]).toEqual({ name: "e:1:wrapped(Alice)", anatomy: null });
  });

  it("ignores a second save while the first is still wrapping", async () => {
    // Hold the wrap open: this is the window where the mutation isn't
    // pending yet, so a mutation-state guard alone would let both through.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    wrapSensitive.mockImplementation(async (v: string) => {
      await gate;
      return `e:1:wrapped(${v})`;
    });
    const { result } = renderHook(() => useSaveProfile(), { wrapper });

    // Both clicks land in the same synchronous step, before any re-render,
    // so only a synchronous guard can stop the second.
    let saves!: Promise<void>[];
    act(() => {
      saves = [
        result.current.save({ name: "Alice", anatomy: "afab" }),
        result.current.save({ name: "Alice", anatomy: "amab" }),
      ];
    });
    expect(result.current.saving).toBe(true);

    release();
    await act(() => Promise.all(saves));
    expect(setProfileFn).toHaveBeenCalledTimes(1);
    expect(setProfileFn.mock.calls[0][0].anatomy).toBe("e:1:wrapped(afab)");
    expect(result.current.saving).toBe(false);
  });

  it("sends a wrap failure to the error boundary and allows a retry", async () => {
    const failure = new Error("crypto unavailable");
    wrapSensitive.mockRejectedValueOnce(failure);
    const { result } = renderHook(() => useSaveProfile(), { wrapper });

    await act(() => result.current.save({ name: "Alice", anatomy: null }));
    expect(showBoundary).toHaveBeenCalledWith(failure);
    expect(setProfileFn).not.toHaveBeenCalled();
    expect(result.current.saving).toBe(false);

    await act(() => result.current.save({ name: "Alice", anatomy: null }));
    expect(setProfileFn).toHaveBeenCalledTimes(1);
  });

  it("sends a request failure to the error boundary", async () => {
    const failure = new Error("network down");
    setProfileFn.mockRejectedValueOnce(failure);
    const { result } = renderHook(() => useSaveProfile(), { wrapper });

    await act(() => result.current.save({ name: "Alice", anatomy: null }));
    expect(showBoundary).toHaveBeenCalledWith(failure);
    expect(result.current.saving).toBe(false);
  });
});
