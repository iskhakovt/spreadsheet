import type { Answer } from "@spreadsheet/shared";
import { classifyMatch, type MatchType } from "./classify-match.js";

export interface QuestionInfo {
  text: string;
  categoryId: string;
  giveText: string | null;
  receiveText: string | null;
}

export interface PairMatch {
  questionId: string;
  displayText: string;
  matchType: MatchType;
  answerA: Answer;
  answerB: Answer;
}

/** One category's bucket of matches for the /results view. */
export interface CategoryGroup {
  categoryId: string;
  label: string;
  matches: PairMatch[];
}

export interface BuildPairOptions {
  /** Display name for person A — appended in parens on give/receive rows
   *  to disambiguate whose perspective the row reflects. */
  aName?: string;
  /** When true, A is the viewer of the /results page — the parenthetical
   *  is omitted because every row naturally reads from A's perspective
   *  (giveText/receiveText are phrased with A as the implicit subject). */
  aIsViewer?: boolean;
}

/**
 * Build the list of matches between two people's answers.
 *
 * - Mutual questions: exact key match (both answered q:mutual)
 * - Give/receive questions: cross-role only (A's give ↔ B's receive = compatibility)
 *   Same-role comparisons (both give, both receive) are meaningless and skipped.
 * - In all-questions mode both directions exist (A→B and B→A), both are shown.
 */
export function buildPairMatches(
  aAnswers: Record<string, Answer>,
  bAnswers: Record<string, Answer>,
  questions: Record<string, QuestionInfo>,
  opts: BuildPairOptions = {},
): PairMatch[] {
  const { aName, aIsViewer = false } = opts;
  const parenthetical = !aIsViewer && aName ? ` (${aName})` : "";
  const matches: PairMatch[] = [];
  const seen = new Set<string>();

  // 1. Mutual questions: exact key match
  const allKeys = new Set([...Object.keys(aAnswers), ...Object.keys(bAnswers)]);
  for (const key of allKeys) {
    const [questionId, role] = key.split(":");
    if (role !== "mutual") continue;
    if (!aAnswers[key] || !bAnswers[key]) continue;
    const q = questions[questionId];
    if (!q) continue;
    const matchType = classifyMatch(aAnswers[key], bAnswers[key]);
    if (matchType === "hidden") continue;
    matches.push({ questionId, displayText: q.text, matchType, answerA: aAnswers[key], answerB: bAnswers[key] });
    seen.add(questionId);
  }

  // 2. Give/receive questions: cross-role match only
  //    A:give ↔ B:receive and A:receive ↔ B:give are separate, meaningful comparisons.
  for (const keyA of Object.keys(aAnswers)) {
    const [qId, roleA] = keyA.split(":");
    if (roleA !== "give" && roleA !== "receive") continue;
    const complement = roleA === "give" ? "receive" : "give";
    const keyB = `${qId}:${complement}`;
    if (!bAnswers[keyB]) continue;
    // Deduplicate: each direction is unique
    const pairKey = `${qId}:${roleA}>${complement}`;
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);
    const q = questions[qId];
    if (!q) continue;
    const matchType = classifyMatch(aAnswers[keyA], bAnswers[keyB]);
    if (matchType === "hidden") continue;
    // Display from A's perspective
    let displayText: string;
    if (roleA === "give") {
      displayText = q.giveText ? `${q.giveText}${parenthetical}` : q.text;
    } else {
      displayText = q.receiveText ? `${q.receiveText}${parenthetical}` : q.text;
    }
    matches.push({ questionId: qId, displayText, matchType, answerA: aAnswers[keyA], answerB: bAnswers[keyB] });
  }

  return matches;
}

/**
 * Bucket a flat list of pair matches into category groups for display.
 *
 * - Matches are grouped by the category of their question
 * - Categories appear in the order dictated by `categoryOrder` (the
 *   question-flow order). Empty categories (no matches) are dropped.
 * - Within each category, matches are sorted by `questionOrder` (the
 *   position of the question in the original question list). This
 *   keeps match rows in the same order the user answered them.
 * - Matches whose question is missing from `questions` are dropped.
 *
 * Returns a new array; does not mutate the input.
 */
export function buildGroupedMatches(
  pairMatches: PairMatch[],
  questions: Record<string, QuestionInfo>,
  categories: Record<string, string>,
  categoryOrder: string[],
  questionOrder: Record<string, number>,
): CategoryGroup[] {
  const grouped: Record<string, { label: string; matches: PairMatch[] }> = {};
  for (const match of pairMatches) {
    const q = questions[match.questionId];
    if (!q) continue;
    const categoryId = q.categoryId;
    if (!grouped[categoryId]) {
      grouped[categoryId] = { label: categories[categoryId] ?? categoryId, matches: [] };
    }
    grouped[categoryId].matches.push(match);
  }
  return categoryOrder
    .filter((id) => grouped[id])
    .map((categoryId) => ({
      categoryId,
      label: grouped[categoryId].label,
      matches: grouped[categoryId].matches
        .slice()
        .sort((x, y) => (questionOrder[x.questionId] ?? 0) - (questionOrder[y.questionId] ?? 0)),
    }));
}
