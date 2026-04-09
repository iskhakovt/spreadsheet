import { count } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { QuestionStore } from "../store/questions.js";
import { createDatabase, type Database } from "./index.js";
import { categories, questions } from "./schema.js";
import { seed } from "./seed.js";

let db: Database;

beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set — integration setup failed");
  db = createDatabase(url);
});

describe("schema on real Postgres", () => {
  it("has all required tables", async () => {
    await db.select({ n: count() }).from(categories);
    await db.select({ n: count() }).from(questions);
  });
});

describe("seed data on real Postgres", () => {
  it("inserts all categories and questions", async () => {
    await seed(new QuestionStore(db));

    const [catCount] = await db.select({ n: count() }).from(categories);
    expect(catCount.n).toBeGreaterThan(10);

    const [qCount] = await db.select({ n: count() }).from(questions);
    expect(qCount.n).toBeGreaterThan(100);
  });

  it("upserts without duplicates when run twice", async () => {
    const [before] = await db.select({ n: count() }).from(questions);
    await seed(new QuestionStore(db));
    const [after] = await db.select({ n: count() }).from(questions);
    expect(before.n).toBe(after.n);
  });

  it("all questions have a valid tier (1, 2, or 3)", async () => {
    const rows = await db.select({ tier: questions.tier }).from(questions);

    for (const row of rows) {
      expect([1, 2, 3]).toContain(row.tier);
    }
  });

  it("every tier has at least one question", async () => {
    const rows = await db.select({ tier: questions.tier, n: count() }).from(questions).groupBy(questions.tier);

    const tierMap = Object.fromEntries(rows.map((r) => [r.tier, r.n]));
    expect(tierMap[1]).toBeGreaterThan(0);
    expect(tierMap[2]).toBeGreaterThan(0);
    expect(tierMap[3]).toBeGreaterThan(0);
  });

  it("upsert preserves tier values on re-seed", async () => {
    const [_before] = await db
      .select({ tier: questions.tier, n: count() })
      .from(questions)
      .groupBy(questions.tier)
      .orderBy(questions.tier);

    await seed(new QuestionStore(db));

    const after = await db
      .select({ tier: questions.tier, n: count() })
      .from(questions)
      .groupBy(questions.tier)
      .orderBy(questions.tier);

    const tierMap = Object.fromEntries(after.map((r) => [r.tier, r.n]));
    expect(tierMap[1]).toBeGreaterThan(30);
    expect(tierMap[2]).toBeGreaterThan(30);
    expect(tierMap[3]).toBeGreaterThan(20);
  });
});
