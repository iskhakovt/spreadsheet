import type { Answer, CategoryData, QuestionData } from "@spreadsheet/shared";
import { describe, expect, it } from "vitest";
import { buildCategoryAnswerStats, buildScreens, filterQuestionScreens, type Screen } from "./build-screens.js";

const categories: Record<string, CategoryData> = {
  oral: { id: "oral", label: "Oral", description: "Oral activities", sortOrder: 1 },
  touch: { id: "touch", label: "Touch", description: "Touch activities", sortOrder: 2 },
};

function q(overrides: Partial<QuestionData> & { id: string; categoryId: string }): QuestionData {
  return {
    text: overrides.id,
    giveText: null,
    receiveText: null,
    description: null,
    targetGive: "all",
    targetReceive: "all",
    tier: 1,
    ...overrides,
  };
}

describe("buildScreens", () => {
  it("inserts welcome screens at category boundaries", () => {
    const questions = [q({ id: "q1", categoryId: "oral" }), q({ id: "q2", categoryId: "touch" })];
    const screens = buildScreens(questions, ["oral", "touch"], "amab", ["afab"], "all", categories);

    expect(screens[0]).toMatchObject({ type: "welcome", categoryId: "oral" });
    expect(screens[1]).toMatchObject({ type: "question", key: "q1:mutual" });
    expect(screens[2]).toMatchObject({ type: "welcome", categoryId: "touch" });
    expect(screens[3]).toMatchObject({ type: "question", key: "q2:mutual" });
  });

  it("creates give + receive screens for role-based questions", () => {
    const questions = [
      q({
        id: "cunnilingus",
        categoryId: "oral",
        giveText: "Going down",
        receiveText: "Receiving oral",
        targetGive: "all",
        targetReceive: "afab",
      }),
    ];
    const screens = buildScreens(questions, ["oral"], "amab", ["afab"], "all", categories);
    const qScreens = filterQuestionScreens(screens);

    expect(qScreens).toHaveLength(2);
    expect(qScreens[0].key).toBe("cunnilingus:give");
    expect(qScreens[1].key).toBe("cunnilingus:receive");
  });

  it("filters by anatomy in filtered mode — give side", () => {
    const questions = [
      q({
        id: "q1",
        categoryId: "oral",
        giveText: "Give",
        receiveText: "Receive",
        targetGive: "afab",
        targetReceive: "all",
      }),
    ];
    // User is amab → can't give (targetGive=afab), but can receive (targetReceive=all)
    const screens = buildScreens(questions, ["oral"], "amab", ["afab"], "filtered", categories);
    const qScreens = filterQuestionScreens(screens);

    expect(qScreens).toHaveLength(1);
    expect(qScreens[0].key).toBe("q1:receive");
  });

  it("filters by anatomy in filtered mode — no matching partner", () => {
    const questions = [
      q({
        id: "q1",
        categoryId: "oral",
        giveText: "Give",
        receiveText: "Receive",
        targetGive: "all",
        targetReceive: "afab",
      }),
    ];
    // User is amab, all partners are also amab → no one can receive (targetReceive=afab)
    const screens = buildScreens(questions, ["oral"], "amab", ["amab"], "filtered", categories);
    const qScreens = filterQuestionScreens(screens);

    // Give screen hidden (no afab partner to receive), receive screen hidden (user is amab, not afab)
    expect(qScreens).toHaveLength(0);
  });

  it("shows all questions in 'all' mode regardless of anatomy", () => {
    const questions = [
      q({
        id: "q1",
        categoryId: "oral",
        giveText: "Give",
        receiveText: "Receive",
        targetGive: "afab",
        targetReceive: "amab",
      }),
    ];
    const screens = buildScreens(questions, ["oral"], "amab", ["amab"], "all", categories);
    const qScreens = filterQuestionScreens(screens);

    expect(qScreens).toHaveLength(2);
  });

  it("skips categories not in selectedCategories", () => {
    const questions = [q({ id: "q1", categoryId: "oral" }), q({ id: "q2", categoryId: "touch" })];
    const screens = buildScreens(questions, ["oral"], "amab", [], "all", categories);

    expect(screens.some((s) => s.type === "welcome" && s.categoryId === "touch")).toBe(false);
    expect(filterQuestionScreens(screens)).toHaveLength(1);
  });

  it("handles 'both' anatomy — matches own side, still needs partner match", () => {
    const questions = [
      q({
        id: "q1",
        categoryId: "oral",
        giveText: "Give",
        receiveText: "Receive",
        targetGive: "afab",
        targetReceive: "amab",
      }),
    ];
    // User "both" + partner "amab": give shows (user matches afab, partner matches amab)
    // Receive hidden (user matches amab, but no partner matches afab to give)
    const screens = buildScreens(questions, ["oral"], "both", ["amab"], "filtered", categories);
    expect(filterQuestionScreens(screens)).toHaveLength(1);
    expect(filterQuestionScreens(screens)[0].key).toBe("q1:give");

    // With an afab partner too, both screens show
    const screens2 = buildScreens(questions, ["oral"], "both", ["amab", "afab"], "filtered", categories);
    expect(filterQuestionScreens(screens2)).toHaveLength(2);
  });

  it("handles 'none' anatomy — matches nothing in filtered mode", () => {
    const questions = [
      q({
        id: "q1",
        categoryId: "oral",
        giveText: "Give",
        receiveText: "Receive",
        targetGive: "afab",
        targetReceive: "amab",
      }),
    ];
    const screens = buildScreens(questions, ["oral"], "none", ["amab"], "filtered", categories);
    const qScreens = filterQuestionScreens(screens);

    expect(qScreens).toHaveLength(0);
  });

  it("welcome screen includes correct question count", () => {
    const questions = [
      q({ id: "q1", categoryId: "oral" }),
      q({ id: "q2", categoryId: "oral" }),
      q({ id: "q3", categoryId: "oral", giveText: "Give", receiveText: "Receive" }),
    ];
    const screens = buildScreens(questions, ["oral"], "amab", ["afab"], "all", categories);
    const welcome = screens.find((s) => s.type === "welcome");

    // 2 mutual + 1 give + 1 receive = 4
    expect(welcome?.type === "welcome" && welcome.questionCount).toBe(4);
  });
});

