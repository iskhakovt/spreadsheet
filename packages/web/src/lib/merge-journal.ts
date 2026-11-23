import type { GroupJournalResponse, JournalEntryId, JournalEntryRow } from "@spreadsheet/shared";

/**
 * Merge a delta of journal entries into an existing journal state.
 *
 * Idempotent by `id` (last-write-wins per id — new entries with an id that
 * already exists in `prev` overwrite the old one in place). Entry ids are
 * opaque, so order is never derived from them: the server sends each
 * stream in ascending internal id, and every delta (subscription backfill
 * or live push) only carries ids past the stream's cursor, so appending
 * unseen ids preserves that order.
 *
 * Used by Comparison to combine the initial HTTP backfill with incremental
 * SSE push updates from `sync.onJournalChange`, so the cache always reflects
 * the monotonically-growing journal.
 */

/**
 * A journal entry with its operation still sealed. The row type (plain
 * string) because subscription deltas arrive without output validation;
 * entries from the validated HTTP response are assignable to it.
 */
export type JournalEntry = JournalEntryRow;

/** `M` is whatever member shape the caller keeps: sealed from the wire, or opened in the /results cache. */
export interface JournalState<M = GroupJournalResponse["members"][number]> {
  members: M[];
  entries: JournalEntry[];
  cursor: JournalEntryId | null;
}

export function mergeJournal<M>(
  prev: JournalState<M> | undefined,
  newEntries: readonly JournalEntry[],
): JournalState<M> {
  const base: JournalState<M> = prev ?? { members: [], entries: [], cursor: null };
  if (newEntries.length === 0) return base;

  // Map preserves first-insertion position on overwrite, so duplicates
  // stay where they were and unseen ids append in arrival order.
  const byId = new Map<JournalEntryId, JournalEntry>();
  for (const entry of base.entries) byId.set(entry.id, entry);
  for (const entry of newEntries) byId.set(entry.id, entry);

  const merged = Array.from(byId.values());
  const cursor = merged.length > 0 ? merged[merged.length - 1].id : base.cursor;

  return {
    members: base.members,
    entries: merged,
    cursor,
  };
}
