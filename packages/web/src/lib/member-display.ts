import type { MemberAnswers } from "./journal-query.js";

/** A pair of values — used for pair generation in the /results view. */
export interface Pair<T> {
  a: T;
  b: T;
}

/**
 * Sort any list of members so the current viewer comes first, followed
 * by everyone else alphabetically by name. Works on any object with
 * `id` and `name` fields — both status members and journal MemberAnswers.
 *
 * Stability: JavaScript's `Array.prototype.sort` is stable (ES2019+),
 * so members with identical names preserve their input-order relative
 * ranking. Since the server returns members in `(createdAt, id)` order,
 * ties resolve to insertion order.
 *
 * If the viewer isn't present in the members list (shouldn't happen in
 * practice, but handled defensively), returns the others sorted
 * alphabetically without a viewer-first prefix.
 *
 * Does not mutate the input array.
 */
export function sortMembersViewerFirst<T extends { id: string; name: string }>(members: T[], viewerId: string): T[] {
  const viewer = members.find((m) => m.id === viewerId);
  const others = members.filter((m) => m.id !== viewerId).sort((a, b) => a.name.localeCompare(b.name));
  return viewer ? [viewer, ...others] : others;
}

/**
 * Render the viewer as the pronoun "You" and everyone else by their
 * decrypted display name. Used in pair headings, tab buttons, and
 * match-row labels on the `/results` screen.
 */
export function viewerDisplayName(member: MemberAnswers, viewerId: string): string {
  return member.id === viewerId ? "You" : member.name;
}

/**
 * Generate all unordered pairs from a list. Input order is preserved:
 * for `[a, b, c]` the result is `[{a,b}, {a,c}, {b,c}]` — every index
 * `i` paired with every later index `j > i`.
 *
 * When combined with `sortMembersViewerFirst` upstream, this guarantees
 * that all `{viewer, X}` pairs appear before any `{other, other}` pairs
 * — the viewer sits at index 0, so pairs at positions `{i=0, j=1..N-1}`
 * are all viewer-pairs and come first in the output array.
 *
 * Generic over T so it can be used for any pair generation (members,
 * numbers in tests, etc.).
 */
export function buildPairs<T>(items: T[]): Pair<T>[] {
  const pairs: Pair<T>[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      pairs.push({ a: items[i], b: items[j] });
    }
  }
  return pairs;
}

/**
 * Resolve the next-focused index for an ARIA tablist keyboard event.
 * Returns `null` if the key isn't a recognized tab-navigation key (the
 * caller should let the default handling proceed).
 *
 * Wraps on ArrowLeft/ArrowRight so focus cycles through the list. Home
 * jumps to 0, End jumps to the last index. Matches WAI-ARIA APG's
 * "Tabs with Automatic Activation" pattern.
 */
export function nextTabIndex(key: string, activeIndex: number, length: number): number | null {
  if (length === 0) return null;
  switch (key) {
    case "ArrowRight":
      return (activeIndex + 1) % length;
    case "ArrowLeft":
      return (activeIndex - 1 + length) % length;
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return null;
  }
}
