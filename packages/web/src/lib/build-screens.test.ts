import type { CategoryData, QuestionData } from "@spreadsheet/shared";
import { describe, expect, it } from "vitest";
import { buildScreens, filterQuestionScreens } from "./build-screens.js";

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
