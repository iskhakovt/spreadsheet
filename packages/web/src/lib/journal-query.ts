import type { Answer } from "@spreadsheet/shared";
import type { QueryClient } from "@tanstack/react-query";
import type { createTRPCClient } from "@trpc/client";
import type { AppRouter } from "../../../server/src/trpc/router.js";
import { unwrapSensitive } from "./crypto.js";
import { replayJournal } from "./journal.js";
import type { JournalEntry } from "./merge-journal.js";

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
  anatomy: string | null;
  answers: Record<string, Answer>;
}

export interface CachedJournal {
  members: MemberAnswers[];
  entries: JournalEntry[];
  cursor: number | null;
}

/**
 * Decrypt + replay raw server members + entries into MemberAnswers[].
 *
 * Used by the initial fetch path — takes raw (encrypted in encrypted mode)
 * name/anatomy strings and returns the decrypted MemberAnswers shape with
 * `answers` built by replaying the journal per person.
 */
export async function replayMembers(
  members: { id: string; name: string; anatomy: string | null }[],
  entries: JournalEntry[],
): Promise<MemberAnswers[]> {
  return Promise.all(
    members.map(async (m) => {
      const memberEntries = entries.filter((e) => e.personId === m.id);
      return {
        id: m.id,
        name: await unwrapSensitive(m.name),
        anatomy: m.anatomy ? await unwrapSensitive(m.anatomy) : null,
        answers: await replayJournal(memberEntries),
      };
    }),
  );
}

/**
 * Rebuild MemberAnswers[] from the merged raw-entry set, preserving the
 * already-decrypted name/anatomy from the previous state. Used on the WS
 * merge path where we receive new journal entries but the member metadata
 * (name/anatomy) hasn't changed — re-running full `replayMembers` would
 * pass already-decrypted strings back through `unwrapSensitive`, which is
 * idempotent but wasteful and obscures the contract.
 */
export async function rebuildMemberAnswers(
  members: MemberAnswers[],
  mergedEntries: JournalEntry[],
): Promise<MemberAnswers[]> {
  return Promise.all(
    members.map(async (m) => {
      const memberEntries = mergedEntries.filter((e) => e.personId === m.id);
      return {
        id: m.id,
        name: m.name,
        anatomy: m.anatomy,
        answers: await replayJournal(memberEntries),
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
export function makeJournalQueryFn(trpcClient: TrpcClient) {
  return async ({ signal }: { signal?: AbortSignal }): Promise<CachedJournal> => {
    const raw = await trpcClient.sync.journal.query({ sinceId: null }, { signal });
    const members = await replayMembers(raw.members, raw.entries);
    return { members, entries: raw.entries, cursor: raw.cursor };
  };
}

/**
 * Pre-fetch the journal + run decryption/replay so the cache is warm by
 * the time `Comparison` mounts. Called from `useLiveStatus` when the
 * `allComplete` transition fires — Alice sees Bob's markComplete via the
 * WS push, and we start the fetch *during* the guard redirect instead of
 * *after* `Comparison` mounts. Shaves the HTTP round-trip off the
 * critical render path for the receiving side.
 */
export function prefetchJournal(queryClient: QueryClient, trpcClient: TrpcClient): Promise<void> {
  return queryClient.prefetchQuery({
    queryKey: JOURNAL_QUERY_KEY,
    queryFn: makeJournalQueryFn(trpcClient),
  });
}
