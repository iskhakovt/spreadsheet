// Note: indices use plain CREATE INDEX (not CONCURRENTLY) because drizzle's
// migrator wraps migrations in a transaction (drizzle-orm#860). Safe for our
// single-container deploy where downtime is inherent. For zero-downtime
// deploys, apply indices out-of-band with CONCURRENTLY before migrating.
import { bigserial, boolean, index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const targetEnum = pgEnum("target", ["all", "amab", "afab"]);
export const questionModeEnum = pgEnum("question_mode", ["all", "filtered"]);

export const groups = pgTable("groups", {
  id: uuid().defaultRandom().primaryKey(),
  adminToken: text().unique(),
  encrypted: boolean().notNull(),
  isReady: boolean().notNull(),
  questionMode: questionModeEnum().notNull(),
  showTiming: boolean().notNull(),
  anatomyLabels: text(), // "amab" | "gendered" | "anatomical" | "short" — nullable, only used when filtered
  anatomyPicker: text(), // "self" | "admin" — nullable, only used when filtered
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const persons = pgTable(
  "persons",
  {
    id: uuid().defaultRandom().primaryKey(),
    groupId: uuid()
      .notNull()
      .references(() => groups.id),
    name: text().notNull(),
    anatomy: text(), // nullable — null until self-picked or set by admin
    token: text().notNull().unique(),
    isAdmin: boolean().notNull(),
    isCompleted: boolean().notNull(),
    progress: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("persons_group_id_idx").on(t.groupId)],
);

export const categories = pgTable("categories", {
  id: text().primaryKey(),
  label: text().notNull(),
  description: text().notNull(),
  sortOrder: integer().notNull(),
});

export const questions = pgTable(
  "questions",
  {
    id: text().primaryKey(),
    categoryId: text()
      .notNull()
      .references(() => categories.id),
    text: text().notNull(),
    giveText: text(),
    receiveText: text(),
    description: text(),
    targetGive: targetEnum().notNull(),
    targetReceive: targetEnum().notNull(),
    tier: integer().notNull().default(1),
    sortOrder: integer().notNull(),
  },
  (t) => [index("questions_category_sort_idx").on(t.categoryId, t.sortOrder)],
);

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    personId: uuid()
      .notNull()
      .references(() => persons.id),
    operation: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("journal_entries_person_id_id_idx").on(t.personId, t.id)],
);
