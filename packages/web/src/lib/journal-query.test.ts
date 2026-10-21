/** @vitest-environment happy-dom */
import type { Answer } from "@spreadsheet/shared";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { encodeValue } from "./crypto.js";
import { applyJournalDelta, type CachedJournal, JOURNAL_QUERY_KEY } from "./journal-query.js";
import type { JournalEntry } from "./merge-journal.js";

const yes: Answer = { rating: "yes", note: null };
const no: Answer = { rating: "no", note: null };

async function entry(id: string, personId: string, key: string, data: Answer): Promise<JournalEntry> {
  return { id, personId, operation: await encodeValue({ key, data }, null) };
}

function seed(queryClient: QueryClient, entries: JournalEntry[] = []): void {
  queryClient.setQueryData<CachedJournal>(JOURNAL_QUERY_KEY, {
    members: [
      { id: "alice", name: "Alice", anatomy: null, answers: {} },
      { id: "bob", name: "Bob", anatomy: null, answers: {} },
    ],
    entries,
    cursor: entries.at(-1)?.id ?? null,
  });
}

function read(queryClient: QueryClient): CachedJournal {
  const data = queryClient.getQueryData<CachedJournal>(JOURNAL_QUERY_KEY);
  if (!data) throw new Error("cache empty");
  return data;
}

describe("applyJournalDelta", () => {
  it("applies a delta: raw entries, cursor, and replayed member answers", async () => {
    const queryClient = new QueryClient();
    seed(queryClient);
    const apply = (entries: JournalEntry[]) => applyJournalDelta(queryClient, entries);

    await apply([await entry("e1", "alice", "a:mutual", yes)]);

    const data = read(queryClient);
    expect(data.entries.map((e) => e.id)).toEqual(["e1"]);
    expect(data.cursor).toBe("e1");
    expect(data.members.find((m) => m.id === "alice")?.answers).toEqual({ "a:mutual": yes });
  });

  it("keeps every entry when deliveries overlap with the async rebuild", async () => {
    // Regression: the handler used to snapshot the cache, await the
    // rebuild, then write. A second delivery arriving mid-rebuild
    // snapshotted a cache without the first delivery's entries, the first
    // write was discarded as stale, and those entries were lost for good
    // (the server cursor had already moved past them).
    const queryClient = new QueryClient();
    seed(queryClient, [await entry("e1", "alice", "a:mutual", no)]);
    const apply = (entries: JournalEntry[]) => applyJournalDelta(queryClient, entries);

    const x = await entry("e2", "alice", "a:mutual", yes);
    const y = await entry("e3", "bob", "b:mutual", yes);
    await Promise.all([apply([x]), apply([y])]);

    const data = read(queryClient);
    expect(data.entries.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
    expect(data.cursor).toBe("e3");
    expect(data.members.find((m) => m.id === "alice")?.answers).toEqual({ "a:mutual": yes });
    expect(data.members.find((m) => m.id === "bob")?.answers).toEqual({ "b:mutual": yes });
  });

  it("never lets a stale rebuild overwrite members after the cache is replaced", async () => {
    // E.g. a refetch / resetQueries (token switch) lands while a delta's
    // decrypt + replay is in flight. The late rebuild must not write
    // members derived from the old entry list onto the new one.
    const queryClient = new QueryClient();
    seed(queryClient);
    const pending = applyJournalDelta(queryClient, [await entry("e1", "alice", "a:mutual", yes)]);
    seed(queryClient, [await entry("f1", "alice", "a:mutual", no)]);
    const replaced = read(queryClient);
    await pending;
    expect(read(queryClient)).toBe(replaced);
  });

  it("ignores empty deltas and an unpopulated cache", async () => {
    const queryClient = new QueryClient();
    const apply = (entries: JournalEntry[]) => applyJournalDelta(queryClient, entries);
    await apply([await entry("e1", "alice", "a:mutual", yes)]);
    expect(queryClient.getQueryData(JOURNAL_QUERY_KEY)).toBeUndefined();

    seed(queryClient);
    const before = read(queryClient);
    await apply([]);
    expect(read(queryClient)).toBe(before);
  });
});
