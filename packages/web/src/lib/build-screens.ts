import type { Answer, CategoryData, QuestionData } from "@spreadsheet/shared";

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

function anatomyMatches(target: string, anatomy: string): boolean {
  if (target === "all") return true;
  if (anatomy === "both") return true;
  if (anatomy === "none") return false;
  return target === anatomy;
}

export function buildScreens(
  questions: QuestionData[],
  selectedCategories: string[],
  anatomy: string,
  memberAnatomies: string[],
  questionMode: string,
  categoryMap: Record<string, CategoryData>,
  maxTier = 3,
): Screen[] {
  const screens: Screen[] = [];
  let lastCategoryId: string | null = null;

  // Pre-count questions per category for welcome screens
  const categoryCounts = new Map<string, number>();
  for (const q of questions) {
    if (!selectedCategories.includes(q.categoryId)) continue;
    if (q.tier > maxTier) continue;
    const count = categoryCounts.get(q.categoryId) ?? 0;
    if (q.giveText && q.receiveText) {
      if (questionMode === "all") {
        categoryCounts.set(q.categoryId, count + 2);
      } else {
        const otherAnats = memberAnatomies.filter(Boolean);
        let add = 0;
        if (
          anatomyMatches(q.targetGive, anatomy) &&
          (q.targetReceive === "all" || otherAnats.some((a) => anatomyMatches(q.targetReceive, a)))
        )
          add++;
        if (
          anatomyMatches(q.targetReceive, anatomy) &&
          (q.targetGive === "all" || otherAnats.some((a) => anatomyMatches(q.targetGive, a)))
        )
          add++;
        categoryCounts.set(q.categoryId, count + add);
      }
    } else {
      if (questionMode === "all" || anatomyMatches(q.targetGive, anatomy)) {
        categoryCounts.set(q.categoryId, count + 1);
      }
    }
  }

  for (const q of questions) {
    if (!selectedCategories.includes(q.categoryId)) continue;
    if (q.tier > maxTier) continue;
    const catId = q.categoryId;

    if (catId !== lastCategoryId && categoryMap[catId] && (categoryCounts.get(catId) ?? 0) > 0) {
      screens.push({
        type: "welcome",
        categoryId: catId,
        questionCount: categoryCounts.get(catId) ?? 0,
        key: `welcome:${catId}`,
      });
      lastCategoryId = catId;
    }

    if (q.giveText && q.receiveText) {
      if (questionMode === "all") {
        screens.push({
          type: "question",
          question: q,
          role: "give",
          displayText: q.giveText,
          key: `${q.id}:give`,
          categoryId: catId,
        });
        screens.push({
          type: "question",
          question: q,
          role: "receive",
          displayText: q.receiveText,
          key: `${q.id}:receive`,
          categoryId: catId,
        });
        continue;
      }

      const otherAnatomies = memberAnatomies.filter(Boolean);
      const canGive =
        anatomyMatches(q.targetGive, anatomy) &&
        (q.targetReceive === "all" || otherAnatomies.some((a) => anatomyMatches(q.targetReceive, a)));
      const canReceive =
        anatomyMatches(q.targetReceive, anatomy) &&
        (q.targetGive === "all" || otherAnatomies.some((a) => anatomyMatches(q.targetGive, a)));

      if (canGive) {
        screens.push({
          type: "question",
          question: q,
          role: "give",
          displayText: q.giveText,
          key: `${q.id}:give`,
          categoryId: catId,
        });
      }
      if (canReceive) {
        screens.push({
          type: "question",
          question: q,
          role: "receive",
          displayText: q.receiveText,
          key: `${q.id}:receive`,
          categoryId: catId,
        });
      }
    } else {
      if (questionMode === "all" || anatomyMatches(q.targetGive, anatomy)) {
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
  }
  return screens;
}

export function filterQuestionScreens(screens: Screen[]): QuestionScreen[] {
  return screens.filter((s): s is QuestionScreen => s.type === "question");
}

/** Per-category stat entry derived from the screens list + answers. */
export interface CategoryAnswerStat {
  /** True iff at least one question in this category has an answer. */
  hasAnswers: boolean;
  /** Absolute index into `screens` of the first unanswered question in this
   *  category, or -1 if every question in the category is answered. */
  firstUnansweredIdx: number;
}

/**
 * Build per-category answer stats in a single O(screens) pass.
 *
 * Used by the welcome-screen render to decide:
 *   - hasAnswers       → suppresses the "New category" eyebrow
 *   - firstUnansweredIdx → drives the Continue / Review-from-the-start CTA
 *
 * The naive per-render approach (`Object.keys(answers).some(...
 * questions.find(...))` plus a separate `screens.findIndex(...)`) was
 * O(answers × questions + screens). This version pays O(screens) once and
 * serves O(1) lookups from the returned Map.
 *
 * `firstUnansweredIdx` is the absolute screen index (not a per-category
 * offset) because `buildScreens` emits a welcome followed by its category's
 * contiguous questions — the first unanswered in the category is always at
 * an absolute index strictly greater than the welcome's index, so the
 * welcome can `setIndex(firstUnansweredIdx)` directly.
 *
 * Categories with no question screens produce no entry in the map.
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

/** One row in the Review screen — a question expanded into 1 or 2 items. */
export interface ReviewItem {
  /** Operation key: `{questionId}:{give|receive|mutual}`. */
  key: string;
  /** Label to render — `giveText` / `receiveText` for split questions,
   *  `text` for mutual. */
  label: string;
  /** Existing answer for this item, or `undefined` if unanswered. */
  answer: Answer | undefined;
}

/** A category section in the Review screen. */
export interface ReviewGroup {
  category: CategoryData;
  items: ReviewItem[];
}

/**
 * Build the Review screen's per-category grouping in three declarative
 * steps: filter questions to selected categories, expand each question
 * into one or two items (give/receive split → two, mutual → one), group
 * by categoryId.
 *
 * The original inline implementation nested `if (q.giveText && q.receiveText)`
 * twice with lazy-init of `groups[categoryId]` — readable but imperative.
 * This version makes the three steps explicit and unit-testable.
 *
 * Categories referenced by a question but missing from `categoryMap` are
 * dropped silently (matches the original behavior).
 */
export function buildReviewGroups(
  questions: readonly QuestionData[],
  categoryMap: Readonly<Map<string, CategoryData>>,
  selectedCategories: readonly string[],
  answers: Readonly<Record<string, Answer>>,
): ReviewGroup[] {
  const selected = new Set(selectedCategories);

  // Each question becomes one (mutual) or two (give+receive) items. Tag
  // each with its categoryId so the subsequent groupBy doesn't need to
  // scan back through `questions`.
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

  // ES2024 Object.groupBy preserves insertion order of keys, so groups come
  // out in the order their category was first encountered in `questions`.
  const byCategoryId = Object.groupBy(tagged, (item) => item.categoryId);

  return Object.entries(byCategoryId).flatMap(([catId, groupItems]) => {
    const category = categoryMap.get(catId);
    if (!category || !groupItems) return [];
    return [{ category, items: groupItems.map(({ key, label, answer }) => ({ key, label, answer })) }];
  });
}
