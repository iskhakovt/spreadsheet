import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/index.js";
import { categories, questionDependencies, questions } from "../db/schema.js";
import { createTestDatabase, truncateAll } from "../test/pglite.js";
import { QuestionStore, type SeedData } from "./questions.js";

let db: Database;
let close: () => Promise<void>;
let store: QuestionStore;

beforeAll(async () => {
  const result = await createTestDatabase();
  db = result.db;
  close = result.close;
  store = new QuestionStore(db);
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await truncateAll(db);
});

/** Snapshot of the three reference-data tables, ordered for stable comparison. */
async function snapshot() {
  const cats = await db.select().from(categories).orderBy(categories.id);
  const qs = await db.select().from(questions).orderBy(questions.id);
  const deps = await db
    .select()
    .from(questionDependencies)
    .orderBy(questionDependencies.questionId, questionDependencies.requiresQuestionId);
  return { cats, qs, deps };
}

function q(overrides: { id: string; category: string; requires?: string[] }) {
  return {
    id: overrides.id,
    category: overrides.category,
    tier: 1,
    text: overrides.id,
    targetGive: "all" as const,
    targetReceive: "all" as const,
    requires: overrides.requires ?? [],
  };
}

describe("QuestionStore.seed — upgrade equivalence", () => {
  it("applying old then new yields the same state as applying only new", async () => {
    // "Old" seed: three categories, deps point in various directions, one
    // question lives in a category that won't survive the upgrade.
    const oldSeed: SeedData = {
      categories: [
        { id: "cat-a", label: "Cat A", description: "first" },
        { id: "cat-b", label: "Cat B", description: "second" },
        { id: "removed-cat", label: "Doomed", description: "going away" },
      ],
      questions: [
        q({ id: "q1", category: "cat-a" }),
        q({ id: "q2", category: "cat-a", requires: ["q1"] }),
        q({ id: "q3", category: "cat-b" }),
        q({ id: "q4-going", category: "cat-b" }),
        q({ id: "q5-going", category: "removed-cat" }),
      ],
    };

    // "New" seed: removed-cat is gone, q4-going + q5-going are gone, q3 has
    // moved to cat-a (kept question changing category — the FK-order edge
    // case), a new cat-c with q6 lands, and a new dep is added.
    const newSeed: SeedData = {
      categories: [
        { id: "cat-a", label: "Cat A renamed", description: "first" },
        { id: "cat-b", label: "Cat B", description: "second" },
        { id: "cat-c", label: "Cat C", description: "new" },
      ],
      questions: [
        q({ id: "q1", category: "cat-a" }),
        q({ id: "q2", category: "cat-a", requires: ["q1"] }),
        q({ id: "q3", category: "cat-a" }), // moved from cat-b
        q({ id: "q6", category: "cat-c", requires: ["q3"] }), // new
      ],
    };

    // Path A: apply old, then upgrade to new.
    await store.seed(oldSeed);
    await store.seed(newSeed);
    const upgraded = await snapshot();

    // Path B: clean slate, apply only new.
    await truncateAll(db);
    await store.seed(newSeed);
    const fresh = await snapshot();

    expect(upgraded).toEqual(fresh);
  });

  it("removes stale categories, questions, and dependencies on re-seed", async () => {
    await store.seed({
      categories: [{ id: "stale", label: "Stale", description: "" }],
      questions: [q({ id: "old1", category: "stale" }), q({ id: "old2", category: "stale", requires: ["old1"] })],
    });

    await store.seed({
      categories: [{ id: "fresh", label: "Fresh", description: "" }],
      questions: [q({ id: "new1", category: "fresh" })],
    });

    const { cats, qs, deps } = await snapshot();
    expect(cats.map((c) => c.id)).toEqual(["fresh"]);
    expect(qs.map((q) => q.id)).toEqual(["new1"]);
    expect(deps).toEqual([]);
  });

  it("rejects a seed where a child appears before its parent", async () => {
    // Array order = participant flow order; the child question must appear
    // AFTER its parent so the gate is answered before dependents render.
    const badSeed: SeedData = {
      categories: [{ id: "cat-a", label: "Cat A", description: "" }],
      questions: [
        // child listed first
        q({ id: "child", category: "cat-a", requires: ["parent"] }),
        q({ id: "parent", category: "cat-a" }),
      ],
    };

    await expect(store.seed(badSeed)).rejects.toThrow(/must appear after its parent/);
  });

  it("moves a kept question to a new category when its old category is removed", async () => {
    // Regression test: deleting `cat-old` before the question upsert moves
    // q-kept off it would FK-violate (questions.categoryId NO ACTION).
    await store.seed({
      categories: [
        { id: "cat-old", label: "Old", description: "" },
        { id: "cat-other", label: "Other", description: "" },
      ],
      questions: [q({ id: "q-kept", category: "cat-old" })],
    });

    await store.seed({
      categories: [{ id: "cat-other", label: "Other", description: "" }],
      questions: [q({ id: "q-kept", category: "cat-other" })],
    });

    const { cats, qs } = await snapshot();
    expect(cats.map((c) => c.id)).toEqual(["cat-other"]);
    expect(qs.map((q) => ({ id: q.id, categoryId: q.categoryId }))).toEqual([
      { id: "q-kept", categoryId: "cat-other" },
    ]);
  });
});
