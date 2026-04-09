import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { decodeStoken, encodeStoken } from "../stoken.js";
import type { Database, Transaction } from "../db/index.js";
import { journalEntries, persons } from "../db/schema.js";

export class SyncStore {
  #tx: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;

  constructor(db: Database) {
    // biome-ignore lint/suspicious/noExplicitAny: Database.transaction types vary by driver
    this.#tx = (fn) => (db as any).transaction(fn);
  }

  async push(
    personId: string,
    input: { stoken: string | null; operations: string[]; progress: string | null },
  ) {
    return this.#tx(async (tx) => {
      if (input.progress !== null) {
        await tx.update(persons).set({ progress: input.progress }).where(eq(persons.id, personId));
      }

      const [head] = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(eq(journalEntries.personId, personId))
        .orderBy(desc(journalEntries.id))
        .limit(1);

      const currentHead = head?.id ?? 0;
      const clientHead = input.stoken ? decodeStoken(input.stoken) : 0;

      if (clientHead !== currentHead) {
        const entries = await tx
          .select({ operation: journalEntries.operation })
          .from(journalEntries)
          .where(and(eq(journalEntries.personId, personId), gt(journalEntries.id, clientHead)));

        return {
          stoken: currentHead > 0 ? encodeStoken(currentHead) : null,
          entries: entries.map((e) => e.operation),
          pushRejected: true as const,
        };
      }

      let lastId = currentHead;
      if (input.operations.length > 0) {
        const inserted = await tx
          .insert(journalEntries)
          .values(input.operations.map((operation) => ({ personId, operation })))
          .returning({ id: journalEntries.id });
        lastId = inserted[inserted.length - 1].id;
      }

      const entries = await tx
        .select({ operation: journalEntries.operation })
        .from(journalEntries)
        .where(and(eq(journalEntries.personId, personId), gt(journalEntries.id, clientHead)));

      return {
        stoken: lastId > 0 ? encodeStoken(lastId) : null,
        entries: entries.map((e) => e.operation),
        pushRejected: false as const,
      };
    });
  }

  async markComplete(personId: string) {
    await this.#tx(async (tx) => {
      await tx.update(persons).set({ isCompleted: true }).where(eq(persons.id, personId));
    });
  }

  async unmarkComplete(personId: string) {
    await this.#tx(async (tx) => {
      await tx.update(persons).set({ isCompleted: false }).where(eq(persons.id, personId));
    });
  }

  async compare(groupId: string): Promise<
    | { members: { id: string; name: string; anatomy: string | null }[]; entries: { personId: string; operation: string }[] }
    | { error: "not_all_complete" }
  > {
    return this.#tx(async (tx) => {
      const members = await tx.select().from(persons).where(eq(persons.groupId, groupId));

      if (!members.every((m) => m.isCompleted)) {
        return { error: "not_all_complete" as const };
      }

      const memberIds = members.map((m) => m.id);
      const entries = await tx
        .select({ personId: journalEntries.personId, operation: journalEntries.operation })
        .from(journalEntries)
        .where(inArray(journalEntries.personId, memberIds))
        .orderBy(journalEntries.id);

      return {
        members: members.map((m) => ({ id: m.id, name: m.name, anatomy: m.anatomy })),
        entries: entries.map((e) => ({ personId: e.personId, operation: e.operation })),
      };
    });
  }
}
