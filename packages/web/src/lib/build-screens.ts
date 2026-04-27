import { type Answer, type CategoryData, MAX_TIER, type QuestionData } from "@spreadsheet/shared";
import { type Side, visibleSides } from "./visibility.js";

/** Discriminated union: welcome interstitials + question screens */
export type Screen =
  | { type: "welcome"; categoryId: string; questionCount: number; key: string }
  | {
      type: "question";
      question: QuestionData;
      role: "give" | "receive" | "mutual";
      displayText: string;
      key: string;
      categoryId: string;
    };

export type QuestionScreen = Extract<Screen, { type: "question" }>;

export function buildScreens(
  questions: QuestionData[],
  selectedCategories: string[],
  anatomy: string,
  memberAnatomies: string[],
  questionMode: string,
  categoryMap: Record<string, CategoryData>,
  answers: Readonly<Record<string, Answer>>,
  maxTier: number = MAX_TIER,
): Screen[] {
  const questionsById = new Map<string, QuestionData>(questions.map((q) => [q.id, q]));
  const memo = new Map<string, Set<Side>>();

  const visibilityFor = (q: QuestionData) =>
    visibleSides(q, anatomy, memberAnatomies, questionMode, answers, questionsById, memo);

  const screens: Screen[] = [];
  let lastCategoryId: string | null = null;

  // Pre-count visible questions per category for welcome screens.
  const categoryCounts = new Map<string, number>();
  for (const q of questions) {
    if (!selectedCategories.includes(q.categoryId)) continue;
    if (q.tier > maxTier) continue;
    const v = visibilityFor(q);
    let add = 0;
    if (v.canGive) add++;
    if (v.canReceive) add++;
    if (v.canMutual) add++;
    if (add === 0) continue;
    categoryCounts.set(q.categoryId, (categoryCounts.get(q.categoryId) ?? 0) + add);
  }

  for (const q of questions) {
    if (!selectedCategories.includes(q.categoryId)) continue;
    if (q.tier > maxTier) continue;
    const catId = q.categoryId;

    const v = visibilityFor(q);
    if (!v.canGive && !v.canReceive && !v.canMutual) continue;

    if (catId !== lastCategoryId && categoryMap[catId] && (categoryCounts.get(catId) ?? 0) > 0) {
      screens.push({
        type: "welcome",
        categoryId: catId,
        questionCount: categoryCounts.get(catId) ?? 0,
        key: `welcome:${catId}`,
      });
      lastCategoryId = catId;
    }

    if (v.canGive && q.giveText) {
      screens.push({
        type: "question",
        question: q,
        role: "give",
        displayText: q.giveText,
        key: `${q.id}:give`,
        categoryId: catId,
      });
    }
    if (v.canReceive && q.receiveText) {
      screens.push({
        type: "question",
        question: q,
        role: "receive",
        displayText: q.receiveText,
        key: `${q.id}:receive`,
        categoryId: catId,
      });
    }
    if (v.canMutual) {
      screens.push({
        type: "question",
        question: q,
        role: "mutual",
        displayText: q.text,
        key: `${q.id}:mutual`,
        categoryId: catId,
      });
    }
  }
  return screens;
}

export function filterQuestionScreens(screens: Screen[]): QuestionScreen[] {
  return screens.filter((s): s is QuestionScreen => s.type === "question");
}

export interface CategoryAnswerStat {
  hasAnswers: boolean;
  /** Absolute index into `screens`, or -1 if all answered. */
  firstUnansweredIdx: number;
}

/**
 * Per-category answer stats from the screens list.
 *
 * `firstUnansweredIdx` is an absolute screen index because `buildScreens`
 * emits a welcome followed by its category's contiguous questions — so
 * callers can `setIndex(firstUnansweredIdx)` directly.
 */
export function buildCategoryAnswerStats(
  screens: readonly Screen[],
  answers: Readonly<Record<string, Answer>>,
): Map<string, CategoryAnswerStat> {
  const stats = new Map<string, CategoryAnswerStat>();
  for (let i = 0; i < screens.length; i++) {
    const s = screens[i];
    if (s.type !== "question") continue;
    let entry = stats.get(s.categoryId);
    if (!entry) {
      entry = { hasAnswers: false, firstUnansweredIdx: -1 };
      stats.set(s.categoryId, entry);
    }
    if (answers[s.key]) {
      entry.hasAnswers = true;
    } else if (entry.firstUnansweredIdx === -1) {
      entry.firstUnansweredIdx = i;
    }
  }
  return stats;
}

export interface ReviewItem {
  /** Operation key: `{questionId}:{give|receive|mutual}`. */
  key: string;
  label: string;
  answer: Answer | undefined;
}

export interface ReviewGroup {
  category: CategoryData;
  items: ReviewItem[];
}

/**
 * Review screen's per-category grouping. Questions with both give- and
 * receive-text expand into two items; others become one mutual item.
 * Questions whose categoryId is missing from `categoryMap` are dropped.
 */
export function buildReviewGroups(
  questions: readonly QuestionData[],
  categoryMap: Readonly<Map<string, CategoryData>>,
  selectedCategories: readonly string[],
  answers: Readonly<Record<string, Answer>>,
): ReviewGroup[] {
  const selected = new Set(selectedCategories);

  const tagged = questions
    .filter((q) => selected.has(q.categoryId))
    .flatMap((q): (ReviewItem & { categoryId: string })[] => {
      if (q.giveText && q.receiveText) {
        const giveKey = `${q.id}:give`;
        const receiveKey = `${q.id}:receive`;
        return [
          { categoryId: q.categoryId, key: giveKey, label: q.giveText, answer: answers[giveKey] },
          { categoryId: q.categoryId, key: receiveKey, label: q.receiveText, answer: answers[receiveKey] },
        ];
      }
      const key = `${q.id}:mutual`;
      return [{ categoryId: q.categoryId, key, label: q.text, answer: answers[key] }];
    });

  const byCategoryId = Object.groupBy(tagged, (item) => item.categoryId);

  return Object.entries(byCategoryId).flatMap(([catId, groupItems]) => {
    const category = categoryMap.get(catId);
    if (!category || !groupItems) return [];
    return [{ category, items: groupItems.map(({ key, label, answer }) => ({ key, label, answer })) }];
  });
}
