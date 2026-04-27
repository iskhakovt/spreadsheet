import type { Answer, QuestionData } from "@spreadsheet/shared";

export type Side = "give" | "receive" | "mutual";

function anatomyMatches(target: string, anatomy: string): boolean {
  if (target === "all") return true;
  if (anatomy === "both") return true;
  if (anatomy === "none") return false;
  return target === anatomy;
}

/** Per-side anatomy visibility for a question, ignoring dependency gating. */
export interface AnatomySides {
  canGive: boolean;
  canReceive: boolean;
  canMutual: boolean;
}

export function anatomySides(
  q: QuestionData,
  anatomy: string,
  otherAnatomies: readonly string[],
  questionMode: string,
): AnatomySides {
  const isGR = !!(q.giveText && q.receiveText);

  if (questionMode === "all") {
    return isGR
      ? { canGive: true, canReceive: true, canMutual: false }
      : { canGive: false, canReceive: false, canMutual: true };
  }

  if (isGR) {
    const others = otherAnatomies.filter(Boolean);
    const anyOther = (target: string) => target === "all" || others.some((a) => anatomyMatches(target, a));
    return {
      canGive: anatomyMatches(q.targetGive, anatomy) && anyOther(q.targetReceive),
      canReceive: anatomyMatches(q.targetReceive, anatomy) && anyOther(q.targetGive),
      canMutual: false,
    };
  }

  return {
    canGive: false,
    canReceive: false,
    canMutual: anatomyMatches(q.targetGive, anatomy),
  };
}

/**
 * Sides of `q` that are dependency-gated by ancestors answered "no".
 * Per-side mapping when both parent and child are give/receive; otherwise
 * "any side no" gates the corresponding child side.
 */
export function gatedSides(
  qId: string,
  answers: Readonly<Record<string, Answer>>,
  questionsById: ReadonlyMap<string, QuestionData>,
  memo: Map<string, Set<Side>> = new Map(),
): Set<Side> {
  const cached = memo.get(qId);
  if (cached) return cached;
  const result = new Set<Side>();
  // Set placeholder up-front to break any unexpected cycles. Seed-time
  // validation rejects them, so this is belt-and-suspenders.
  memo.set(qId, result);

  const q = questionsById.get(qId);
  if (!q) return result;

  const isChildGR = !!(q.giveText && q.receiveText);

  for (const parentId of q.requires) {
    const parent = questionsById.get(parentId);
    if (!parent) continue;

    const parentGated = gatedSides(parentId, answers, questionsById, memo);
    const isParentGR = !!(parent.giveText && parent.receiveText);

    const parentNoSides = new Set<Side>(parentGated);
    if (isParentGR) {
      if (answers[`${parentId}:give`]?.rating === "no") parentNoSides.add("give");
      if (answers[`${parentId}:receive`]?.rating === "no") parentNoSides.add("receive");
    } else {
      if (answers[`${parentId}:mutual`]?.rating === "no") parentNoSides.add("mutual");
    }

    if (isChildGR && isParentGR) {
      if (parentNoSides.has("give")) result.add("give");
      if (parentNoSides.has("receive")) result.add("receive");
    } else if (isChildGR && !isParentGR) {
      if (parentNoSides.has("mutual")) {
        result.add("give");
        result.add("receive");
      }
    } else if (!isChildGR && isParentGR) {
      if (parentNoSides.has("give") || parentNoSides.has("receive")) result.add("mutual");
    } else {
      if (parentNoSides.has("mutual")) result.add("mutual");
    }
  }

  return result;
}

/** Combined visibility per side: anatomy AND not-dependency-gated. */
export function visibleSides(
  q: QuestionData,
  anatomy: string,
  otherAnatomies: readonly string[],
  questionMode: string,
  answers: Readonly<Record<string, Answer>>,
  questionsById: ReadonlyMap<string, QuestionData>,
  memo?: Map<string, Set<Side>>,
): AnatomySides {
  const anat = anatomySides(q, anatomy, otherAnatomies, questionMode);
  const gated = gatedSides(q.id, answers, questionsById, memo);
  return {
    canGive: anat.canGive && !gated.has("give"),
    canReceive: anat.canReceive && !gated.has("receive"),
    canMutual: anat.canMutual && !gated.has("mutual"),
  };
}

/** True if at least one side of the question is visible to the user. */
export function isQuestionVisible(
  q: QuestionData,
  anatomy: string,
  otherAnatomies: readonly string[],
  questionMode: string,
  answers: Readonly<Record<string, Answer>>,
  questionsById: ReadonlyMap<string, QuestionData>,
  memo?: Map<string, Set<Side>>,
): boolean {
  const v = visibleSides(q, anatomy, otherAnatomies, questionMode, answers, questionsById, memo);
  return v.canGive || v.canReceive || v.canMutual;
}
