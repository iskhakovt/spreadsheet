/**
 * Merge a delta of journal entries into an existing journal state.
 *
 * Idempotent by `id` (last-write-wins per id — new entries with an id that
 * already exists in `prev` overwrite the old one), sorted by id ascending.
 *
 * Used by Comparison to combine the initial HTTP backfill with incremental
 * SSE push updates from `sync.onJournalChange`, so the cache always reflects
 * the monotonically-growing journal.
 */

export interface JournalEntry {
  id: number;
  personId: string;
  operation: string;
}

export interface JournalState {
  members: { id: string; name: string; anatomy: string | null }[];
  entries: JournalEntry[];
  cursor: number | null;
}

export function mergeJournal(prev: JournalState | undefined, newEntries: JournalEntry[]): JournalState {
  const base: JournalState = prev ?? { members: [], entries: [], cursor: null };
  if (newEntries.length === 0) return base;

  // Dedup by id — Map-based merge preserves insertion order for same-key
  // overwrites. Then sort by id to guarantee monotonic ordering regardless
  // of input order.
  const byId = new Map<number, JournalEntry>();
  for (const entry of base.entries) byId.set(entry.id, entry);
  for (const entry of newEntries) byId.set(entry.id, entry);

  const merged = Array.from(byId.values()).sort((a, b) => a.id - b.id);
  const cursor = merged.length > 0 ? merged[merged.length - 1].id : base.cursor;

  return {
    members: base.members,
    entries: merged,
    cursor,
  };
}
