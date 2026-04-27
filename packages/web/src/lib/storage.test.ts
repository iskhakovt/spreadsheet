/** @vitest-environment happy-dom */
import type { Answer } from "@spreadsheet/shared";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adoptSession, getScope } from "./session.js";
import {
  addPendingOp,
  clearPendingOps,
  setAnswer,
  setAnswers,
  setPendingOps,
  useAnswers,
  usePendingOps,
} from "./storage.js";

const token = "test-token-" + Math.random().toString(36).slice(2);
const yes: Answer = { rating: "yes", timing: null };

beforeEach(() => {
  // Each test gets a fresh session scope + clean localStorage for that scope.
  adoptSession(token);
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("useAnswers", () => {
  it("returns stable reference across re-renders when the store hasn't changed", () => {
    const { result, rerender } = renderHook(() => useAnswers());
    const first = result.current;
    rerender();
    rerender();
    // Identity invariant — the whole point of the useSyncExternalStore
    // refactor. Without stable identity, downstream useMemo deps invalidate
    // each render.
    expect(result.current).toBe(first);
  });

  it("returns a new reference after setAnswer invalidates the cache", () => {
    const { result } = renderHook(() => useAnswers());
    const before = result.current;
    expect(before).toEqual({});

    act(() => {
      setAnswer("q1:mutual", yes);
    });

    expect(result.current).not.toBe(before);
    expect(result.current).toEqual({ "q1:mutual": yes });
  });

  it("propagates setAnswers writes to subscribed components", () => {
    const { result } = renderHook(() => useAnswers());
    expect(result.current).toEqual({});

    act(() => {
      setAnswers({ "q1:give": yes, "q1:receive": yes });
    });

    expect(result.current).toEqual({ "q1:give": yes, "q1:receive": yes });
  });

  it("picks up cross-tab changes via the native storage event", () => {
    const { result } = renderHook(() => useAnswers());
    expect(result.current).toEqual({});

    // Simulate a write from another tab — same origin, different tab writes
    // localStorage then the browser fires `storage` on every other tab.
    const fullKey = getScope() + "answers";
    act(() => {
      localStorage.setItem(fullKey, JSON.stringify({ cross: yes }));
      window.dispatchEvent(new StorageEvent("storage", { key: fullKey }));
    });

    expect(result.current).toEqual({ cross: yes });
  });
});

describe("usePendingOps", () => {
  it("returns stable reference across re-renders when the store hasn't changed", () => {
    const { result, rerender } = renderHook(() => usePendingOps());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("updates after addPendingOp / clearPendingOps", () => {
    const { result } = renderHook(() => usePendingOps());
    expect(result.current).toEqual([]);

    act(() => {
      addPendingOp("p:1:op1");
    });
    expect(result.current).toEqual(["p:1:op1"]);

    act(() => {
      addPendingOp("p:1:op2");
    });
    expect(result.current).toEqual(["p:1:op1", "p:1:op2"]);

    act(() => {
      clearPendingOps();
    });
    expect(result.current).toEqual([]);
  });

  it("updates after setPendingOps replaces the whole list", () => {
    const { result } = renderHook(() => usePendingOps());
    act(() => setPendingOps(["a", "b", "c"]));
    expect(result.current).toEqual(["a", "b", "c"]);
  });
});
