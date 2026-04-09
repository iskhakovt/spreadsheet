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
  aName?: string,
): PairMatch[] {
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
      displayText = q.giveText ? `${q.giveText}${aName ? ` (${aName})` : ""}` : q.text;
    } else {
      displayText = q.receiveText ? `${q.receiveText}${aName ? ` (${aName})` : ""}` : q.text;
    }
    matches.push({ questionId: qId, displayText, matchType, answerA: aAnswers[keyA], answerB: bAnswers[keyB] });
  }

  return matches;
}
