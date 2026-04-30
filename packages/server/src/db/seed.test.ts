import { describe, expect, it } from "vitest";
import { loadSeedData } from "./seed.js";

describe("questions.yml — requiresGroupAnatomy migrations", () => {
  // Pin the curated values so a typo in the bank ([amap] etc.) trips the
  // test rather than silently shipping a question that no longer gates.
  const seed = loadSeedData();
  const byId = Object.fromEntries(seed.questions.map((q) => [q.id, q]));

  it("gates pregnancy-risk questions on the presence of both amab and afab", () => {
    expect(byId["pull-out"].requiresGroupAnatomy).toEqual(["amab", "afab"]);
    expect(byId["emergency-contraception"].requiresGroupAnatomy).toEqual(["amab", "afab"]);
    expect(byId["birth-control-only"].requiresGroupAnatomy).toEqual(["amab", "afab"]);
    expect(byId["pregnancy-risk-bare"].requiresGroupAnatomy).toEqual(["amab", "afab"]);
  });

  it("gates condom-norm questions on the presence of amab only", () => {
    expect(byId["condoms-always"].requiresGroupAnatomy).toEqual(["amab"]);
    expect(byId["condoms-fluid-bonded"].requiresGroupAnatomy).toEqual(["amab"]);
  });

  it("leaves unrelated questions ungated by default", () => {
    expect(byId["kissing-mouth"].requiresGroupAnatomy).toEqual([]);
    expect(byId["sex-generally"].requiresGroupAnatomy).toEqual([]);
  });
});
