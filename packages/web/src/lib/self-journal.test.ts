/** @vitest-environment happy-dom */
import type { Answer } from "@spreadsheet/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeValue } from "./crypto.js";
import { applySelfJournalDelta, makeSelfJournalQueryFn, SELF_JOURNAL_QUERY_KEY, useAnswers } from "./self-journal.js";
import { adoptSession, getScope } from "./session.js";
import {
  addPendingOpForKey,
  clearPendingOps,
  getSelfJournalCursor,
  setAnswer,
  setAnswers,
  setSelfJournalCursor,
} from "./storage.js";

const token = "test-token-" + Math.random().toString(36).slice(2);
const yes: Answer = { rating: "yes", note: null };
const no: Answer = { rating: "no", note: null };
const maybe: Answer = { rating: "maybe", note: null };

async function plainOp(key: string, data: Answer | null): Promise<string> {
  return encodeValue({ key, data }, null);
}

beforeEach(() => {
  adoptSession(token);
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("getSelfJournalCursor / setSelfJournalCursor", () => {
  it("returns null on a fresh device", () => {
    expect(getSelfJournalCursor()).toBe(null);
  });

  it("round-trips a numeric cursor", () => {
    setSelfJournalCursor(42);
    expect(getSelfJournalCursor()).toBe(42);
  });

  it("clears the cursor when set to null", () => {
    setSelfJournalCursor(42);
    setSelfJournalCursor(null);
    expect(getSelfJournalCursor()).toBe(null);
  });

  it("treats malformed cursor values as absent", () => {
    // Write under the SAME scoped key that getSelfJournalCursor reads
    // from — getScope() resolves to `s${fnv1a(token)}:`, the correct
    // length-variable hash. Faking the prefix inline (e.g. `sxxxxxxxx:`)
    // would write to a key the production code never reads, and the
    // assertion would pass vacuously without exercising parsing.
    localStorage.setItem(`${getScope()}selfJournalCursor`, "not-a-number");
    expect(getSelfJournalCursor()).toBe(null);
  });

  it("treats negative or zero cursor values as absent", () => {
    // Defense for the `> 0` branch in getSelfJournalCursor — a 0 or
    // negative id can't be a valid bigserial.
    localStorage.setItem(`${getScope()}selfJournalCursor`, "0");
    expect(getSelfJournalCursor()).toBe(null);
    localStorage.setItem(`${getScope()}selfJournalCursor`, "-5");
    expect(getSelfJournalCursor()).toBe(null);
  });
});

describe("applySelfJournalDelta", () => {
  it("returns prev unchanged on empty delta", async () => {
    const prev = { "a:mutual": yes };
    const next = await applySelfJournalDelta(prev, []);
    expect(next).toBe(prev);
  });

  it("bootstrap: empty prev + entries → server state", async () => {
    const entries = [
      { id: 1, personId: "p", operation: await plainOp("a:mutual", yes) },
      { id: 2, personId: "p", operation: await plainOp("b:give", no) },
    ];
    const next = await applySelfJournalDelta({}, entries);
    expect(next).toEqual({ "a:mutual": yes, "b:give": no });
  });

  it("server values overwrite prev for keys not in the outbox", async () => {
    const prev = { "a:mutual": no };
    const entries = [{ id: 1, personId: "p", operation: await plainOp("a:mutual", yes) }];
    clearPendingOps();
    const next = await applySelfJournalDelta(prev, entries);
    expect(next["a:mutual"]).toEqual(yes);
  });

  it("outbox wins for keys with a pending op", async () => {
    const prev = { "a:mutual": maybe };
    addPendingOpForKey(await plainOp("a:mutual", maybe), "a:mutual");
    // Server says "yes", but pending op says "maybe" — pending wins because
    // the user's local edit hasn't reached the server yet.
    const entries = [{ id: 1, personId: "p", operation: await plainOp("a:mutual", yes) }];
    const next = await applySelfJournalDelta(prev, entries);
    expect(next["a:mutual"]).toEqual(maybe);
  });

  it("server-side null delete propagates to merged via the delta path", async () => {
    // Regression for the bootstrap-vs-delta divergence: previously the
    // merge iterated server-state Object keys and a deleted key was
    // simply absent, so the server's deletion didn't reach `merged`.
    // Now the underlying replay yields a sentinel for deletes and the
    // merge applies them, matching the bootstrap (full-replay) path.
    const prev = { "a:mutual": yes };
    clearPendingOps();
    const entries = [{ id: 1, personId: "p", operation: await plainOp("a:mutual", null) }];
    const next = await applySelfJournalDelta(prev, entries);
    expect(next).not.toHaveProperty("a:mutual");
  });

  it("outbox wins over a server-side delete", async () => {
    // If the user has a pending op for the same key that the server is
    // deleting, the user's local intent must win (not yet pushed).
    const prev = { "a:mutual": yes };
    addPendingOpForKey(await plainOp("a:mutual", maybe), "a:mutual");
    const entries = [{ id: 1, personId: "p", operation: await plainOp("a:mutual", null) }];
    const next = await applySelfJournalDelta(prev, entries);
    expect(next["a:mutual"]).toEqual(yes);
  });

  it("set-then-delete in a single delta yields a deletion", async () => {
    // The replay-with-sentinel must respect operation order — last op wins.
    const prev = {};
    clearPendingOps();
    const entries = [
      { id: 1, personId: "p", operation: await plainOp("a:mutual", yes) },
      { id: 2, personId: "p", operation: await plainOp("a:mutual", null) },
    ];
    const next = await applySelfJournalDelta(prev, entries);
    expect(next).not.toHaveProperty("a:mutual");
  });

  it("delete-then-set in a single delta yields the set value", async () => {
    const prev = { "a:mutual": yes };
    clearPendingOps();
    const entries = [
      { id: 1, personId: "p", operation: await plainOp("a:mutual", null) },
      { id: 2, personId: "p", operation: await plainOp("a:mutual", maybe) },
    ];
    const next = await applySelfJournalDelta(prev, entries);
    expect(next["a:mutual"]).toEqual(maybe);
  });

  it("preserves prev values for keys not touched by the delta", async () => {
    const prev = { "a:mutual": yes, "c:give": no };
    const entries = [{ id: 1, personId: "p", operation: await plainOp("b:mutual", maybe) }];
    const next = await applySelfJournalDelta(prev, entries);
    expect(next["a:mutual"]).toEqual(yes);
    expect(next["c:give"]).toEqual(no);
    expect(next["b:mutual"]).toEqual(maybe);
  });
});

// =============================================================================
// useAnswers — cache-slot reader + storage-event mirror
// =============================================================================
//
// The hook reads from the SELF_JOURNAL_QUERY_KEY cache slot. The mirror
// (the useEffect inside useSelfJournal that listens for `storage:answers`
// and the native `storage` event) is what propagates `setAnswer` and
// cross-tab writes into the slot. We instantiate that mirror separately
// from useSelfJournal in these tests so we don't have to mock a tRPC client.

function renderUseAnswersWithMirror(initialAnswers: Record<string, Answer> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } },
  });
  // Pre-populate the cache slot so useAnswers (enabled: false) reads it.
  queryClient.setQueryData(SELF_JOURNAL_QUERY_KEY, { answers: initialAnswers, cursor: null });

  // Install the same storage-event mirror that useSelfJournal installs in
  // production — both handlers resolve `getScope()` at event time so an
  // in-tab token switch is handled correctly.
  function syncFromStorage() {
    const fresh = JSON.parse(localStorage.getItem(`${getScope()}answers`) ?? "{}");
    queryClient.setQueryData(
      SELF_JOURNAL_QUERY_KEY,
      (prev: { answers: Record<string, Answer>; cursor: number | null } | undefined) =>
        prev ? { ...prev, answers: fresh } : prev,
    );
  }
  function onCrossTabStorage(e: StorageEvent) {
    if (e.key === `${getScope()}answers`) syncFromStorage();
  }
  window.addEventListener("storage:answers", syncFromStorage);
  window.addEventListener("storage", onCrossTabStorage);

  function wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  }
  const result = renderHook(() => useAnswers(), { wrapper });
  const cleanup = () => {
    window.removeEventListener("storage:answers", syncFromStorage);
    window.removeEventListener("storage", onCrossTabStorage);
  };
  return { ...result, queryClient, cleanup };
}

