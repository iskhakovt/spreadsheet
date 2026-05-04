import type { Answer } from "@spreadsheet/shared";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import type { createTRPCClient } from "@trpc/client";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { AppRouter } from "../../../server/src/trpc/router.js";
import { mergeAfterRejection } from "./journal.js";
import { getScope } from "./session.js";
import {
  getAnswers,
  getPendingOps,
  getSelfJournalCursor,
  getStoken,
  setAnswers,
  setSelfJournalCursor,
  setStoken,
} from "./storage.js";
import { useTRPC, useTRPCClient } from "./trpc.js";

type TrpcClient = ReturnType<typeof createTRPCClient<AppRouter>>;

export interface SelfJournalCache {
  answers: Record<string, Answer>;
  cursor: number | null;
}

/**
 * Stable cache key for the caller's own answers map. The cache slot is
 * populated by `useSelfJournal` on every play-page mount and kept live by
 * the `sync.onSelfJournalChange` subscription. localStorage is a
 * write-through persister for first paint on the next mount; play screens
 * read from there via `useAnswers`.
 */
export const SELF_JOURNAL_QUERY_KEY = ["sync", "self-journal"] as const;

/**
 * Build the queryFn used by `useSelfJournal`'s suspense query. Factored out
 * so a non-hook caller (e.g. the layout's pre-fetch path, if we ever want
 * one) can run the same hydration step.
 *
 * Steps:
 *   1. Fetch the per-person delta since the persisted cursor.
 *   2. Decrypt + replay each entry into a partial state map.
 *   3. Merge with the previous answers map plus the local outbox: server
 *      values win for keys without a pending edit, the outbox wins for
 *      keys with a pending edit (same rule as `mergeAfterRejection`).
 *   4. Persist the new answers + cursor as a write-through, and prime the
 *      stoken so the next `sync.push` doesn't have to re-handshake.
 */
export function makeSelfJournalQueryFn(trpcClient: TrpcClient) {
  return async ({ signal }: { signal?: AbortSignal }): Promise<SelfJournalCache> => {
    const cursor = getSelfJournalCursor();
    const result = await trpcClient.sync.selfJournal.query({ sinceId: cursor ?? undefined }, { signal });

    const merged = await applySelfJournalDelta(getAnswers(), result.entries);

    // Re-check abort BEFORE writing scoped storage. The user may have
    // navigated to a different /p/$token in the meantime; useTokenSwitchCleanup
    // calls resetQueries which aborts the in-flight signal. Without this
    // guard the side effects below would write to the new session's scope
    // (since getScope() resolves at call time) using stale data fetched
    // under the old session.
    if (signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }

    if (result.stoken !== null && getStoken() === null) {
      // Prime the push cursor only on the FIRST hydration. After that the
      // outbound push flow (sync-flush.ts) owns stoken and may have a
      // fresher value than this query's snapshot — a push that committed
      // between our snapshot read and this write would set stoken to the
      // post-commit head, and overwriting it here with our pre-commit
      // snapshot's head would force the next push to get rejected. Skip
      // when stoken is already present; either it matches ours (no-op) or
      // it's strictly fresher (push-managed) and we mustn't clobber it.
      setStoken(result.stoken);
    }
    setAnswers(merged);
    setSelfJournalCursor(result.cursor);

    return { answers: merged, cursor: result.cursor };
  };
}

/**
 * Apply a batch of new entries to the previous answers map. Replays the
 * entries to derive a partial server-side state, then overlays the local
 * outbox so unsent edits aren't clobbered.
 *
 * Pure (apart from decrypt — async via `replayJournal`). Used both by the
 * initial query and by the WS subscription's `onData`.
 *
 * `prev` is what the caller believes is the current local state. In
 * practice that's `getAnswers()` (localStorage write-through, includes
 * the user's most recent optimistic edits via `setAnswer`) rather than
 * the cache slot — the cache slot can lag behind by one render when an
 * optimistic write happens between the slot's last update and the WS
 * echo of the same write.
 */
export async function applySelfJournalDelta(
  prev: Record<string, Answer>,
  newEntries: { id: number; personId: string; operation: string }[],
): Promise<Record<string, Answer>> {
  if (newEntries.length === 0) return prev;
  const serverEntryOps = newEntries.map((e) => e.operation);
  return mergeAfterRejection(prev, getPendingOps(), serverEntryOps);
}

/**
 * Hydrate the caller's own answers from the server journal and keep the
 * cache live across devices.
 *
 * Used by the `/p/$token` layout. Suspense-fetches once on mount, persists
 * the answers map + cursor as a write-through, and subscribes to
 * `sync.onSelfJournalChange` so writes from any other device with the same
 * person token land in the cache without a reload.
 *
 * The hook returns the cache slot. Play screens read it via `useAnswers`
 * (also exported from this file), which is a thin reader of the same slot.
 */