describe("tier filtering", () => {
  it("maxTier=1 hides tier 2 and 3 questions", () => {
    const questions = [
      q({ id: "q1", categoryId: "oral", tier: 1 }),
      q({ id: "q2", categoryId: "oral", tier: 2 }),
      q({ id: "q3", categoryId: "oral", tier: 3 }),
    ];
    const screens = buildScreens(questions, ["oral"], "amab", [], "all", categories, 1);
    const qScreens = filterQuestionScreens(screens);

    expect(qScreens).toHaveLength(1);
    expect(qScreens[0].key).toBe("q1:mutual");
  });

  it("maxTier=2 shows tier 1 and 2, hides tier 3", () => {
    const questions = [
      q({ id: "q1", categoryId: "oral", tier: 1 }),
      q({ id: "q2", categoryId: "oral", tier: 2 }),
      q({ id: "q3", categoryId: "oral", tier: 3 }),
    ];
    const screens = buildScreens(questions, ["oral"], "amab", [], "all", categories, 2);
    const qScreens = filterQuestionScreens(screens);

    expect(qScreens).toHaveLength(2);
    expect(qScreens.map((s) => s.key)).toEqual(["q1:mutual", "q2:mutual"]);
  });

  it("maxTier=3 shows all questions", () => {
    const questions = [
      q({ id: "q1", categoryId: "oral", tier: 1 }),
      q({ id: "q2", categoryId: "oral", tier: 2 }),
      q({ id: "q3", categoryId: "oral", tier: 3 }),
    ];
    const screens = buildScreens(questions, ["oral"], "amab", [], "all", categories, 3);
    const qScreens = filterQuestionScreens(screens);

    expect(qScreens).toHaveLength(3);
  });

  it("defaults to showing all tiers when maxTier omitted", () => {
    const questions = [q({ id: "q1", categoryId: "oral", tier: 1 }), q({ id: "q2", categoryId: "oral", tier: 3 })];
    const screens = buildScreens(questions, ["oral"], "amab", [], "all", categories);
    const qScreens = filterQuestionScreens(screens);

    expect(qScreens).toHaveLength(2);
  });

  it("welcome screen question count respects tier filter", () => {
    const questions = [
      q({ id: "q1", categoryId: "oral", tier: 1 }),
      q({ id: "q2", categoryId: "oral", tier: 2 }),
      q({ id: "q3", categoryId: "oral", tier: 3 }),
    ];
    const screens = buildScreens(questions, ["oral"], "amab", [], "all", categories, 1);
    const welcome = screens.find((s) => s.type === "welcome");

    expect(welcome?.type === "welcome" && welcome.questionCount).toBe(1);
  });

  it("skips welcome screen when tier filters remove all questions in a category", () => {
    const questions = [q({ id: "q1", categoryId: "oral", tier: 3 }), q({ id: "q2", categoryId: "touch", tier: 1 })];
    const screens = buildScreens(questions, ["oral", "touch"], "amab", [], "all", categories, 1);

    // oral should be skipped entirely (only tier 3), touch should appear
    expect(screens.some((s) => s.type === "welcome" && s.categoryId === "oral")).toBe(false);
    expect(screens.some((s) => s.type === "welcome" && s.categoryId === "touch")).toBe(true);
    expect(filterQuestionScreens(screens)).toHaveLength(1);
  });

  it("tier + category + anatomy filters compose", () => {
    const questions = [
      q({
        id: "q1",
        categoryId: "oral",
        tier: 1,
        giveText: "Give",
        receiveText: "Receive",
        targetGive: "afab",
        targetReceive: "amab",
      }),
      q({
        id: "q2",
        categoryId: "oral",
        tier: 2,
        giveText: "Give",
        receiveText: "Receive",
        targetGive: "all",
        targetReceive: "all",
      }),
      q({ id: "q3", categoryId: "touch", tier: 1 }),
    ];
    // amab user, afab partner, maxTier=1: q1 receive only (user is amab=targetReceive), q3 mutual, q2 excluded by tier
    const screens = buildScreens(questions, ["oral", "touch"], "amab", ["afab"], "filtered", categories, 1);
    const qScreens = filterQuestionScreens(screens);

    expect(qScreens).toHaveLength(2);
    expect(qScreens[0].key).toBe("q1:receive");
    expect(qScreens[1].key).toBe("q3:mutual");
  });
});

