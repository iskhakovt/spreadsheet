import { randomBytes } from "node:crypto";
import {
  type Anatomy,
  type AnatomyLabels,
  type AnatomyPicker,
  FORMAT_VERSION,
  type GroupStatusRow,
  type KeyCheck,
  PREFIX_ENCRYPTED,
  type Sealed,
} from "@spreadsheet/shared";
import { and, count, eq } from "drizzle-orm";
import type { Database, Transaction } from "../db/index.js";
import { groups, journalEntries, persons } from "../db/schema.js";
import { sealedInGroupMode } from "./sealed-mode.js";

const KEY_CHECK_PREFIX = `${PREFIX_ENCRYPTED}:${FORMAT_VERSION}:`;
/** AES-GCM: a 12-byte IV and a 16-byte tag around at least one byte. */
const MIN_ENVELOPE_BYTES = 12 + 16 + 1;

/**
 * An `e:1:` value whose payload is base64url of at least an AES-GCM
 * envelope. The server can't open it, but it can refuse one that could
 * never open, which would lock its own group out on the first load.
 */
function isKeyCheckEnvelope(value: string): boolean {
  if (!value.startsWith(KEY_CHECK_PREFIX)) return false;
  const payload = value.slice(KEY_CHECK_PREFIX.length);
  // A length of 1 mod 4 isn't base64: Node's decoder drops the extra
  // character, but the browser's rejects it.
  return (
    /^[A-Za-z0-9_-]+$/.test(payload) &&
    payload.length % 4 !== 1 &&
    Buffer.from(payload, "base64url").length >= MIN_ENVELOPE_BYTES
  );
}

function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

/** A person's sealed profile fields, as the client's group codec produced them. */
export interface SealedProfile {
  name: Sealed<string>;
  anatomy: Sealed<Anatomy> | null;
}

export class GroupStore {
  #tx: <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;

  constructor(db: Database) {
    // biome-ignore lint/suspicious/noExplicitAny: Database.transaction types vary by driver
    this.#tx = (fn) => (db as any).transaction(fn);
  }

  /**
   * An encrypted group needs an `e:1:` key check (a version clients can
   * open, or it would prove nothing) shaped like ciphertext; a plaintext
   * one none.
   */
  async create(input: {
    encrypted: boolean;
    questionMode: "all" | "filtered";
    anatomyLabels: string | null;
    anatomyPicker: string | null;
    keyCheck: Sealed<KeyCheck> | null;
  }) {
    const keyCheckOk =
      input.keyCheck === null ? !input.encrypted : input.encrypted && isKeyCheckEnvelope(input.keyCheck);
    if (!keyCheckOk) return { error: "encryption_mismatch" as const };
    return this.#tx(async (tx) => {
      const adminToken = generateToken();
      const [group] = await tx
        .insert(groups)
        .values({
          adminToken,
          encrypted: input.encrypted,
          keyCheck: input.keyCheck,
          isReady: false,
          questionMode: input.questionMode,
          anatomyLabels: input.anatomyLabels,
          anatomyPicker: input.anatomyPicker,
        })
        .returning();
      return { groupId: group.id, adminToken };
    });
  }

  async setupAdmin(adminToken: string, input: SealedProfile & { partners: SealedProfile[] }) {
    return this.#tx(async (tx) => {
      const group = await tx
        .select()
        .from(groups)
        .where(eq(groups.adminToken, adminToken))
        .limit(1)
        .then((rows) => rows[0] ?? null);

      if (!group) return { error: "not_found" as const };
      if (group.isReady) return { error: "already_setup" as const };

      const sealedValues = [input, ...input.partners].flatMap((p) => [p.name, p.anatomy]);
      if (!sealedInGroupMode(sealedValues, group.encrypted)) return { error: "encryption_mismatch" as const };

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

  /**
   * `groupEncrypted` is the caller's group's `encrypted` flag (already in the
   * request context), so the mode check needs no extra query.
   */
  async addPerson(groupId: string, input: SealedProfile & { isAdmin: boolean }, groupEncrypted: boolean) {
    if (!sealedInGroupMode([input.name, input.anatomy], groupEncrypted)) {
      return { error: "encryption_mismatch" as const };
    }
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

  /** `groupEncrypted` is the person's group's `encrypted` flag, as in {@link addPerson}. */
  async setProfile(
    personId: string,
    input: SealedProfile,
    groupEncrypted: boolean,
  ): Promise<{ error: "encryption_mismatch" } | { ok: true }> {
    if (!sealedInGroupMode([input.name, input.anatomy], groupEncrypted)) {
      return { error: "encryption_mismatch" };
    }
    await this.#tx(async (tx) => {
      await tx.update(persons).set({ name: input.name, anatomy: input.anatomy }).where(eq(persons.id, personId));
    });
    return { ok: true };
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

  /**
   * Sealed fields (`name`, `anatomy`, `progress`) are returned exactly as
   * stored; the client's codec opens them.
   */
  async getStatus(token: string): Promise<GroupStatusRow | null> {
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
            keyCheck: group.keyCheck,
            isReady: false,
            isAdminReady: false,
            questionMode: group.questionMode,
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
          keyCheck: group.keyCheck,
          isReady: groupReady,
          isAdminReady: group.isReady,
          questionMode: group.questionMode,
          anatomyLabels: group.anatomyLabels as AnatomyLabels | null,
          anatomyPicker: group.anatomyPicker as AnatomyPicker | null,
        },
        members,
      };
    });
  }
}
