import { describe, expect, it } from "vitest";
import type { MemberAnswers } from "./journal-query.js";
import { buildPairs, nextTabIndex, sortMembersViewerFirst, viewerDisplayName } from "./member-display.js";

/** Factory for a minimal MemberAnswers that the sort/display helpers care about. */
const m = (id: string, name: string): MemberAnswers => ({
  id,
  name,
  anatomy: null,
  answers: {},
});

describe("sortMembersViewerFirst", () => {
  it("empty list → empty", () => {
    expect(sortMembersViewerFirst([], "v")).toEqual([]);
  });

  it("single member (is viewer) → single member", () => {
    const alice = m("alice", "Alice");
    expect(sortMembersViewerFirst([alice], "alice")).toEqual([alice]);
  });

  it("single member (not viewer, viewer absent) → single member, no prefix", () => {
    const bob = m("bob", "Bob");
    expect(sortMembersViewerFirst([bob], "alice")).toEqual([bob]);
  });

  it("viewer already first → stays first", () => {
    const alice = m("alice", "Alice");
    const bob = m("bob", "Bob");
    expect(sortMembersViewerFirst([alice, bob], "alice")).toEqual([alice, bob]);
  });

  it("viewer last in input → moves to first", () => {
    const alice = m("alice", "Alice");
    const bob = m("bob", "Bob");
    expect(sortMembersViewerFirst([alice, bob], "bob")).toEqual([bob, alice]);
  });

  it("viewer in middle of 3 → moves to first, others sorted alphabetically", () => {
    const alice = m("alice", "Alice");
    const bob = m("bob", "Bob");
    const carol = m("carol", "Carol");
    expect(sortMembersViewerFirst([alice, bob, carol], "bob")).toEqual([bob, alice, carol]);
  });

  it("others sorted alphabetically regardless of input order", () => {
    const alice = m("alice", "Alice");
    const bob = m("bob", "Bob");
    const carol = m("carol", "Carol");
    const dave = m("dave", "Dave");
    // viewer = alice; input order is reversed
    const result = sortMembersViewerFirst([dave, carol, bob, alice], "alice");
    expect(result).toEqual([alice, bob, carol, dave]);
  });

  it("alphabetical sort is case-insensitive via localeCompare", () => {
    const alice = m("alice", "alice");
    const bob = m("bob", "Bob");
    // Binary string sort would put "Bob" before "alice" (uppercase < lowercase).
    // localeCompare treats them in dictionary order (a before B case-insensitively).
    const result = sortMembersViewerFirst([bob, alice], "someone-else");
    expect(result.map((x) => x.name)).toEqual(["alice", "Bob"]);
  });

  it("tied names preserve input order (stable sort)", () => {
    const alex1 = m("id-1", "Alex");
    const alex2 = m("id-2", "Alex");
    const alex3 = m("id-3", "Alex");
    // viewer absent — all three tie. Stable sort should return them in
    // the same order the server provided (which is createdAt, id on the
    // backend, so insertion order in practice).
    const result = sortMembersViewerFirst([alex1, alex2, alex3], "viewer-not-here");
    expect(result).toEqual([alex1, alex2, alex3]);
  });

  it("viewer not found → returns alphabetical list without a viewer prefix", () => {
    const alice = m("alice", "Alice");
    const bob = m("bob", "Bob");
    const result = sortMembersViewerFirst([bob, alice], "ghost-id");
    expect(result).toEqual([alice, bob]);
  });

  it("does not mutate the input array", () => {
    const alice = m("alice", "Alice");
    const bob = m("bob", "Bob");
    const carol = m("carol", "Carol");
    const input = [carol, alice, bob];
    const snapshot = [...input];
    sortMembersViewerFirst(input, "alice");
    expect(input).toEqual(snapshot);
  });

  it("works with plain {id, name} objects (status members)", () => {
    const members = [
      { id: "c", name: "Carol", extra: true },
      { id: "a", name: "Alice", extra: false },
      { id: "b", name: "Bob", extra: true },
    ];
    const result = sortMembersViewerFirst(members, "b");
    expect(result.map((x) => x.name)).toEqual(["Bob", "Alice", "Carol"]);
    // Extra fields preserved
    expect(result[0]).toHaveProperty("extra", true);
  });
});

describe("viewerDisplayName", () => {
  it("viewer → 'You'", () => {
    const alice = m("alice", "Alice");
    expect(viewerDisplayName(alice, "alice")).toBe("You");
  });

  it("non-viewer → their name", () => {
    const bob = m("bob", "Bob");
    expect(viewerDisplayName(bob, "alice")).toBe("Bob");
  });

  it("empty name on non-viewer → empty string (no fallback)", () => {
    // Defensive — if a group has a person with a missing display name
    // (shouldn't happen post-setup, but possible mid-migration or on
    // malformed state), the helper doesn't invent one.
    const anon = m("anon", "");
    expect(viewerDisplayName(anon, "someone-else")).toBe("");
  });
});

