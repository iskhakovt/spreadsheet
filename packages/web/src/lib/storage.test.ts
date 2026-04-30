/** @vitest-environment happy-dom */
import type { Answer } from "@spreadsheet/shared";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adoptSession, getScope } from "./session.js";
import {
  addPendingOp,
  addPendingOpForKey,
  clearPendingOps,
  drainPendingOps,
  getPendingOps,
  setAnswer,
  setAnswers,
  setPendingOps,
  useAnswers,
  usePendingOps,
} from "./storage.js";

const token = "test-token-" + Math.random().toString(36).slice(2);
const yes: Answer = { rating: "yes", timing: null, note: null };

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

// Realistic op encoder used to test key-aware dedup. Mirrors the wire
// shape produced by `encodeValue({ key, data: ... })` for plaintext
// groups — a `p:1:` prefix followed by JSON containing `key`.
function plain(key: string, note: string): string {
  return `p:1:${JSON.stringify({ key, data: { rating: "yes", timing: null, note } })}`;
}
function encrypted(label: string): string {
  // Stand-in for `e:1:` ciphertext. The label is opaque to the index —
  // it can't extract a key from this, only the producer can via
  // `addPendingOpForKey`.
  return `e:1:${label}`;
}

describe("addPendingOpForKey — dedup", () => {
  it("replaces an earlier same-key op instead of appending a duplicate", () => {
    addPendingOpForKey(plain("oral:give", "a"), "oral:give");
    addPendingOpForKey(plain("oral:give", "ab"), "oral:give");
    addPendingOpForKey(plain("oral:give", "abc"), "oral:give");
    expect(getPendingOps()).toEqual([plain("oral:give", "abc")]);
  });

  it("keeps ops for distinct keys", () => {
    addPendingOpForKey(plain("oral:give", "a"), "oral:give");
    addPendingOpForKey(plain("kissing:mutual", "b"), "kissing:mutual");
    addPendingOpForKey(plain("oral:give", "aa"), "oral:give");
    expect(getPendingOps()).toEqual([plain("kissing:mutual", "b"), plain("oral:give", "aa")]);
  });

  it("dedups encrypted ops within a session even though the key isn't recoverable from the cipher", () => {
    addPendingOpForKey(encrypted("c1"), "oral:give");
    addPendingOpForKey(encrypted("c2"), "kissing:mutual");
    addPendingOpForKey(encrypted("c3"), "oral:give");
    expect(getPendingOps()).toEqual([encrypted("c2"), encrypted("c3")]);
  });

  it("rebuilds the index from pre-existing p:1: ops on first call after a fresh module state", () => {
    // Simulate an already-populated queue (e.g. left over from a previous
    // session where we don't have an in-memory index yet) by writing
    // through `setPendingOps` — that explicitly clears the index, so the
    // next `addPendingOpForKey` is forced to seed from the queue.
    setPendingOps([plain("oral:give", "x"), plain("kissing:mutual", "y")]);
    addPendingOpForKey(plain("oral:give", "xx"), "oral:give");
    expect(getPendingOps()).toEqual([plain("kissing:mutual", "y"), plain("oral:give", "xx")]);
  });

  it("falls back to append when the indexed position no longer matches (cross-tab race)", () => {
    addPendingOpForKey(plain("oral:give", "a"), "oral:give");
    // Another tab rewrites the queue entirely. Our index believes
    // "oral:give" is at position 0, but the actual op there is now
    // unrelated.
    setPendingOps(["e:1:foreign-tab-op"]);
    // The next keyed enqueue must NOT splice position 0 (which is now
    // someone else's encrypted op). `setPendingOps` cleared the index, so
    // the rebuilt index seeds only from `p:1:` ops in the fresh queue —
    // there are none — and we append safely.
    addPendingOpForKey(plain("oral:give", "b"), "oral:give");
    expect(getPendingOps()).toEqual(["e:1:foreign-tab-op", plain("oral:give", "b")]);
  });

  it("addPendingOp without a key still appends and invalidates the index", () => {
    addPendingOpForKey(plain("oral:give", "a"), "oral:give");
    // A keyless append (legacy path or tests). Subsequent dedup must
    // notice that positions shifted and not splice the wrong op.
    addPendingOp("p:1:other");
    addPendingOpForKey(plain("oral:give", "b"), "oral:give");
    // The first "oral:give" op was at index 0; after the keyless append
    // the index was dropped. Rebuild from the queue picks it back up —
    // the new same-key write replaces it correctly.
    expect(getPendingOps()).toEqual(["p:1:other", plain("oral:give", "b")]);
  });
});

describe("drainPendingOps — keeps the dedup index consistent", () => {
  it("removes drained ops and shifts index entries for survivors", () => {
    addPendingOpForKey(plain("oral:give", "a"), "oral:give"); // pos 0
    addPendingOpForKey(plain("kissing:mutual", "b"), "kissing:mutual"); // pos 1
    addPendingOpForKey(plain("anal:give", "c"), "anal:give"); // pos 2

    drainPendingOps(2);
    expect(getPendingOps()).toEqual([plain("anal:give", "c")]);

    // Survivor's index entry should still be valid: a same-key write
    // dedups against the now-position-0 op, not phantom positions.
    addPendingOpForKey(plain("anal:give", "cc"), "anal:give");
    expect(getPendingOps()).toEqual([plain("anal:give", "cc")]);
  });

  it("over-drain clears the queue entirely", () => {
    addPendingOpForKey(plain("oral:give", "a"), "oral:give");
    drainPendingOps(5);
    expect(getPendingOps()).toEqual([]);
  });
});
