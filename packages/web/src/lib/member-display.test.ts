import { describe, expect, it } from "vitest";
import type { MemberAnswers } from "./journal-query.js";
import { sortMembersViewerFirst, viewerDisplayName } from "./member-display.js";

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
