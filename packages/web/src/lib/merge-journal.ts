import type { JournalEntry, JournalEntryId } from "@spreadsheet/shared";

/**
 * Merge a delta of journal entries into an existing journal state.
 *
 * Idempotent by `id` (last-write-wins per id — new entries with an id that
 * already exists in `prev` overwrite the old one in place). Entry ids are
 * opaque, so order is never derived from them: the server always sends
 * entries in commit order, and every delta (subscription backfill or live
 * push) only contains entries committed after the previous cursor, so
 * appending unseen ids preserves commit order.
 *
 * Used by Comparison to combine the initial HTTP backfill with incremental
 * SSE push updates from `sync.onJournalChange`, so the cache always reflects
 * the monotonically-growing journal.
 */

export type { JournalEntry };

export interface JournalState {
  members: { id: string; name: string; anatomy: string | null }[];
  entries: JournalEntry[];
  cursor: JournalEntryId | null;
}

export function mergeJournal(prev: JournalState | undefined, newEntries: JournalEntry[]): JournalState {
  const base: JournalState = prev ?? { members: [], entries: [], cursor: null };
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