describe("useAnswers", () => {
  it("reads from the cache slot", () => {
    const { result, cleanup } = renderUseAnswersWithMirror({ "q1:mutual": yes });
    expect(result.current).toEqual({ "q1:mutual": yes });
    cleanup();
  });

  it("returns stable identity across re-renders when the slot hasn't changed", () => {
    const { result, rerender, cleanup } = renderUseAnswersWithMirror({ "q1:mutual": yes });
    const first = result.current;
    rerender();
    rerender();
    expect(result.current).toBe(first);
    cleanup();
  });

  it("propagates setAnswer (same-tab optimistic write) via the storage:answers mirror", () => {
    const { result, cleanup } = renderUseAnswersWithMirror({});
    expect(result.current).toEqual({});
    act(() => {
      setAnswer("q1:mutual", yes);
    });
    expect(result.current).toEqual({ "q1:mutual": yes });
    cleanup();
  });

  it("propagates setAnswers (full replace) via the storage:answers mirror", () => {
    const { result, cleanup } = renderUseAnswersWithMirror({ "q1:mutual": yes });
    act(() => {
      setAnswers({ "q2:give": no });
    });
    expect(result.current).toEqual({ "q2:give": no });
    cleanup();
  });

  it("picks up cross-tab writes via the native storage event", () => {
    const { result, cleanup } = renderUseAnswersWithMirror({});
    expect(result.current).toEqual({});
    const fullKey = `${getScope()}answers`;
    act(() => {
      // A different tab in the same browser writes localStorage, which
      // triggers `storage` on every other tab. Simulate it.
      localStorage.setItem(fullKey, JSON.stringify({ cross: yes }));
      window.dispatchEvent(new StorageEvent("storage", { key: fullKey }));
    });
    expect(result.current).toEqual({ cross: yes });
    cleanup();
  });

  it("handles cross-tab writes after an in-tab session switch", () => {
    // Regression for the closure-captured-scope bug: the listener used
    // to bind `fullKey` once at effect-mount, so after `adoptSession` to
    // a new person the cross-tab event for the new scope was dropped.
    // Now the handler resolves scope per event and stays correct.
    const { result, cleanup } = renderUseAnswersWithMirror({});

    // In-tab session switch — same scenario as a user navigating between
    // two `/p/$token` URLs in the same tab.
    const newToken = "switched-token-" + Math.random().toString(36).slice(2);
    adoptSession(newToken);

    const newScopedKey = `${getScope()}answers`;
    act(() => {
      // Another tab (also operating on `newToken`) writes localStorage.
      // This tab's mirror should pick it up, even though the listener
      // was bound before the session switch.
      localStorage.setItem(newScopedKey, JSON.stringify({ "post-switch": yes }));
      window.dispatchEvent(new StorageEvent("storage", { key: newScopedKey }));
    });
    expect(result.current).toEqual({ "post-switch": yes });
    cleanup();
  });

  it("returns the empty fallback when the cache slot is unpopulated", () => {
    // No setQueryData seed — the slot is empty. useAnswers should fall back
    // to a stable empty object so consumers can render without crashing.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    }
    const { result } = renderHook(() => useAnswers(), { wrapper });
    expect(result.current).toEqual({});
  });
});

