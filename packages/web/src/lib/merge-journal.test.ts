import { describe, expect, it } from "vitest";
import { type JournalEntry, type JournalState, mergeJournal } from "./merge-journal.js";

// Real ids are opaque 22-char tokens; tests use readable stand-ins. The
// merge only ever compares ids for equality, never for order.
function entry(n: number, personId = "p1", operation = `op${n}`): JournalEntry {
  return { id: `e${n}`, personId, operation };
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
    expect(result.entries.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
    expect(result.cursor).toBe("e3");
  });

  it("appends non-overlapping entries in arrival order", () => {
    const prev = state([entry(1), entry(2)]);
    const result = mergeJournal(prev, [entry(3), entry(4)]);
    expect(result.entries.map((e) => e.id)).toEqual(["e1", "e2", "e3", "e4"]);
    expect(result.cursor).toBe("e4");
  });

  it("dedupes by id: new entry overwrites the old one with the same id", () => {
    const prev = state([entry(1, "p1", "old")]);
    const result = mergeJournal(prev, [entry(1, "p1", "new")]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].operation).toBe("new");
    expect(result.cursor).toBe("e1");
  });

  it("handles mixed overlapping + new entries", () => {
    const prev = state([entry(1, "p1", "a"), entry(2, "p1", "b")]);
    const result = mergeJournal(prev, [entry(2, "p1", "b-updated"), entry(3, "p1", "c")]);
    expect(result.entries).toHaveLength(3);
    expect(result.entries.map((e) => e.operation)).toEqual(["a", "b-updated", "c"]);
    expect(result.cursor).toBe("e3");
  });

  it("keeps server order instead of sorting by id (ids are opaque)", () => {
    // Opaque ids carry no ordering; the server's response order is commit
    // order, so the merge must not reorder.
    const result = mergeJournal(undefined, [entry(3), entry(1), entry(2)]);
    expect(result.entries.map((e) => e.id)).toEqual(["e3", "e1", "e2"]);
    expect(result.cursor).toBe("e2");
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
      { id: "e1", personId: "alice" },
      { id: "e2", personId: "bob" },
      { id: "e3", personId: "alice" },
      { id: "e4", personId: "bob" },
    ]);
  });

  it("cursor is the last entry of the merged list across deltas", () => {
    let s = mergeJournal(undefined, [entry(5)]);
    expect(s.cursor).toBe("e5");
    s = mergeJournal(s, [entry(6), entry(10)]);
    expect(s.cursor).toBe("e10");
    expect(s.entries.map((e) => e.id)).toEqual(["e5", "e6", "e10"]);
  });

  it("an overlapping replay (reconnect backfill) keeps the original positions", () => {
    let s = mergeJournal(undefined, [entry(1), entry(2), entry(3)]);
    s = mergeJournal(s, [entry(2), entry(3), entry(4)]);
    expect(s.entries.map((e) => e.id)).toEqual(["e1", "e2", "e3", "e4"]);
    expect(s.cursor).toBe("e4");
  });
});
