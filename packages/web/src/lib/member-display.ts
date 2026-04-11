import type { MemberAnswers } from "./journal-query.js";

/**
 * Sort members so the current viewer comes first, followed by everyone
 * else alphabetically by name. Drives pair generation in Comparison —
 * all "viewer & X" pairs precede "other & other" pairs because the
 * viewer sits at index 0 after the sort.
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
export function sortMembersViewerFirst(members: MemberAnswers[], viewerId: string): MemberAnswers[] {
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