describe("buildPairs", () => {
  it("empty list → no pairs", () => {
    expect(buildPairs([])).toEqual([]);
  });

  it("single item → no pairs (can't pair with itself)", () => {
    expect(buildPairs([1])).toEqual([]);
  });

  it("two items → one pair", () => {
    expect(buildPairs([1, 2])).toEqual([{ a: 1, b: 2 }]);
  });

  it("three items → three pairs in deterministic order", () => {
    expect(buildPairs(["a", "b", "c"])).toEqual([
      { a: "a", b: "b" },
      { a: "a", b: "c" },
      { a: "b", b: "c" },
    ]);
  });

  it("four items → six pairs (n choose 2)", () => {
    const pairs = buildPairs([1, 2, 3, 4]);
    expect(pairs).toHaveLength(6);
    // Verify it's every unique pair with i < j
    expect(pairs).toEqual([
      { a: 1, b: 2 },
      { a: 1, b: 3 },
      { a: 1, b: 4 },
      { a: 2, b: 3 },
      { a: 2, b: 4 },
      { a: 3, b: 4 },
    ]);
  });

  it("preserves input order — index 0 is always `a` in its pairs", () => {
    // When input is [viewer, ...others], all "viewer & X" pairs come
    // first in the output. This is the property Comparison relies on
    // for "you-pairs before other-vs-other".
    const result = buildPairs(["viewer", "bob", "carol"]);
    expect(result[0]).toEqual({ a: "viewer", b: "bob" });
    expect(result[1]).toEqual({ a: "viewer", b: "carol" });
    expect(result[2]).toEqual({ a: "bob", b: "carol" });
  });

  it("works with MemberAnswers type", () => {
    const alice = m("alice", "Alice");
    const bob = m("bob", "Bob");
    const result = buildPairs([alice, bob]);
    expect(result).toEqual([{ a: alice, b: bob }]);
  });

  it("does not mutate the input array", () => {
    const input = [1, 2, 3];
    const snapshot = [...input];
    buildPairs(input);
    expect(input).toEqual(snapshot);
  });
});

describe("nextTabIndex", () => {
  describe("ArrowRight — next with wrap", () => {
    it("from 0 of 3 → 1", () => {
      expect(nextTabIndex("ArrowRight", 0, 3)).toBe(1);
    });
    it("from 1 of 3 → 2", () => {
      expect(nextTabIndex("ArrowRight", 1, 3)).toBe(2);
    });
    it("from 2 of 3 → wraps to 0", () => {
      expect(nextTabIndex("ArrowRight", 2, 3)).toBe(0);
    });
  });

  describe("ArrowLeft — previous with wrap", () => {
    it("from 1 of 3 → 0", () => {
      expect(nextTabIndex("ArrowLeft", 1, 3)).toBe(0);
    });
    it("from 2 of 3 → 1", () => {
      expect(nextTabIndex("ArrowLeft", 2, 3)).toBe(1);
    });
    it("from 0 of 3 → wraps to 2", () => {
      expect(nextTabIndex("ArrowLeft", 0, 3)).toBe(2);
    });
  });

  describe("Home / End", () => {
    it("Home → 0 regardless of active index", () => {
      expect(nextTabIndex("Home", 0, 5)).toBe(0);
      expect(nextTabIndex("Home", 3, 5)).toBe(0);
      expect(nextTabIndex("Home", 4, 5)).toBe(0);
    });
    it("End → length - 1 regardless of active index", () => {
      expect(nextTabIndex("End", 0, 5)).toBe(4);
      expect(nextTabIndex("End", 3, 5)).toBe(4);
      expect(nextTabIndex("End", 4, 5)).toBe(4);
    });
  });

  describe("edge cases", () => {
    it("length = 0 → null for every key (degenerate)", () => {
      expect(nextTabIndex("ArrowRight", 0, 0)).toBeNull();
      expect(nextTabIndex("ArrowLeft", 0, 0)).toBeNull();
      expect(nextTabIndex("Home", 0, 0)).toBeNull();
      expect(nextTabIndex("End", 0, 0)).toBeNull();
    });

    it("length = 1 → navigating wraps back to 0", () => {
      expect(nextTabIndex("ArrowRight", 0, 1)).toBe(0);
      expect(nextTabIndex("ArrowLeft", 0, 1)).toBe(0);
      expect(nextTabIndex("Home", 0, 1)).toBe(0);
      expect(nextTabIndex("End", 0, 1)).toBe(0);
    });

    it("unrecognized key → null", () => {
      expect(nextTabIndex("Enter", 0, 3)).toBeNull();
      expect(nextTabIndex("Tab", 0, 3)).toBeNull();
      expect(nextTabIndex("a", 0, 3)).toBeNull();
      expect(nextTabIndex("", 0, 3)).toBeNull();
    });
  });
});
