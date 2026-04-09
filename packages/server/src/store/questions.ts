import { asc, eq } from "drizzle-orm";
import type { Database, Transaction } from "../db/index.js";
import { categories, questions } from "../db/schema.js";

interface SeedCategory {
  id: string;
  label: string;
  description: string;
}

interface SeedQuestion {
  id: string;
  category: string;
  tier: number;
  text: string;
  giveText?: string;
  receiveText?: string;
  description?: string;
  targetGive: "all" | "amab" | "afab";
  targetReceive: "all" | "amab" | "afab";
}

export interface SeedData {
  categories: SeedCategory[];
  questions: SeedQuestion[];
}

export class QuestionStore {
  #tx: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;

  constructor(db: Database) {
    // biome-ignore lint/suspicious/noExplicitAny: Database.transaction types vary by driver
    this.#tx = (fn) => (db as any).transaction(fn);
  }

  async list() {
    return this.#tx(async (tx) => {
      const allCategories = await tx.select().from(categories).orderBy(asc(categories.sortOrder));

      const allQuestions = await tx
        .select({
          id: questions.id,
          categoryId: questions.categoryId,
          text: questions.text,
          giveText: questions.giveText,
          receiveText: questions.receiveText,
          description: questions.description,
          targetGive: questions.targetGive,
          targetReceive: questions.targetReceive,
          tier: questions.tier,
          sortOrder: questions.sortOrder,
        })
        .from(questions)
        .innerJoin(categories, eq(questions.categoryId, categories.id))
        .orderBy(asc(categories.sortOrder), asc(questions.sortOrder));

      return { categories: allCategories, questions: allQuestions };
    });
  }

  async seed(data: SeedData) {
    await this.#tx(async (tx) => {
      for (let i = 0; i < data.categories.length; i++) {
        const cat = data.categories[i];
        await tx
          .insert(categories)
          .values({
            id: cat.id,
            label: cat.label,
            description: cat.description,
            sortOrder: i + 1,
          })
          .onConflictDoUpdate({
            target: categories.id,
            set: { label: cat.label, description: cat.description, sortOrder: i + 1 },
          });
      }

      const sortOrders = new Map<string, number>();
      const categoryCounts = new Map<string, number>();
      for (const q of data.questions) {
        const count = (categoryCounts.get(q.category) ?? 0) + 1;
        categoryCounts.set(q.category, count);
        sortOrders.set(q.id, count);
      }

      for (const q of data.questions) {
        const sortWithinCategory = sortOrders.get(q.id) ?? 1;
        await tx
          .insert(questions)
          .values({
            id: q.id,
            categoryId: q.category,
            text: q.text,
            giveText: q.giveText ?? null,
            receiveText: q.receiveText ?? null,
            description: q.description ?? null,
            targetGive: q.targetGive,
            targetReceive: q.targetReceive,
            tier: q.tier,
            sortOrder: sortWithinCategory,
          })
          .onConflictDoUpdate({
            target: questions.id,
            set: {
              categoryId: q.category,
              text: q.text,
              giveText: q.giveText ?? null,
              receiveText: q.receiveText ?? null,
              description: q.description ?? null,
              targetGive: q.targetGive,
              targetReceive: q.targetReceive,
              tier: q.tier,
              sortOrder: sortWithinCategory,
            },
          });
      }
    });
  }
}
