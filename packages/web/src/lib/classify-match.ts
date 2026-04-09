import type { Answer } from "@spreadsheet/shared";

export type MatchType = "green-light" | "match" | "both-maybe" | "possible" | "fantasy" | "hidden";

/**
 * Classify the match between two answers.
 *
 * Priority order:
 * 1. Either said no → hidden (never shown)
 * 2. Both yes/willing + both now → green-light
 * 3. Both yes/willing (any timing) → match
 * 4. Both maybe → both-maybe (worth discussing)
 * 5. Both fantasy → fantasy (shared fantasy)
 * 6. One positive + one positive → possible
 * 7. Everything else → hidden
 */
export function classifyMatch(a: Answer, b: Answer): MatchType {
  if (a.rating === "no" || b.rating === "no") return "hidden";

  const bothYes =
    (a.rating === "yes" || a.rating === "if-partner-wants") && (b.rating === "yes" || b.rating === "if-partner-wants");

  if (bothYes && a.timing === "now" && b.timing === "now") return "green-light";
  if (bothYes) return "match";
  if (a.rating === "maybe" && b.rating === "maybe") return "both-maybe";
  if (a.rating === "fantasy" && b.rating === "fantasy") return "fantasy";

  const onePositive =
    (a.rating === "yes" || a.rating === "if-partner-wants" || a.rating === "maybe") &&
    (b.rating === "yes" || b.rating === "if-partner-wants" || b.rating === "maybe");
  if (onePositive) return "possible";

  return "hidden";
}
