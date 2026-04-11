import { describe, expect, it } from "vitest";
import { type JournalEntry, type JournalState, mergeJournal } from "./merge-journal.js";

function entry(id: number, personId = "p1", operation = `op${id}`): JournalEntry {
  return { id, personId, operation };
}

function state(entries: JournalEntry[], members: JournalState["members"] = []): JournalState {
  return {
    members,
    entries,
    cursor: entries.length > 0 ? entries[entries.length - 1].id : null,
  };
}

describe("mergeJournal", () => {
  it("returns a fresh state when prev is undefined and new is empty", () => {
    const result = mergeJournal(undefined, []);
    expect(result.entries).toEqual([]);
    expect(result.cursor).toBe(null);
    expect(result.members).toEqual([]);
  });

  it("returns prev unchanged when new is empty", () => {
    const prev = state([entry(1), entry(2)]);
    const result = mergeJournal(prev, []);
    expect(result).toBe(prev); // reference stability on empty delta
  });

  it("populates an empty state from a fresh delta", () => {
    const result = mergeJournal(undefined, [entry(1), entry(2), entry(3)]);
    expect(result.entries).toHaveLength(3);
    expect(result.entries.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(result.cursor).toBe(3);
  });

  it("appends non-overlapping entries in id order", () => {
    const prev = state([entry(1), entry(2)]);
    const result = mergeJournal(prev, [entry(3), entry(4)]);
    expect(result.entries.map((e) => e.id)).toEqual([1, 2, 3, 4]);
    expect(result.cursor).toBe(4);
  });

  it("dedupes by id: new entry overwrites the old one with the same id", () => {
    const prev = state([entry(1, "p1", "old")]);
    const result = mergeJournal(prev, [entry(1, "p1", "new")]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].operation).toBe("new");
    expect(result.cursor).toBe(1);
  });

  it("handles mixed overlapping + new entries", () => {
    const prev = state([entry(1, "p1", "a"), entry(2, "p1", "b")]);
    const result = mergeJournal(prev, [entry(2, "p1", "b-updated"), entry(3, "p1", "c")]);
    expect(result.entries).toHaveLength(3);
    expect(result.entries.map((e) => e.operation)).toEqual(["a", "b-updated", "c"]);
    expect(result.cursor).toBe(3);
  });

  it("sorts out-of-order input by id ascending", () => {
    const result = mergeJournal(undefined, [entry(3), entry(1), entry(2)]);
    expect(result.entries.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(result.cursor).toBe(3);
  });

  it("preserves members from prev (subscription only updates entries)", () => {
    const members = [{ id: "p1", name: "Alice", anatomy: "afab" as const }];
    const prev = state([entry(1)], members);
    const result = mergeJournal(prev, [entry(2)]);
    expect(result.members).toBe(members);
  });

  it("handles entries from different persons interleaved", () => {
    const prev = state([entry(1, "alice"), entry(2, "bob")]);
    const result = mergeJournal(prev, [entry(3, "alice"), entry(4, "bob")]);
    expect(result.entries.map((e) => ({ id: e.id, personId: e.personId }))).toEqual([
      { id: 1, personId: "alice" },
      { id: 2, personId: "bob" },
      { id: 3, personId: "alice" },
      { id: 4, personId: "bob" },
    ]);
  });

  it("cursor tracks max id even if entries arrive out of order across deltas", () => {
    let s = mergeJournal(undefined, [entry(5)]);
    expect(s.cursor).toBe(5);
    s = mergeJournal(s, [entry(10), entry(6)]);
    expect(s.cursor).toBe(10);
    expect(s.entries.map((e) => e.id)).toEqual([5, 6, 10]);
  });
});