// =============================================================================
// makeSelfJournalQueryFn — token-switch race
// =============================================================================
//
// queryFn writes localStorage via `getScope()`, which captures the active
// session at call time. If the user rapidly switches tokens while a
// queryFn is in flight, an unaborted slow response could write stale data
// under the old scope, but adoptSession + AbortSignal threading should
// keep this consistent: writes always land under the scope active when
// the fetch RESOLVES, not when it was issued.
//
// The actual production guard is `signal: AbortSignal` plumbed through
// `trpcClient.sync.selfJournal.query`. resetQueries on token-switch
// (useTokenSwitchCleanup) cancels in-flight queries via this signal, so
// the queryFn's promise rejects and its post-await side effects never run.

describe("makeSelfJournalQueryFn (token switch)", () => {
  it("respects the AbortSignal — side effects don't run on aborted queries", async () => {
    const tokenA = "token-A-" + Math.random().toString(36).slice(2);
    adoptSession(tokenA);

    let release!: () => void;
    const fakeTrpc = {
      sync: {
        selfJournal: {
          query: vi.fn(
            (_input: unknown, { signal }: { signal: AbortSignal }) =>
              new Promise<{ entries: never[]; cursor: null; stoken: null }>((resolve, reject) => {
                signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
                release = () => resolve({ entries: [], cursor: null, stoken: null });
              }),
          ),
        },
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal trpc client surface for this test
    } as any;

    const queryFn = makeSelfJournalQueryFn(fakeTrpc);
    const ac = new AbortController();
    const promise = queryFn({ signal: ac.signal });

    // Switch session before the query resolves, then abort.
    const tokenB = "token-B-" + Math.random().toString(36).slice(2);
    adoptSession(tokenB);
    ac.abort();

    await expect(promise).rejects.toThrow();

    // Even if the slow promise resolved AFTER abort, the side-effect block
    // is gated by the abort: queryFn's post-await `setAnswers / setStoken
    // / setSelfJournalCursor` calls never ran. Confirm by inspecting the
    // new-session scope's localStorage for absence.
    expect(localStorage.getItem(`${getScope()}answers`)).toBe(null);
    expect(localStorage.getItem(`${getScope()}selfJournalCursor`)).toBe(null);

    // Cleanup the dangling resolver so the test process can exit cleanly.
    release();
  });
});