describe("buildCategoryAnswerStats", () => {
  // Small helpers for the Screen union variants. Keeps the tests readable
  // and lets the type-checker catch field drift.
  const welcome = (categoryId: string, questionCount = 1): Screen => ({
    type: "welcome",
    categoryId,
    questionCount,
    key: `welcome:${categoryId}`,
  });
  const question = (categoryId: string, id: string): Screen => ({
    type: "question",
    question: q({ id, categoryId }),
    role: "mutual",
    displayText: id,
    key: `${id}:mutual`,
    categoryId,
  });
  const answer: Answer = { rating: "yes", timing: null };

  it("returns an empty map when there are no question screens", () => {
    const stats = buildCategoryAnswerStats([], {});
    expect(stats.size).toBe(0);
  });

  it("skips welcome screens (only questions contribute entries)", () => {
    const stats = buildCategoryAnswerStats([welcome("oral"), welcome("touch")], {});
    expect(stats.size).toBe(0);
  });

  it("creates one entry per category with at least one question", () => {
    const screens = [welcome("oral"), question("oral", "q1"), welcome("touch"), question("touch", "q2")];
    const stats = buildCategoryAnswerStats(screens, {});
    expect(stats.size).toBe(2);
    expect(stats.has("oral")).toBe(true);
    expect(stats.has("touch")).toBe(true);
  });

  it("fresh category → hasAnswers=false, firstUnansweredIdx = first question's absolute index", () => {
    const screens = [welcome("oral"), question("oral", "q1"), question("oral", "q2"), question("oral", "q3")];
    const stats = buildCategoryAnswerStats(screens, {});
    expect(stats.get("oral")).toEqual({ hasAnswers: false, firstUnansweredIdx: 1 });
  });

  it("fully-answered category → hasAnswers=true, firstUnansweredIdx=-1", () => {
    const screens = [welcome("oral"), question("oral", "q1"), question("oral", "q2")];
    const answers = { "q1:mutual": answer, "q2:mutual": answer };
    const stats = buildCategoryAnswerStats(screens, answers);
    expect(stats.get("oral")).toEqual({ hasAnswers: true, firstUnansweredIdx: -1 });
  });

  it("partially-answered category → hasAnswers=true, firstUnansweredIdx = FIRST unanswered's absolute index", () => {
    // q1 answered, q2 unanswered, q3 answered, q4 unanswered — first
    // unanswered is q2 at absolute index 2.
    const screens = [
      welcome("oral"),
      question("oral", "q1"),
      question("oral", "q2"),
      question("oral", "q3"),
      question("oral", "q4"),
    ];
    const answers = { "q1:mutual": answer, "q3:mutual": answer };
    const stats = buildCategoryAnswerStats(screens, answers);
    expect(stats.get("oral")).toEqual({ hasAnswers: true, firstUnansweredIdx: 2 });
  });

  it("handles multiple categories independently, preserving absolute indices", () => {
    const screens = [
      welcome("oral"),
      question("oral", "q1"),
      question("oral", "q2"),
      welcome("touch"),
      question("touch", "q3"),
      question("touch", "q4"),
    ];
    const answers = { "q1:mutual": answer, "q4:mutual": answer };
    const stats = buildCategoryAnswerStats(screens, answers);
    expect(stats.get("oral")).toEqual({ hasAnswers: true, firstUnansweredIdx: 2 });
    expect(stats.get("touch")).toEqual({ hasAnswers: true, firstUnansweredIdx: 4 });
  });

  it("a later answered question doesn't clear an earlier firstUnansweredIdx", () => {
    // Guards the one-way-write invariant: once firstUnansweredIdx is set
    // it must not be overwritten by a subsequent iteration.
    const screens = [welcome("oral"), question("oral", "q1"), question("oral", "q2"), question("oral", "q3")];
    const answers = { "q2:mutual": answer };
    const stats = buildCategoryAnswerStats(screens, answers);
    expect(stats.get("oral")?.firstUnansweredIdx).toBe(1);
  });
});
