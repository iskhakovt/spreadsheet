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
    const reset = vi.spyOn(qc, "resetQueries");
    renderHook(() => useTokenSwitchCleanup("token-A"), { wrapper: makeWrapper(qc) });
    expect(reset).not.toHaveBeenCalled();
    expect(wsClose).not.toHaveBeenCalled();
  });

  it("does nothing when re-rendered with the same token", () => {
    const qc = new QueryClient();
    const reset = vi.spyOn(qc, "resetQueries");
    const { rerender } = renderHook(({ t }) => useTokenSwitchCleanup(t), {
      wrapper: makeWrapper(qc),
      initialProps: { t: "token-A" },
    });
    rerender({ t: "token-A" });
    expect(reset).not.toHaveBeenCalled();
    expect(wsClose).not.toHaveBeenCalled();
  });

  it("on token change: closes the WS and resets groups, sync, questions", () => {
    const qc = new QueryClient();
    const reset = vi.spyOn(qc, "resetQueries");
    const { rerender } = renderHook(({ t }) => useTokenSwitchCleanup(t), {
      wrapper: makeWrapper(qc),
      initialProps: { t: "token-A" },
    });

    rerender({ t: "token-B" });

    expect(wsClose).toHaveBeenCalledOnce();
    // groups.status has no token in its input, so its cache key is shared
    // across persons. Reset (not invalidate) — invalidate keeps the previous
    // data in the cache until refetch lands, leaking person-A's name /
    // anatomy / completion state into person-B's tab during the round-trip.
    const calls = reset.mock.calls.map((c) => c[0]);
    expect(calls).toContainEqual({ queryKey: [["groups"]] });
    expect(calls).toContainEqual({ queryKey: [["sync"]] });
    expect(calls).toContainEqual({ queryKey: [["questions"]] });
    // Hand-rolled flat keys for the derived self-journal + comparison
    // slots — these don't match the nested-array `[["sync"]]` prefix
    // above, so they need explicit resets.
    expect(calls).toContainEqual({ queryKey: ["sync", "self-journal"] });
    expect(calls).toContainEqual({ queryKey: ["sync", "journal", "derived"] });
  });

  it("removes the cached data immediately (no leak window)", () => {
    const qc = new QueryClient();
    qc.setQueryData([["groups", "status"]], { person: { name: "Alice" }, group: { id: "g1" } });
    qc.setQueryData([["sync", "journal"]], { entries: [{ key: "secret" }] });
    // Flat-key slots for the hand-rolled derived caches.
    qc.setQueryData(["sync", "self-journal"], { answers: { "q1:mutual": { rating: "yes" } }, cursor: 5 });
    qc.setQueryData(["sync", "journal", "derived"], { entries: [{ id: 1 }] });

    const { rerender } = renderHook(({ t }) => useTokenSwitchCleanup(t), {
      wrapper: makeWrapper(qc),
      initialProps: { t: "token-A" },
    });
    rerender({ t: "token-B" });

    // After reset, the cache no longer has the previous person's data —
    // a stale read pre-refetch returns undefined, not Alice's profile.
    expect(qc.getQueryData([["groups", "status"]])).toBeUndefined();
    expect(qc.getQueryData([["sync", "journal"]])).toBeUndefined();
    // Flat-key slots are also cleared. Without explicit resets these
    // would survive the [["sync"]] nested-array prefix above and leak
    // person-A's answers / journal into person-B's first render.
    expect(qc.getQueryData(["sync", "self-journal"])).toBeUndefined();
    expect(qc.getQueryData(["sync", "journal", "derived"])).toBeUndefined();
  });
});
