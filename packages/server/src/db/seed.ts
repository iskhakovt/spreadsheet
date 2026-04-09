import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { QuestionStore, SeedData } from "../store/questions.js";

const CategorySchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
});

const QuestionSchema = z.object({
  id: z.string(),
  category: z.string(),
  tier: z.number().int().min(1).max(3).default(1),
  text: z.string(),
  giveText: z.string().optional(),
  receiveText: z.string().optional(),
  description: z.string().optional(),
  targetGive: z.enum(["all", "amab", "afab"]).default("all"),
  targetReceive: z.enum(["all", "amab", "afab"]).default("all"),
});

const SeedDataSchema = z.object({
  categories: z.array(CategorySchema),
  questions: z.array(QuestionSchema),
});

function loadSeedData(): SeedData {
  const yamlPath = resolve(import.meta.dirname, "questions.yml");
  const raw = readFileSync(yamlPath, "utf-8");
  const parsed = YAML.parse(raw);
  return SeedDataSchema.parse(parsed);
}

export async function seed(store: QuestionStore) {
  const data = loadSeedData();
  await store.seed(data);
}
