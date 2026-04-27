import { asc, eq, notInArray, or } from "drizzle-orm";
import type { Database, Transaction } from "../db/index.js";
import { categories, questionDependencies, questions } from "../db/schema.js";

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
  notePrompt?: string;
  targetGive: "all" | "amab" | "afab";
  targetReceive: "all" | "amab" | "afab";
  requires: string[];
}

export interface SeedData {
  categories: SeedCategory[];
  questions: SeedQuestion[];
}

function validateDependencies(qs: SeedQuestion[]) {
  const byId = new Map(qs.map((q) => [q.id, q]));
  const indexById = new Map(qs.map((q, i) => [q.id, i]));

  for (let i = 0; i < qs.length; i++) {
    const q = qs[i];
    for (const parent of q.requires) {
      if (parent === q.id) {
        throw new Error(`Question "${q.id}" cannot require itself`);
      }
      const p = byId.get(parent);
      if (!p) {
        throw new Error(`Question "${q.id}" requires unknown question "${parent}"`);
      }
      if (q.tier < p.tier) {
        throw new Error(
          `Question "${q.id}" (tier ${q.tier}) requires "${parent}" (tier ${p.tier}); child tier must be >= parent tier`,
        );
      }
      // Seed array order = participant flow order. A child must come after
      // its parent so the gate question is answered before its dependents
      // appear in the flow.
      const parentIdx = indexById.get(parent);
      if (parentIdx !== undefined && parentIdx >= i) {
        throw new Error(
          `Question "${q.id}" (position ${i}) must appear after its parent "${parent}" (position ${parentIdx})`,
        );
      }
    }
  }

  // Topological sort to detect cycles.
  const remaining = new Set(qs.map((q) => q.id));
  const incoming = new Map<string, Set<string>>();
  for (const q of qs) incoming.set(q.id, new Set(q.requires));

  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) => (incoming.get(id) ?? new Set()).size === 0);
    if (ready.length === 0) {
      throw new Error(`Dependency cycle detected involving: ${[...remaining].join(", ")}`);
    }
    for (const id of ready) {
      remaining.delete(id);
      for (const r of remaining) incoming.get(r)?.delete(id);
    }
  }
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
          notePrompt: questions.notePrompt,
          targetGive: questions.targetGive,
          targetReceive: questions.targetReceive,
          tier: questions.tier,
          sortOrder: questions.sortOrder,
        })
        .from(questions)
        .innerJoin(categories, eq(questions.categoryId, categories.id))
        .orderBy(asc(categories.sortOrder), asc(questions.sortOrder));

      const allDeps = await tx
        .select({
          questionId: questionDependencies.questionId,
          requiresQuestionId: questionDependencies.requiresQuestionId,
        })
        .from(questionDependencies);

      const requiresByQuestion = new Map<string, string[]>();
      for (const d of allDeps) {
        const list = requiresByQuestion.get(d.questionId) ?? [];
        list.push(d.requiresQuestionId);
        requiresByQuestion.set(d.questionId, list);
      }

      const withRequires = allQuestions.map((q) => ({
        ...q,
        requires: requiresByQuestion.get(q.id) ?? [],
      }));

      return { categories: allCategories, questions: withRequires };
    });
  }

  async seed(data: SeedData) {
    validateDependencies(data.questions);

    const seedCategoryIds = data.categories.map((c) => c.id);
    const seedQuestionIds = data.questions.map((q) => q.id);

    await this.#tx(async (tx) => {
      // Sync reference data: delete rows that disappeared from the seed
      // around upserting current rows. Without this, removed questions
      // (e.g. threesome-mff after the bank reorg) would linger and `list()`
      // would still return them.
      //
      // Order is constrained by FKs:
      //   1. Stale dependency rows first — `requires_question_id` has
      //      `onDelete: restrict`, so a stale parent can't be deleted while
      //      a stale dep still references it.
      //   2. Stale questions next — only safe once their deps are gone.
      //   3. Upsert categories then questions — this moves any kept
      //      question off a soon-to-be-removed category onto its new one.
      //   4. Stale categories LAST — `questions.categoryId` has default
      //      NO ACTION, so deleting an old category before the question
      //      upsert moves a kept question off it would FK-violate.
      // Empty `seed*Ids` are defensively guarded so a misconfigured seed
      // can't wipe the table.
      if (seedQuestionIds.length > 0) {
        await tx
          .delete(questionDependencies)
          .where(
            or(
              notInArray(questionDependencies.questionId, seedQuestionIds),
              notInArray(questionDependencies.requiresQuestionId, seedQuestionIds),
            ),
          );
        await tx.delete(questions).where(notInArray(questions.id, seedQuestionIds));
      }

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
            notePrompt: q.notePrompt ?? null,
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
              notePrompt: q.notePrompt ?? null,
              targetGive: q.targetGive,
              targetReceive: q.targetReceive,
              tier: q.tier,
              sortOrder: sortWithinCategory,
            },
          });
      }

      // Now that every kept question has been upserted with its current
      // categoryId, stale categories are no longer referenced and safe to
      // delete.
      if (seedCategoryIds.length > 0) {
        await tx.delete(categories).where(notInArray(categories.id, seedCategoryIds));
      }

      // Sync dependencies: delete all rows for questions in the seed, then re-insert.
      // Questions removed from the seed (and any orphan dep rows) are not touched here.
      for (const q of data.questions) {
        await tx.delete(questionDependencies).where(eq(questionDependencies.questionId, q.id));
        for (const parent of q.requires) {
          await tx.insert(questionDependencies).values({
            questionId: q.id,
            requiresQuestionId: parent,
          });
        }
      }
    });
  }
}
