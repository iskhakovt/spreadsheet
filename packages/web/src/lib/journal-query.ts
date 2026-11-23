import { Anatomy, type Answer, type GroupJournalResponse, type JournalEntryId, PersonName } from "@spreadsheet/shared";
import type { QueryClient } from "@tanstack/react-query";
import type { createTRPCClient } from "@trpc/client";
import type { AppRouter } from "../../../server/src/trpc/router.js";
import type { GroupCodec } from "./codec.js";
import { replayJournal } from "./journal.js";
import { type JournalEntry, mergeJournal } from "./merge-journal.js";
import { UI } from "./strings.js";

type TrpcClient = ReturnType<typeof createTRPCClient<AppRouter>>;

/**
 * Decrypted + replayed per-member state for the `/results` screen.
 *
 * This is the derived shape that `Comparison.tsx` renders from. Stored in
 * the TanStack Query cache via a custom queryFn so the first paint has
 * the data ready — no mount → useEffect → async replay → setState cycle,
 * which was adding ~500ms of latency on the critical render path.
 */
export interface MemberAnswers {
  id: string;
  name: string;
  anatomy: Anatomy | null;
  answers: Record<string, Answer>;
}

export interface CachedJournal {
  members: MemberAnswers[];
  entries: JournalEntry[];
  cursor: JournalEntryId | null;
}

/**
 * Decrypt + replay raw server members + entries into MemberAnswers[].
 *
 * Used by the initial fetch path — takes sealed name/anatomy strings and
 * returns the opened MemberAnswers shape with `answers` built by replaying
 * the journal per person. A field that doesn't open is dropped, the same
 * rule as `decryptStatus`: unreadable name, null anatomy, skipped entry.
 */
export async function replayMembers(
  members: GroupJournalResponse["members"],
  entries: JournalEntry[],
  codec: GroupCodec,
): Promise<MemberAnswers[]> {
  return Promise.all(
    members.map(async (m) => {
      const memberEntries = entries.filter((e) => e.personId === m.id);
      return {
        id: m.id,
        name: (await codec.openOrDrop(m.name, PersonName)) ?? UI.unreadableName,
        anatomy: m.anatomy === null ? null : await codec.openOrDrop(m.anatomy, Anatomy),
        answers: await replayJournal(memberEntries, codec),
      };
    }),
  );
}

/**
 * Rebuild MemberAnswers[] from the merged raw-entry set, preserving the
 * already-decrypted name/anatomy from the previous state. Used on the
 * subscription merge path where we receive new journal entries but the
 * member metadata (name/anatomy) hasn't changed — re-running full
 * `replayMembers` would try to open already-opened strings, which the
 * codec rightly rejects.
 */
export async function rebuildMemberAnswers(
  members: MemberAnswers[],
  mergedEntries: JournalEntry[],
  codec: GroupCodec,
): Promise<MemberAnswers[]> {
  return Promise.all(
    members.map(async (m) => {
      const memberEntries = mergedEntries.filter((e) => e.personId === m.id);
      return {
        id: m.id,
        name: m.name,
        anatomy: m.anatomy,
        answers: await replayJournal(memberEntries, codec),
      };
    }),
  );
}

/**
 * Stable queryKey for the `/results` derived journal. Shared between the
 * component's `useSuspenseQuery` and the `prefetchJournal` call so both
 * write to / read from the same cache entry.
 */
export const JOURNAL_QUERY_KEY = ["sync", "journal", "derived"] as const;

/**
 * Build the queryFn used by both the component's `useSuspenseQuery` and
 * the prefetch path. Factored out so both code paths go through the same
 * decrypt + replay logic.
 */
export function makeJournalQueryFn(trpcClient: TrpcClient, codec: GroupCodec) {
  return async ({ signal }: { signal?: AbortSignal }): Promise<CachedJournal> => {
    const raw = await trpcClient.sync.journal.query(undefined, { signal });
    const members = await replayMembers(raw.members, raw.entries, codec);
    return { members, entries: raw.entries, cursor: raw.cursor };
  };
}

/**
 * Pre-fetch the journal + run decryption/replay so the cache is warm by
 * the time `Comparison` mounts. Called from `useLiveStatus` when the
 * `allComplete` transition fires — Alice sees Bob's markComplete via the
 * SSE push, and we start the fetch *during* the guard redirect instead of
 * *after* `Comparison` mounts. Shaves the HTTP round-trip off the
 * critical render path for the receiving side.
 */
export function prefetchJournal(queryClient: QueryClient, trpcClient: TrpcClient, codec: GroupCodec): Promise<void> {
  return queryClient.prefetchQuery({
    queryKey: JOURNAL_QUERY_KEY,
    queryFn: makeJournalQueryFn(trpcClient, codec),
  });
}

/**
 * Apply one `sync.onJournalChange` delta to the `/results` cache.
 *
 * Journal deltas are incremental — each carries entries no other delivery
 * will repeat — so applying them must be lossless even when deliveries
 * overlap with the async decrypt + replay. Two steps, with different
 * concurrency rules:
 *
 *   1. Raw merge — synchronous, through `setQueryData`'s functional
 *      updater, so every delta lands on top of the latest cache state no
 *      matter how deliveries interleave. This is the lossless step.
 *   2. Member rebuild — async (decrypt + replay), written back only if
 *      the cache still holds the exact entry list that was rebuilt. Any
 *      later merge, refetch, or reset swaps in a new `entries` array, so a
 *      stale rebuild — from an older overlapping delta, a previous mount,
 *      or the previous token before `resetQueries` — can never overwrite
 *      newer state. The newest rebuild covers everything older ones would
 *      have produced, because each replays the full merged list.
 *
 * Doing the merge after the `await` instead (snapshot → rebuild → write)
 * lets a later delta's write omit an earlier delta's entries, and since
 * the server cursor has moved past them, nothing ever re-delivers them.
 */
export async function applyJournalDelta(
  queryClient: QueryClient,
  entries: JournalEntry[],
  codec: GroupCodec,
): Promise<void> {
  if (entries.length === 0) return;

  // `setQueryData` returns the data as stored. Use that, not the object
  // passed in: structural sharing may store a different `entries`
  // reference, and the guard below compares against the stored one.
  const merged = queryClient.setQueryData<CachedJournal>(JOURNAL_QUERY_KEY, (prev) => {
    if (!prev) return prev;
    const raw = mergeJournal(prev, entries);
    return { ...prev, entries: raw.entries, cursor: raw.cursor };
  });
  if (!merged) return;

  const rebuiltFrom = merged.entries;
  const members = await rebuildMemberAnswers(merged.members, rebuiltFrom, codec);
  queryClient.setQueryData<CachedJournal>(JOURNAL_QUERY_KEY, (prev) =>
    prev?.entries === rebuiltFrom ? { ...prev, members } : prev,
  );
}
