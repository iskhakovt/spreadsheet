/** @vitest-environment happy-dom */
import { type Anatomy, type Answer, fakeEncrypted, plainOp, plainSealed } from "@spreadsheet/shared";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { createGroupCodec } from "./codec.js";
import { generateGroupKey } from "./crypto.js";
import { applyJournalDelta, type CachedJournal, JOURNAL_QUERY_KEY, replayMembers } from "./journal-query.js";
import type { JournalEntry } from "./merge-journal.js";
import { UI } from "./strings.js";

const yes: Answer = { rating: "yes", note: null };
const no: Answer = { rating: "no", note: null };
const codec = createGroupCodec(false, null);

function entry(id: string, personId: string, key: string, data: Answer): JournalEntry {
  return { id, personId, operation: plainOp(key, data) };
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

describe("replayMembers", () => {
  it("opens each member's name and anatomy and replays their own entries", async () => {
    const encrypted = createGroupCodec(true, await generateGroupKey());
    const members = [
      { id: "alice", name: await encrypted.seal("Alice"), anatomy: await encrypted.seal<Anatomy>("afab") },
      { id: "bob", name: await encrypted.seal("Bob"), anatomy: null },
    ];
    const entries = [
      { id: "e1", personId: "alice", operation: await encrypted.seal({ key: "a:mutual", data: yes }) },
      { id: "e2", personId: "bob", operation: await encrypted.seal({ key: "a:mutual", data: no }) },
    ];

    expect(await replayMembers(members, entries, encrypted)).toEqual([
      { id: "alice", name: "Alice", anatomy: "afab", answers: { "a:mutual": yes } },
      { id: "bob", name: "Bob", anatomy: null, answers: { "a:mutual": no } },
    ]);
  });

  it("shows UI.unreadableName and no anatomy for fields that don't open, and still replays answers", async () => {
    // A `p:` value in an encrypted group (forged without the key), a
    // ciphertext under another group's key, and a garbled ciphertext.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const encrypted = createGroupCodec(true, await generateGroupKey());
    const otherGroup = createGroupCodec(true, await generateGroupKey());
    const members = [
      { id: "forged", name: plainSealed("Mallory"), anatomy: plainSealed<Anatomy>("amab") },
      { id: "other-key", name: await otherGroup.seal("Eve"), anatomy: await otherGroup.seal<Anatomy>("afab") },
      { id: "garbled", name: fakeEncrypted<string>("garbled"), anatomy: fakeEncrypted<Anatomy>("garbled") },
    ];
    const entries = [{ id: "e1", personId: "forged", operation: await encrypted.seal({ key: "a:mutual", data: yes }) }];

    const result = await replayMembers(members, entries, encrypted);

    expect(result).toEqual([
      { id: "forged", name: UI.unreadableName, anatomy: null, answers: { "a:mutual": yes } },
      { id: "other-key", name: UI.unreadableName, anatomy: null, answers: {} },
      { id: "garbled", name: UI.unreadableName, anatomy: null, answers: {} },
    ]);
    spy.mockRestore();
  });
});

describe("applyJournalDelta", () => {
  it("applies a delta: raw entries, cursor, and replayed member answers", async () => {
    const queryClient = new QueryClient();
    seed(queryClient);
    const apply = (entries: JournalEntry[]) => applyJournalDelta(queryClient, entries, codec);

    await apply([entry("e1", "alice", "a:mutual", yes)]);

    const data = read(queryClient);
    expect(data.entries.map((e) => e.id)).toEqual(["e1"]);
    expect(data.cursor).toBe("e1");
    expect(data.members.find((m) => m.id === "alice")?.answers).toEqual({ "a:mutual": yes });
  });

  it("keeps every entry when deliveries overlap with the async rebuild", async () => {
    // Snapshotting the cache, awaiting the rebuild, then writing would let a
    // second delivery arriving mid-rebuild snapshot a cache without the
    // first delivery's entries; the first write would be discarded as stale
    // and those entries lost for good (the server cursor has moved past them).
    const queryClient = new QueryClient();
    seed(queryClient, [entry("e1", "alice", "a:mutual", no)]);
    const apply = (entries: JournalEntry[]) => applyJournalDelta(queryClient, entries, codec);

    const x = entry("e2", "alice", "a:mutual", yes);
    const y = entry("e3", "bob", "b:mutual", yes);
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
    const pending = applyJournalDelta(queryClient, [entry("e1", "alice", "a:mutual", yes)], codec);
    seed(queryClient, [entry("f1", "alice", "a:mutual", no)]);
    const replaced = read(queryClient);
    await pending;
    expect(read(queryClient)).toBe(replaced);
  });

  it("ignores empty deltas and an unpopulated cache", async () => {
    const queryClient = new QueryClient();
    const apply = (entries: JournalEntry[]) => applyJournalDelta(queryClient, entries, codec);
    await apply([entry("e1", "alice", "a:mutual", yes)]);
    expect(queryClient.getQueryData(JOURNAL_QUERY_KEY)).toBeUndefined();

    seed(queryClient);
    const before = read(queryClient);
    await apply([]);
    expect(read(queryClient)).toBe(before);
  });
});
