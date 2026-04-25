import { randomBytes } from "node:crypto";
import type { AnatomyLabels, AnatomyPicker, GroupStatus } from "@spreadsheet/shared";
import { and, count, eq } from "drizzle-orm";
import type { Database, Transaction } from "../db/index.js";
import { groups, journalEntries, persons } from "../db/schema.js";

function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

export class GroupStore {
  #tx: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;

  constructor(db: Database) {
    // biome-ignore lint/suspicious/noExplicitAny: Database.transaction types vary by driver
    this.#tx = (fn) => (db as any).transaction(fn);
  }

  async create(input: {
    encrypted: boolean;
    questionMode: "all" | "filtered";
    showTiming: boolean;
    anatomyLabels: string | null;
    anatomyPicker: string | null;
  }) {
    return this.#tx(async (tx) => {
      const adminToken = generateToken();
      const [group] = await tx
        .insert(groups)
        .values({
          adminToken,
          encrypted: input.encrypted,
          isReady: false,
          questionMode: input.questionMode,
          showTiming: input.showTiming,
          anatomyLabels: input.anatomyLabels,
          anatomyPicker: input.anatomyPicker,
        })
        .returning();
      return { groupId: group.id, adminToken };
    });
  }

  async setupAdmin(
    adminToken: string,
    input: {
      name: string;
      anatomy: string | null;
      partners: { name: string; anatomy: string | null }[];
    },
  ) {
    return this.#tx(async (tx) => {
      const group = await tx
        .select()
        .from(groups)
        .where(eq(groups.adminToken, adminToken))
        .limit(1)
        .then((rows) => rows[0] ?? null);

      if (!group) return { error: "not_found" as const };
      if (group.isReady) return { error: "already_setup" as const };

      if (group.questionMode === "filtered" && group.anatomyPicker === "admin") {
        if (!input.anatomy) return { error: "anatomy_required" as const };
        for (const p of input.partners) {
          if (!p.anatomy) return { error: "anatomy_required" as const };
        }
      }

      await tx.insert(persons).values({
        groupId: group.id,
        name: input.name,
        anatomy: input.anatomy,
        token: adminToken,
        isAdmin: true,
        isCompleted: false,
      });

      const partnerTokens: string[] = [];
      for (const partner of input.partners) {
        const token = generateToken();
        await tx.insert(persons).values({
          groupId: group.id,
          name: partner.name,
          anatomy: partner.anatomy,
          token,
          isAdmin: false,
          isCompleted: false,
        });
        partnerTokens.push(token);
      }

      await tx.update(groups).set({ isReady: true, adminToken: null }).where(eq(groups.id, group.id));

      return { partnerTokens };
    });
  }

  async addPerson(groupId: string, input: { name: string; anatomy: string | null; isAdmin: boolean }) {
    return this.#tx(async (tx) => {
      const token = generateToken();
      const [person] = await tx
        .insert(persons)
        .values({
          groupId,
          name: input.name,
          anatomy: input.anatomy,
          token,
          isAdmin: input.isAdmin,
          isCompleted: false,
        })
        .returning();
      return { personId: person.id, token };
    });
  }

  async removePerson(groupId: string, personId: string, adminPersonId: string) {
    return this.#tx(async (tx) => {
      const person = await tx
        .select()
        .from(persons)
        .where(and(eq(persons.id, personId), eq(persons.groupId, groupId)))
        .limit(1)
        .then((rows) => rows[0] ?? null);

      if (!person) return { error: "not_found" as const };
      if (person.id === adminPersonId) return { error: "self_remove" as const };

      const [{ value: entryCount }] = await tx
        .select({ value: count() })
        .from(journalEntries)
        .where(eq(journalEntries.personId, personId));

      if (entryCount > 0) return { error: "has_entries" as const };

      await tx.delete(persons).where(eq(persons.id, personId));
      return { ok: true as const };
    });
  }

  async setProfile(personId: string, input: { name: string; anatomy: string | null }) {
    await this.#tx(async (tx) => {
      await tx.update(persons).set({ name: input.name, anatomy: input.anatomy }).where(eq(persons.id, personId));
    });
  }

  async markReady(groupId: string) {
    await this.#tx(async (tx) => {
      await tx.update(groups).set({ isReady: true }).where(eq(groups.id, groupId));
    });
  }

  async getPersonByToken(token: string): Promise<typeof persons.$inferSelect | null> {
    return this.#tx(async (tx) => {
      return tx
        .select()
        .from(persons)
        .where(eq(persons.token, token))
        .limit(1)
        .then((rows) => rows[0] ?? null);
    });
  }

  async getGroupById(groupId: string): Promise<typeof groups.$inferSelect | null> {
    return this.#tx(async (tx) => {
      return tx
        .select()
        .from(groups)
        .where(eq(groups.id, groupId))
        .limit(1)
        .then((rows) => rows[0] ?? null);
    });
  }

  async getStatus(token: string): Promise<GroupStatus | null> {
    return this.#tx(async (tx) => {
      const person = await tx
        .select()
        .from(persons)
        .where(eq(persons.token, token))
        .limit(1)
        .then((rows) => rows[0] ?? null);

      if (!person) {
        // Fallback: check admin token (pre-setup)
        const group = await tx
          .select()
          .from(groups)
          .where(eq(groups.adminToken, token))
          .limit(1)
          .then((rows) => rows[0] ?? null);

        if (!group) return null;

        return {
          person: null,
          group: {
            id: group.id,
            encrypted: group.encrypted,
            isReady: false,
            isAdminReady: false,
            questionMode: group.questionMode,
            showTiming: group.showTiming,
            // Drizzle stores these as raw `text` columns so their row type
            // is `string | null`, but a DB-level check + seed keeps values
            // constrained to the enum set. Narrow at the boundary; the
            // procedure's `.output(groupStatusSchema)` re-validates.
            anatomyLabels: group.anatomyLabels as AnatomyLabels | null,
            anatomyPicker: group.anatomyPicker as AnatomyPicker | null,
          },
          members: [],
        };
      }

      const members = await tx
        .select({
          id: persons.id,
          name: persons.name,
          anatomy: persons.anatomy,
          isCompleted: persons.isCompleted,
          isAdmin: persons.isAdmin,
          progress: persons.progress,
        })
        .from(persons)
        .where(eq(persons.groupId, person.groupId))
        .orderBy(persons.createdAt, persons.id);

      const group = await tx
        .select()
        .from(groups)
        .where(eq(groups.id, person.groupId))
        .limit(1)
        .then((rows) => rows[0] ?? null);

      if (!group) return null;

      const allAnatomySet = group.questionMode === "all" || members.every((m) => m.anatomy !== null);
      const groupReady = group.isReady && allAnatomySet;

      return {
        person: {
          id: person.id,
          name: person.name,
          anatomy: person.anatomy,
          isAdmin: person.isAdmin,
          isCompleted: person.isCompleted,
        },
        group: {
          id: group.id,
          encrypted: group.encrypted,
          isReady: groupReady,
          isAdminReady: group.isReady,
          questionMode: group.questionMode,
          showTiming: group.showTiming,
          anatomyLabels: group.anatomyLabels as AnatomyLabels | null,
          anatomyPicker: group.anatomyPicker as AnatomyPicker | null,
        },
        members,
      };
    });
  }
}