export function useSelfJournal(): SelfJournalCache {
  // React Compiler can't prove `seqRef.current` is only touched in async
  // callbacks; mirror the directive used in Comparison/useLiveStatus.
  "use no memo";

  const trpc = useTRPC();
  const trpcClient = useTRPCClient();
  const queryClient = useQueryClient();

  const { data } = useSuspenseQuery({
    queryKey: SELF_JOURNAL_QUERY_KEY,
    queryFn: makeSelfJournalQueryFn(trpcClient),
  });

  const initialLastEventId = data.cursor !== null ? String(data.cursor) : undefined;

  // Drop out-of-order applications if multiple WS pushes interleave their
  // async decrypts. Same pattern as `useLiveStatus` and `Comparison`.
  //
  // Bootstrap-vs-WS ordering is structural, not protected by this seqRef:
  // `useSubscription` only opens after the suspense fetch resolves (the
  // hook returns `data` first, then mounts the subscription). So the
  // queryFn's localStorage writes always happen-before any onData
  // callback. The seq guard only protects multiple onData callbacks
  // interleaving with each other.
  const seqRef = useRef(0);

  useSubscription(
    trpc.sync.onSelfJournalChange.subscriptionOptions(
      { lastEventId: initialLastEventId },
      {
        onData: async (msg) => {
          const entries = msg.data.entries;
          if (entries.length === 0) return;
          const mySeq = ++seqRef.current;
          try {
            // Use getAnswers() (localStorage), not the cache slot — the
            // slot can lag behind a synchronous setAnswer that happened
            // between the last slot write and this WS echo. localStorage
            // is the up-to-date local truth.
            const merged = await applySelfJournalDelta(getAnswers(), entries);
            if (mySeq !== seqRef.current) return;
            const newCursor = entries[entries.length - 1].id;
            queryClient.setQueryData<SelfJournalCache>(SELF_JOURNAL_QUERY_KEY, {
              answers: merged,
              cursor: newCursor,
            });
            setAnswers(merged);
            setSelfJournalCursor(newCursor);
          } catch (err) {
            console.error("Failed to apply self-journal update:", err);
          }
        },
        onError: (err) => {
          console.error("Self-journal subscription error:", err);
        },
      },
    ),
  );

  // Mirror localStorage `answers` writes into the cache slot so that
  //   - optimistic single-key writes (`setAnswer` in Question.tsx) propagate
  //     to all `useAnswers` readers without a round-trip;
  //   - cross-tab writes from another tab of the same person (native
  //     `storage` event) propagate to this tab's cache slot.
  // The legacy `storage:answers` channel is dispatched by `notifyChanged`
  // on every same-tab `setAnswers` call, which is what `setAnswer` uses
  // for its localStorage write.
  //
  // Both handlers resolve `getScope()` at event time, not at effect-mount
  // time. After an in-tab token switch (`adoptSession`), the effect's
  // deps don't change but the active scope does — capturing the scoped
  // key once at mount would silently drop cross-tab writes for the new
  // person. Reading scope per-event keeps the listener correct across
  // session switches without needing to re-bind on every render.
  useEffect(() => {
    function syncFromStorage() {
      const fresh = getAnswers();
      queryClient.setQueryData<SelfJournalCache>(SELF_JOURNAL_QUERY_KEY, (prev) =>
        prev ? { ...prev, answers: fresh } : prev,
      );
    }
    function onCrossTabStorage(e: StorageEvent) {
      if (e.key === `${getScope()}answers`) syncFromStorage();
    }
    window.addEventListener("storage:answers", syncFromStorage);
    window.addEventListener("storage", onCrossTabStorage);
    return () => {
      window.removeEventListener("storage:answers", syncFromStorage);
      window.removeEventListener("storage", onCrossTabStorage);
    };
  }, [queryClient]);

  return data;
}

/**
 * Read the caller's current answers map from the self-journal cache slot.
 *
 * The cache slot is the in-memory source of truth, populated by
 * `useSelfJournal` on mount and kept live by:
 *   - the `sync.onSelfJournalChange` subscription (cross-device deltas);
 *   - the storage-event mirror in `useSelfJournal` (same-tab optimistic
 *     writes from `setAnswer`, plus cross-tab writes via the native
 *     `storage` event).
 *
 * Returns an empty map if the cache slot hasn't been populated yet
 * (defensive — under the layout's structure the slot is always populated
 * before children render, but the empty fallback keeps test rendering
 * outside the layout safe).
 *
 * Identity stability: `useSyncExternalStore` returns the same reference
 * across renders unless the snapshot it pulls from the cache changes.
 * Since the cache slot's `answers` reference only changes when a new
 * `setQueryData` call lands, identity is stable across no-op renders.
 *
 * Implementation note — uses `useSyncExternalStore` over the query cache
 * subscription rather than `useQuery({ enabled: false })`. The latter
 * does not re-render observers when `setQueryData` mutates the cache
 * from outside React (the storage-event mirror is non-React), so the
 * direct subscription is the reliable read path.
 */
export function useAnswers(): Record<string, Answer> {
  const queryClient = useQueryClient();
  const subscribe = (callback: () => void) =>
    queryClient.getQueryCache().subscribe((event) => {
      const k = event.query.queryKey;
      if (Array.isArray(k) && k[0] === "sync" && k[1] === "self-journal") callback();
    });
  const getSnapshot = () =>
    queryClient.getQueryData<SelfJournalCache>(SELF_JOURNAL_QUERY_KEY)?.answers ?? EMPTY_ANSWERS;
  return useSyncExternalStore(subscribe, getSnapshot);
}

const EMPTY_ANSWERS: Record<string, Answer> = Object.freeze({}) as Record<string, Answer>;
