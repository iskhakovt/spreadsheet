import type { Answer } from "@spreadsheet/shared";
import { type QueryClient, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import type { createTRPCClient } from "@trpc/client";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useRef } from "react";
import type { AppRouter } from "../../../server/src/trpc/router.js";
import { mergeAfterRejection } from "./journal.js";
import {
  getAnswers,
  getPendingOps,
  getSelfJournalCursor,
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
 * Stable cache key for the caller's own answers map. The play screens read
 * from this slot (via `useAnswers`) instead of going to localStorage, so the
 * journal-derived state is the single source of truth in-memory; the
 * localStorage write-through (in `applySelfJournalUpdate`) is just a
 * persister for first paint on the next mount.
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

    if (result.stoken !== null) {
      // Prime the push cursor — saves a handshake when the user makes their
      // first edit after a fresh boot.
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
 * The hook returns the cache slot; play screens read from this via
 * `useAnswers` (which proxies to the slot).
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

  // Drop out-of-order applications if multiple pushes interleave their
  // async decrypts. Same pattern as `useLiveStatus` and `Comparison`.
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
            const current = queryClient.getQueryData<SelfJournalCache>(SELF_JOURNAL_QUERY_KEY);
            if (!current) return;
            const merged = await applySelfJournalDelta(current.answers, entries);
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

  return data;
}

/**
 * Imperative cache write — for `setAnswer` (single-key optimistic update)
 * and the rejected-push merge path. Both already write to localStorage via
 * `setAnswers`; this also pokes the TanStack cache so any in-tree readers
 * pick up the update on next render.
 *
 * No-op if the cache slot hasn't been populated yet (e.g. during the layout
 * suspense window before `useSelfJournal` has resolved). Callers can rely
 * on localStorage as the persistent record either way.
 */
export function patchSelfJournalCache(queryClient: QueryClient, answers: Record<string, Answer>): void {
  const current = queryClient.getQueryData<SelfJournalCache>(SELF_JOURNAL_QUERY_KEY);
  if (!current) return;
  queryClient.setQueryData<SelfJournalCache>(SELF_JOURNAL_QUERY_KEY, {
    ...current,
    answers,
  });
}
