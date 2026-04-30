import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MAX_TIER } from "@spreadsheet/shared";
import YAML from "yaml";
import { z } from "zod";
import type { QuestionStore, SeedData } from "../store/questions.js";

const CategorySchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
});

const RequiresSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v == null ? [] : Array.isArray(v) ? v : [v]));

const RequiresGroupAnatomySchema = z
  .array(z.enum(["amab", "afab"]))
  .optional()
  .transform((v) => v ?? []);

const QuestionSchema = z.object({
  id: z.string(),
  category: z.string(),
  tier: z.number().int().min(1).max(MAX_TIER).default(1),
  text: z.string(),
  giveText: z.string().optional(),
  receiveText: z.string().optional(),
  description: z.string().optional(),
  notePrompt: z.string().optional(),
  targetGive: z.enum(["all", "amab", "afab"]).default("all"),
  targetReceive: z.enum(["all", "amab", "afab"]).default("all"),
  requiresGroupAnatomy: RequiresGroupAnatomySchema,
  requires: RequiresSchema,
});

const SeedDataSchema = z.object({
  categories: z.array(CategorySchema),
  questions: z.array(QuestionSchema),
});

export function loadSeedData(): SeedData {
  // In dev/tests: tsx doesn't bundle, import.meta.dirname is src/db/.
  // In Docker: tsup bundles to a single dist/main.js, so
  // import.meta.dirname is dist/. The Dockerfile copies questions.yml
  // into dist/ to match. Same resolve() works for both.
  const raw = readFileSync(resolve(import.meta.dirname, "questions.yml"), "utf-8");
  const parsed = YAML.parse(raw);
  return SeedDataSchema.parse(parsed);
}

export async function seed(store: QuestionStore) {
  const data = loadSeedData();
  await store.seed(data);
}
