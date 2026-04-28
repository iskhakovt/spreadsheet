import type { QuestionData } from "@spreadsheet/shared";

/**
 * Inverse of `requires`: parent id → list of child ids that depend on it.
 * Single source of truth is the seed's `requires` graph; this map is a
 * derived view for components that need to render "→ N children" or
 * decide whether a question is a gate.
 */
export function buildChildrenOf(questions: readonly QuestionData[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const q of questions) {
    for (const parentId of q.requires) {
      const list = map.get(parentId) ?? [];
      list.push(q.id);
      map.set(parentId, list);
    }
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
