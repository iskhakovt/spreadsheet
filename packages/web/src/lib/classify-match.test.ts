import type { Answer } from "@spreadsheet/shared";
import { describe, expect, it } from "vitest";
import { classifyMatch, type MatchType } from "./classify-match.js";

function a(rating: Answer["rating"]): Answer {
  return { rating, note: null };
}

describe("classifyMatch", () => {
  // --- Hidden (either said no) ---
  describe("hidden — either said no", () => {
    it("both no", () => expect(classifyMatch(a("no"), a("no"))).toBe("hidden"));
    it("A no, B yes", () => expect(classifyMatch(a("no"), a("yes"))).toBe("hidden"));
    it("A yes, B no", () => expect(classifyMatch(a("yes"), a("no"))).toBe("hidden"));
    it("A no, B maybe", () => expect(classifyMatch(a("no"), a("maybe"))).toBe("hidden"));
    it("A no, B fantasy", () => expect(classifyMatch(a("no"), a("fantasy"))).toBe("hidden"));
    it("A no, B if-partner-wants", () => expect(classifyMatch(a("no"), a("if-partner-wants"))).toBe("hidden"));
    it("A fantasy, B no", () => expect(classifyMatch(a("fantasy"), a("no"))).toBe("hidden"));
  });

  // --- Match (both yes/willing) ---
  describe("match — both positive", () => {
    it("both yes", () => expect(classifyMatch(a("yes"), a("yes"))).toBe("match"));
    it("yes + willing", () => expect(classifyMatch(a("yes"), a("if-partner-wants"))).toBe("match"));
    it("willing + willing", () => expect(classifyMatch(a("if-partner-wants"), a("if-partner-wants"))).toBe("match"));
    it("willing + yes", () => expect(classifyMatch(a("if-partner-wants"), a("yes"))).toBe("match"));
  });

  // --- Both maybe ---
  describe("both-maybe", () => {
    it("both maybe", () => expect(classifyMatch(a("maybe"), a("maybe"))).toBe("both-maybe"));
  });

  // --- Fantasy ---
  describe("fantasy — both fantasy only", () => {
    it("both fantasy", () => expect(classifyMatch(a("fantasy"), a("fantasy"))).toBe("fantasy"));
  });

  // --- Possible (mixed positive) ---
  describe("possible — one positive + one positive (mixed)", () => {
    it("yes + maybe", () => expect(classifyMatch(a("yes"), a("maybe"))).toBe("possible"));
    it("maybe + yes", () => expect(classifyMatch(a("maybe"), a("yes"))).toBe("possible"));
    it("willing + maybe", () => expect(classifyMatch(a("if-partner-wants"), a("maybe"))).toBe("possible"));
    it("maybe + willing", () => expect(classifyMatch(a("maybe"), a("if-partner-wants"))).toBe("possible"));
  });

  // --- Hidden (mixed with fantasy) ---
  describe("hidden — fantasy + non-fantasy (except both-fantasy)", () => {
    it("fantasy + yes", () => expect(classifyMatch(a("fantasy"), a("yes"))).toBe("hidden"));
    it("yes + fantasy", () => expect(classifyMatch(a("yes"), a("fantasy"))).toBe("hidden"));
    it("fantasy + maybe", () => expect(classifyMatch(a("fantasy"), a("maybe"))).toBe("hidden"));
    it("maybe + fantasy", () => expect(classifyMatch(a("maybe"), a("fantasy"))).toBe("hidden"));
    it("fantasy + willing", () => expect(classifyMatch(a("fantasy"), a("if-partner-wants"))).toBe("hidden"));
    it("willing + fantasy", () => expect(classifyMatch(a("if-partner-wants"), a("fantasy"))).toBe("hidden"));
  });

  // --- Symmetry ---
  describe("symmetry — order shouldn't matter", () => {
    const cases: [Answer, Answer, string][] = [
      [a("yes"), a("maybe"), "possible"],
      [a("maybe"), a("yes"), "possible"],
      [a("yes"), a("no"), "hidden"],
      [a("no"), a("yes"), "hidden"],
      [a("fantasy"), a("fantasy"), "fantasy"],
      [a("yes"), a("if-partner-wants"), "match"],
      [a("if-partner-wants"), a("yes"), "match"],
    ];
    for (const [answerA, answerB, expected] of cases) {
      it(`${answerA.rating} + ${answerB.rating} = ${expected}`, () => {
        expect(classifyMatch(answerA, answerB)).toBe(expected);
      });
    }
  });

  // --- Exhaustive truth table: all rating × rating pairs ---
  describe("exhaustive rating × rating truth table", () => {
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
});
