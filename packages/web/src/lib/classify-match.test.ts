import type { Answer } from "@spreadsheet/shared";
import { describe, expect, it } from "vitest";
import { classifyMatch, type MatchType } from "./classify-match.js";

function a(rating: Answer["rating"]): Answer {
  return { rating, note: null };
}

describe("classifyMatch", () => {
  // Exhaustive 5×5 rating × rating truth table — covers every classification
  // (hidden / match / both-maybe / fantasy / possible) plus symmetry, since
  // every (rA, rB) and (rB, rA) cell is exercised independently. No separate
  // per-case tests needed; the table is the spec.
  const R = ["yes", "if-partner-wants", "maybe", "fantasy", "no"] as const;

  //                      yes       ipw        maybe       fantasy    no
  const table: MatchType[][] = [
    /* yes     */ ["match", "match", "possible", "hidden", "hidden"],
    /* ipw     */ ["match", "match", "possible", "hidden", "hidden"],
    /* maybe   */ ["possible", "possible", "both-maybe", "hidden", "hidden"],
    /* fantasy */ ["hidden", "hidden", "hidden", "fantasy", "hidden"],
    /* no      */ ["hidden", "hidden", "hidden", "hidden", "hidden"],
  ];

  for (let i = 0; i < R.length; i++) {
    for (let j = 0; j < R.length; j++) {
      it(`(${R[i]}, ${R[j]}) → ${table[i][j]}`, () => {
        expect(classifyMatch(a(R[i]), a(R[j]))).toBe(table[i][j]);
      });
    }
  }
});
