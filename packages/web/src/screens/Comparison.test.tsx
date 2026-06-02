/** @vitest-environment happy-dom */
import type { Answer, QuestionData } from "@spreadsheet/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { QuestionInfo } from "../lib/build-pair-matches.js";
import type { MemberAnswers } from "../lib/journal-query.js";
import { PairComparison } from "./Comparison.js";

/**
 * Integration test for the orphaned-answer guard: a stored answer for a
 * question that isn't visible to a pair must not surface as a match row in
 * the rendered results. Exercises the real render pipeline end to end —
 * filterVisibleAnswers → buildPairMatches → buildGroupedMatches → DOM — so a
 * regression in the *wiring* (e.g. filtering against group-wide instead of
 * the partner's anatomy) is caught, not just the pure filter function.
 */

const yes: Answer = { rating: "yes", note: null };

function qData(overrides: Partial<QuestionData> & { id: string }): QuestionData {
  return {
    categoryId: "cat",
    text: overrides.id,
    giveText: null,
    receiveText: null,
    description: null,
    notePrompt: null,
    targetGive: "all",
    targetReceive: "all",
    requiresGroupAnatomy: [],
    tier: 1,
    requires: [],
    ...overrides,
  };
}

// cat-position: a PIV row gated on the group having BOTH anatomies. kissing:
// anatomy-agnostic. Both are answered by every member below; whether each
// surfaces depends purely on the pair's anatomy.
const catPosition = qData({
  id: "cat-position",
  text: "Coital alignment technique (CAT)",
  requiresGroupAnatomy: ["amab", "afab"],
});
const kissing = qData({ id: "kissing", text: "Kissing" });

const questionsById = new Map<string, QuestionData>([catPosition, kissing].map((q) => [q.id, q]));
const questions: Record<string, QuestionInfo> = {
  "cat-position": { text: catPosition.text, categoryId: "cat", giveText: null, receiveText: null },
  kissing: { text: kissing.text, categoryId: "cat", giveText: null, receiveText: null },
};
const categories = { cat: "Category" };
const categoryOrder = ["cat"];
const questionOrder = { "cat-position": 0, kissing: 1 };

// Every member has answered both questions — the orphaned-answer scenario.
function member(id: string, name: string, anatomy: string): MemberAnswers {
  return { id, name, anatomy, answers: { "cat-position:mutual": yes, "kissing:mutual": yes } };
}

function renderPair(a: MemberAnswers, b: MemberAnswers) {
  return render(
    createElement(PairComparison, {
      a,
      b,
      aDisplayName: a.name,
      bDisplayName: b.name,
      aIsViewer: true,
      bIsViewer: false,
      questions,
      questionsById,
      questionMode: "filtered",
      categories,
      categoryOrder,
      questionOrder,
      showHeading: false,
    }),
  );
}

afterEach(cleanup);

describe("PairComparison — orphaned answers are filtered from the rendered results", () => {
  it("hides a group-gated row for a pair lacking the anatomy, though both answered it", () => {
    // Penis–penis pair. Both answered cat-position (it was visible in their
    // flow because the wider group had a vulva), but it can't apply to THIS
    // pair, so it must not appear in their results.
    renderPair(member("m1", "Al", "amab"), member("m2", "Bo", "amab"));

    expect(screen.getAllByTestId("match-row")).toHaveLength(1);
    expect(screen.getByText("Kissing")).toBeTruthy();
    expect(screen.queryByText("Coital alignment technique (CAT)")).toBeNull();
    expect(screen.getByTestId("total-matches-count").textContent).toBe("1");
  });

  it("keeps the same row for a pair the gate applies to", () => {
    // Penis–vulva pair → cat-position is relevant and surfaces alongside kissing.
    renderPair(member("m1", "Al", "amab"), member("f1", "Cara", "afab"));

    expect(screen.getByText("Coital alignment technique (CAT)")).toBeTruthy();
    expect(screen.getByText("Kissing")).toBeTruthy();
    expect(screen.getByTestId("total-matches-count").textContent).toBe("2");
  });
});
