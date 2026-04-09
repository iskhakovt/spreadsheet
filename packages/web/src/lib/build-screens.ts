import type { CategoryData, QuestionData } from "@spreadsheet/shared";

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
