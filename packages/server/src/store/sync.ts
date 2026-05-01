import { decodeOpaque, PREFIX_ENCRYPTED, PREFIX_PLAINTEXT } from "@spreadsheet/shared";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import type { Database, Transaction } from "../db/index.js";
import { journalEntries, persons } from "../db/schema.js";
import { decodeStoken, encodeStoken } from "../stoken.js";

export class SyncStore {
  #tx: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;

  constructor(db: Database) {
    // biome-ignore lint/suspicious/noExplicitAny: Database.transaction types vary by driver
    this.#tx = (fn) => (db as any).transaction(fn);
  }

  async push(
    personId: string,
    input: { stoken: string | null; operations: string[]; progress?: string },
    groupEncrypted: boolean,
  ): Promise<
    | { error: "encryption_mismatch" }
    | {
        stoken: string | null;
        entries: string[];
        committedEntries: { id: number; personId: string; operation: string }[];
        pushRejected: boolean;
      }
  > {
    const expectedMode = groupEncrypted ? PREFIX_ENCRYPTED : PREFIX_PLAINTEXT;
    for (const op of input.operations) {
      const { mode } = decodeOpaque(op);
      if (mode !== expectedMode) {
        return { error: "encryption_mismatch" };
      }
    }

    return this.#tx(async (tx) => {
      if (input.progress !== undefined) {
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
          .where(and(eq(journalEntries.personId, personId), gt(journalEntries.id, clientHead)))
          .orderBy(journalEntries.id);

        return {
          stoken: currentHead > 0 ? encodeStoken(currentHead) : null,
          entries: entries.map((e) => e.operation),
          committedEntries: [],
          pushRejected: true as const,
        };
      }

      // The ops this call is about to commit — captured so the route can
      // propagate them to the journal event bus after the transaction commits.
      let committedEntries: { id: number; personId: string; operation: string }[] = [];
      let lastId = currentHead;
      if (input.operations.length > 0) {
        const inserted = await tx
          .insert(journalEntries)
          .values(input.operations.map((operation) => ({ personId, operation })))
          .returning({ id: journalEntries.id, operation: journalEntries.operation });
        committedEntries = inserted.map((r) => ({ id: r.id, personId, operation: r.operation }));
        lastId = inserted[inserted.length - 1].id;
      }

      const entries = await tx
        .select({ operation: journalEntries.operation })
        .from(journalEntries)
        .where(and(eq(journalEntries.personId, personId), gt(journalEntries.id, clientHead)))
        .orderBy(journalEntries.id);

      return {
        stoken: lastId > 0 ? encodeStoken(lastId) : null,
        entries: entries.map((e) => e.operation),
        committedEntries,
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

  /**
   * Fetch the group's journal entries, optionally filtered by a cursor.
   *
   * - `sinceId: null` returns all entries for all members of the group.
   * - `sinceId: N` returns only entries with `id > N`.
   *
   * Precondition: all group members must have `isCompleted = true`. Returns
   * `{ error: "not_all_complete" }` otherwise. This gates the `/results` view
   * so partial journals can't leak while someone is still answering.
   *
   * The returned `cursor` is the highest entry id in this response, or the
   * input `sinceId` if the response is empty (so a polled/repeated caller
   * doesn't lose its cursor on an empty delta).
   */
  async journalSince(
    groupId: string,
    sinceId: number | null,
  ): Promise<
    | {
        members: { id: string; name: string; anatomy: string | null }[];
        entries: { id: number; personId: string; operation: string }[];
        cursor: number | null;
      }
    | { error: "not_all_complete" }
  > {
    return this.#tx(async (tx) => {
      const members = await tx
        .select()
        .from(persons)
        .where(eq(persons.groupId, groupId))
        .orderBy(persons.createdAt, persons.id);

      if (!members.every((m) => m.isCompleted)) {
        return { error: "not_all_complete" as const };
      }

      const memberIds = members.map((m) => m.id);
      const whereClause =
        sinceId !== null
          ? and(inArray(journalEntries.personId, memberIds), gt(journalEntries.id, sinceId))
          : inArray(journalEntries.personId, memberIds);

      const rows = await tx
        .select({
          id: journalEntries.id,
          personId: journalEntries.personId,
          operation: journalEntries.operation,
        })
        .from(journalEntries)
        .where(whereClause)
        .orderBy(journalEntries.id);

      const cursor = rows.length > 0 ? rows[rows.length - 1].id : sinceId;

      return {
        members: members.map((m) => ({ id: m.id, name: m.name, anatomy: m.anatomy })),
        entries: rows,
        cursor,
      };
    });
  }
}
