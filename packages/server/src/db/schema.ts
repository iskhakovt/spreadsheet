import { bigserial, boolean, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

export const persons = pgTable("persons", {
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
});

export const categories = pgTable("categories", {
  id: text().primaryKey(),
  label: text().notNull(),
  description: text().notNull(),
  sortOrder: integer().notNull(),
});

export const questions = pgTable("questions", {
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
});

export const journalEntries = pgTable("journal_entries", {
  id: bigserial({ mode: "number" }).primaryKey(),
  personId: uuid()
    .notNull()
    .references(() => persons.id),
  operation: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
