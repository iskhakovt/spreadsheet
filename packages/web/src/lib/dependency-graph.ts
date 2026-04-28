import type { QuestionData } from "@spreadsheet/shared";

/**
 * Inverse of `requires`: parent id → list of child ids that depend on it.
 * Single source of truth is the seed's `requires` graph; this map is a
 * derived view for components that need to render "→ N children" or
 * decide whether a question is a gate.
 *
 * Dedupes per parent — a question that lists the same parent multiple
 * times in `requires` (the seed validator doesn't reject this) appears
 * only once in the parent's child list.
 */
export function buildChildrenOf(questions: readonly QuestionData[]): Map<string, string[]> {
  const sets = new Map<string, Set<string>>();
  for (const q of questions) {
    for (const parentId of q.requires) {
      const set = sets.get(parentId) ?? new Set<string>();
      set.add(q.id);
      sets.set(parentId, set);
    }
  }
  const map = new Map<string, string[]>();
  for (const [parentId, set] of sets) {
    map.set(parentId, Array.from(set));
  }
  return map;
}

/**
 * "Gateway" status — a question whose "no" answer hides a meaningful
 * subtree. Threshold of 3 children matches the curated set of gates in
 * `questions.yml` (sex-generally, oral-generally, penetration-generally,
 * etc.) without needing to flag them explicitly. A handful of two-child
 * parents exist (e.g. specific role-based parents) that aren't really
 * "gates" in the UX sense — keeping the threshold at 3 stays conservative.
 */
export const GATE_CHILDREN_THRESHOLD = 3;

export function isGate(questionId: string, childrenOf: Map<string, string[]>): boolean {
  return (childrenOf.get(questionId)?.length ?? 0) >= GATE_CHILDREN_THRESHOLD;
}
