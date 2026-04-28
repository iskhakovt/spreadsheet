import type { Answer } from "@spreadsheet/shared";
import { describe, expect, it } from "vitest";
import { classifyMatch, type MatchType } from "./classify-match.js";

function a(rating: Answer["rating"], timing: Answer["timing"] = null): Answer {
  return { rating, timing, note: null };
}

describe("classifyMatch", () => {
  // --- Hidden (either said no) ---
  describe("hidden — either said no", () => {
    it("both no", () => expect(classifyMatch(a("no"), a("no"))).toBe("hidden"));
    it("A no, B yes", () => expect(classifyMatch(a("no"), a("yes", "now"))).toBe("hidden"));
    it("A yes, B no", () => expect(classifyMatch(a("yes", "now"), a("no"))).toBe("hidden"));
    it("A no, B maybe", () => expect(classifyMatch(a("no"), a("maybe"))).toBe("hidden"));
    it("A no, B fantasy", () => expect(classifyMatch(a("no"), a("fantasy"))).toBe("hidden"));
    it("A no, B if-partner-wants", () => expect(classifyMatch(a("no"), a("if-partner-wants", "now"))).toBe("hidden"));
    it("A fantasy, B no", () => expect(classifyMatch(a("fantasy"), a("no"))).toBe("hidden"));
  });

  // --- Green light (both yes/willing + both now) ---
  describe("green-light — both positive + both now", () => {
    it("both yes + both now", () => expect(classifyMatch(a("yes", "now"), a("yes", "now"))).toBe("green-light"));
    it("yes + willing, both now", () =>
      expect(classifyMatch(a("yes", "now"), a("if-partner-wants", "now"))).toBe("green-light"));
    it("willing + willing, both now", () =>
      expect(classifyMatch(a("if-partner-wants", "now"), a("if-partner-wants", "now"))).toBe("green-light"));
    it("willing + yes, both now", () =>
      expect(classifyMatch(a("if-partner-wants", "now"), a("yes", "now"))).toBe("green-light"));
  });

  // --- Match (both yes/willing, not both now) ---
  describe("match — both positive, timing differs", () => {
    it("both yes, A now B later", () => expect(classifyMatch(a("yes", "now"), a("yes", "later"))).toBe("match"));
    it("both yes, both later", () => expect(classifyMatch(a("yes", "later"), a("yes", "later"))).toBe("match"));
    it("both yes, null timing (showTiming off)", () =>
      expect(classifyMatch(a("yes", null), a("yes", null))).toBe("match"));
    it("yes + willing, A later B now", () =>
      expect(classifyMatch(a("yes", "later"), a("if-partner-wants", "now"))).toBe("match"));
    it("willing + willing, both later", () =>
      expect(classifyMatch(a("if-partner-wants", "later"), a("if-partner-wants", "later"))).toBe("match"));
    it("yes null + yes now", () => expect(classifyMatch(a("yes", null), a("yes", "now"))).toBe("match"));
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
    it("yes + maybe", () => expect(classifyMatch(a("yes", "now"), a("maybe"))).toBe("possible"));
    it("maybe + yes", () => expect(classifyMatch(a("maybe"), a("yes", "later"))).toBe("possible"));
    it("willing + maybe", () => expect(classifyMatch(a("if-partner-wants", "now"), a("maybe"))).toBe("possible"));
    it("maybe + willing", () => expect(classifyMatch(a("maybe"), a("if-partner-wants", "later"))).toBe("possible"));
  });

  // --- Hidden (mixed with fantasy) ---
  describe("hidden — fantasy + non-fantasy (except both-fantasy)", () => {
    it("fantasy + yes", () => expect(classifyMatch(a("fantasy"), a("yes", "now"))).toBe("hidden"));
    it("yes + fantasy", () => expect(classifyMatch(a("yes", "now"), a("fantasy"))).toBe("hidden"));
    it("fantasy + maybe", () => expect(classifyMatch(a("fantasy"), a("maybe"))).toBe("hidden"));
    it("maybe + fantasy", () => expect(classifyMatch(a("maybe"), a("fantasy"))).toBe("hidden"));
    it("fantasy + willing", () => expect(classifyMatch(a("fantasy"), a("if-partner-wants", "now"))).toBe("hidden"));
    it("willing + fantasy", () => expect(classifyMatch(a("if-partner-wants", "later"), a("fantasy"))).toBe("hidden"));
  });

  // --- Symmetry ---
  describe("symmetry — order shouldn't matter", () => {
    const cases: [Answer, Answer, string][] = [
      [a("yes", "now"), a("maybe"), "possible"],
      [a("maybe"), a("yes", "now"), "possible"],
      [a("yes", "now"), a("no"), "hidden"],
      [a("no"), a("yes", "now"), "hidden"],
      [a("fantasy"), a("fantasy"), "fantasy"],
      [a("yes", "now"), a("if-partner-wants", "now"), "green-light"],
      [a("if-partner-wants", "now"), a("yes", "now"), "green-light"],
    ];
    for (const [answerA, answerB, expected] of cases) {
      it(`${answerA.rating}(${answerA.timing}) + ${answerB.rating}(${answerB.timing}) = ${expected}`, () => {
        expect(classifyMatch(answerA, answerB)).toBe(expected);
      });
    }
  });

  // --- Edge cases ---
  describe("edge cases", () => {
    it("showTiming disabled (null timing) — yes+yes = match not green-light", () => {
      expect(classifyMatch(a("yes", null), a("yes", null))).toBe("match");
    });
    it("one now one null — yes+yes = match", () => {
      expect(classifyMatch(a("yes", "now"), a("yes", null))).toBe("match");
    });
    it("if-partner-wants with null timing — still match", () => {
      expect(classifyMatch(a("if-partner-wants", null), a("if-partner-wants", null))).toBe("match");
    });
  });

  // --- Exhaustive truth table: all rating × rating pairs (null timing) ---
  describe("exhaustive rating × rating truth table (null timing)", () => {
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

  // --- Exhaustive timing matrix for yes/willing quadrant ---
  describe("timing matrix — yes/willing quadrant", () => {
    const willing = ["yes", "if-partner-wants"] as const;
    const timings = ["now", "later", null] as const;

    for (const rA of willing) {
      for (const rB of willing) {
        for (const tA of timings) {
          for (const tB of timings) {
            const expected: MatchType = tA === "now" && tB === "now" ? "green-light" : "match";
            it(`(${rA}/${tA}, ${rB}/${tB}) → ${expected}`, () => {
              expect(classifyMatch(a(rA, tA), a(rB, tB))).toBe(expected);
            });
          }
        }
      }
    }
  });
});
