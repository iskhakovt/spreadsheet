import type { Answer } from "@spreadsheet/shared";
import { describe, expect, it } from "vitest";
import { classifyMatch, type MatchType } from "./classify-match.js";

function a(rating: Answer["rating"]): Answer {
  return { rating, note: null };
}

const R = ["yes", "if-partner-wants", "maybe", "fantasy", "no"] as const;

describe("classifyMatch — activity (default)", () => {
  // Exhaustive 5×5 rating × rating truth table — covers every classification
  // plus symmetry, since every (rA, rB) and (rB, rA) cell is exercised
  // independently. No separate per-case tests needed; the table is the spec.
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
        // No third arg → defaults to "activity"; pass it explicitly too as a sanity check.
        expect(classifyMatch(a(R[i]), a(R[j]))).toBe(table[i][j]);
        expect(classifyMatch(a(R[i]), a(R[j]), "activity")).toBe(table[i][j]);
      });
    }
  }
});

describe("classifyMatch — agreement", () => {
  // Symmetric norm. `if-partner-wants` defers to the partner's definite stance:
  // willing+yes lands "in" (aligned-yes), willing+no lands "out" (aligned-no).
  // The only hard clash is yes-vs-no → differ. Any unresolved maybe/fantasy →
  // both-maybe.
  //                      yes            ipw            maybe         fantasy       no
  const table: MatchType[][] = [
    /* yes     */ ["aligned-yes", "aligned-yes", "both-maybe", "both-maybe", "differ"],
    /* ipw     */ ["aligned-yes", "aligned-yes", "both-maybe", "both-maybe", "aligned-no"],
    /* maybe   */ ["both-maybe", "both-maybe", "both-maybe", "both-maybe", "both-maybe"],
    /* fantasy */ ["both-maybe", "both-maybe", "both-maybe", "both-maybe", "both-maybe"],
    /* no      */ ["differ", "aligned-no", "both-maybe", "both-maybe", "aligned-no"],
  ];

  for (let i = 0; i < R.length; i++) {
    for (let j = 0; j < R.length; j++) {
      it(`(${R[i]}, ${R[j]}) → ${table[i][j]}`, () => {
        expect(classifyMatch(a(R[i]), a(R[j]), "agreement")).toBe(table[i][j]);
      });
    }
  }

  it("if-partner-wants + no resolves to aligned-no, not differ (defer to the partner's 'no')", () => {
    expect(classifyMatch(a("if-partner-wants"), a("no"), "agreement")).toBe("aligned-no");
    expect(classifyMatch(a("no"), a("if-partner-wants"), "agreement")).toBe("aligned-no");
  });
});

describe("classifyMatch — disclose", () => {
  // Surfaced as "noted" with no verdict — the partner sees the stated
  // preference regardless of overlap. The one exception: both declined with
  // no note → nothing to disclose → hidden.
  for (const ri of R) {
    for (const rj of R) {
      const expected = ri === "no" && rj === "no" ? "hidden" : "noted";
      it(`(${ri}, ${rj}) → ${expected}`, () => {
        expect(classifyMatch(a(ri), a(rj), "disclose")).toBe(expected);
      });
    }
  }

  it("both no but a note exists → noted (there is something to disclose)", () => {
    expect(classifyMatch({ rating: "no", note: "kept natural" }, { rating: "no", note: null }, "disclose")).toBe(
      "noted",
    );
    expect(classifyMatch({ rating: "no", note: null }, { rating: "no", note: "kept natural" }, "disclose")).toBe(
      "noted",
    );
  });
});
