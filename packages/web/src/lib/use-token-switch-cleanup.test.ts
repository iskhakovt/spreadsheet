/** @vitest-environment happy-dom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { wsClose } = vi.hoisted(() => ({ wsClose: vi.fn() }));

vi.mock("./trpc.js", () => ({
  wsClient: { close: wsClose },
}));

const { useTokenSwitchCleanup } = await import("./use-token-switch-cleanup.js");

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  wsClose.mockReset();
});

describe("useTokenSwitchCleanup", () => {
  it("does nothing on initial mount", () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => useTokenSwitchCleanup("token-A"), { wrapper: makeWrapper(qc) });
    expect(invalidate).not.toHaveBeenCalled();
    expect(wsClose).not.toHaveBeenCalled();
  });

  it("does nothing when re-rendered with the same token", () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { rerender } = renderHook(({ t }) => useTokenSwitchCleanup(t), {
      wrapper: makeWrapper(qc),
      initialProps: { t: "token-A" },
    });
    rerender({ t: "token-A" });
    expect(invalidate).not.toHaveBeenCalled();
    expect(wsClose).not.toHaveBeenCalled();
  });

  it("on token change: closes the WS and invalidates groups, sync, questions", () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { rerender } = renderHook(({ t }) => useTokenSwitchCleanup(t), {
      wrapper: makeWrapper(qc),
      initialProps: { t: "token-A" },
    });

    rerender({ t: "token-B" });

    expect(wsClose).toHaveBeenCalledOnce();
    // groups.status has no token in its input, so its cache key is shared
    // across persons. Without this invalidation, useLiveStatus() would
    // serve the previous person's status to the new tab session until the
    // next WS push lands.
    const calls = invalidate.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual({ queryKey: [["groups"]] });
    expect(calls).toContainEqual({ queryKey: [["sync"]] });
    expect(calls).toContainEqual({ queryKey: [["questions"]] });
  });

  it("does not re-fire when the token changes back to the previous value of the SAME render's prevRef", () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { rerender } = renderHook(({ t }) => useTokenSwitchCleanup(t), {
      wrapper: makeWrapper(qc),
      initialProps: { t: "token-A" },
    });

    rerender({ t: "token-B" });
    invalidate.mockClear();
    wsClose.mockClear();

    rerender({ t: "token-B" });
    expect(invalidate).not.toHaveBeenCalled();
    expect(wsClose).not.toHaveBeenCalled();
  });
});
