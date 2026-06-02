import type { Answer, Compare } from "@spreadsheet/shared";

export type MatchType =
  | "match"
  | "both-maybe"
  | "possible"
  | "fantasy"
  | "aligned-yes"
  | "aligned-no"
  | "differ"
  | "noted"
  | "hidden";

/** yes / if-partner-wants both read as an affirmation of the item. */
function isAffirm(rating: Answer["rating"]): boolean {
  return rating === "yes" || rating === "if-partner-wants";
}

/**
 * Classify the match between two answers, given the question's comparison
 * semantics. `compare` defaults to "activity" so legacy/stale question data
 * (missing the field) behaves exactly as before.
 *
 *  - activity:  positive overlap only — a "no" hides the row.
 *  - agreement: symmetric norm — mutual-yes, mutual-no, AND splits all surface.
 *  - disclose:  always surface both answers; no verdict.
 */
export function classifyMatch(a: Answer, b: Answer, compare: Compare = "activity"): MatchType {
  switch (compare) {
    case "disclose":
      // A disclose row exists to surface a stated preference or note. If both
      // declined and neither left a note, there's genuinely nothing to
      // disclose (e.g. neither has a pubic-hair preference) — hide the empty row.
      if (a.rating === "no" && b.rating === "no" && !a.note && !b.note) return "hidden";
      return "noted";
    case "agreement":
      return classifyAgreement(a, b);
    default:
      return classifyActivity(a, b);
  }
}

/**
 * "Do you both want to do this?" — the default. Priority order:
 * 1. Either said no → hidden (never shown; privacy / no pressure)
 * 2. Both yes/willing → match
 * 3. Both maybe → both-maybe (worth discussing)
 * 4. Both fantasy → fantasy (shared fantasy)
 * 5. One positive + one positive → possible
 * 6. Everything else → hidden
 */
function classifyActivity(a: Answer, b: Answer): MatchType {
  if (a.rating === "no" || b.rating === "no") return "hidden";

  if (isAffirm(a.rating) && isAffirm(b.rating)) return "match";
  if (a.rating === "maybe" && b.rating === "maybe") return "both-maybe";
  if (a.rating === "fantasy" && b.rating === "fantasy") return "fantasy";

  const onePositive = (isAffirm(a.rating) || a.rating === "maybe") && (isAffirm(b.rating) || b.rating === "maybe");
  if (onePositive) return "possible";

  return "hidden";
}

/**
 * "Do you agree on this norm?" — symmetric. Unlike an activity, a mutual "no"
 * is alignment worth surfacing (e.g. both exclusive, both sober) and a split
 * is the conversation to have — neither is hidden.
 *
 * `if-partner-wants` is a *deferring* answer ("I'm open to it if you are"), so
 * it resolves toward the partner's definite stance rather than being a flat
 * affirmation: willing + yes lands on yes, willing + no lands on no. A genuine
 * clash (`differ`) is therefore only yes-vs-no — one actively wants the norm,
 * the other actively refuses it.
 *
 *  - both land "in"  → aligned-yes ("Both in")
 *  - both land "out" → aligned-no  ("Both pass")  ← the "no is the match" case
 *  - yes vs no       → differ      ("You differ") ← surfaced, not hidden
 *  - any unresolved maybe/fantasy → both-maybe ("Worth discussing")
 */
function classifyAgreement(a: Answer, b: Answer): MatchType {
  const ra = a.rating;
  const rb = b.rating;

  // The only hard clash: one definite yes against one definite no.
  if ((ra === "yes" && rb === "no") || (ra === "no" && rb === "yes")) return "differ";

  // yes / willing both land "in" (the willing one comes along; two willings are both open).
  if (isAffirm(ra) && isAffirm(rb)) return "aligned-yes";

  // no / willing both land "out" (the willing one defers to the partner's "no").
  const declines = (r: Answer["rating"]) => r === "no" || r === "if-partner-wants";
  if (declines(ra) && declines(rb)) return "aligned-no";

  // Anything left has an unresolved maybe/fantasy → worth a conversation.
  return "both-maybe";
}
