import { z } from "zod";

/** Highest valid tier number. Adding tier 5 means bumping this; the four
 *  tier labels in lib/strings.ts and the slider arrays follow from it. */
export const MAX_TIER = 4;
export type Tier = 1 | 2 | 3 | 4;

export const Rating = z.enum(["yes", "if-partner-wants", "maybe", "fantasy", "no"]);
export type Rating = z.infer<typeof Rating>;

export const Timing = z.enum(["now", "later"]);
export type Timing = z.infer<typeof Timing>;

export const Anatomy = z.enum(["amab", "afab", "both", "none"]);
export type Anatomy = z.infer<typeof Anatomy>;

export const Target = z.enum(["all", "amab", "afab"]);
export type Target = z.infer<typeof Target>;

export const Role = z.enum(["give", "receive", "mutual"]);
export type Role = z.infer<typeof Role>;

export const QuestionMode = z.enum(["all", "filtered"]);
export type QuestionMode = z.infer<typeof QuestionMode>;

export const AnatomyLabels = z.enum(["amab", "gendered", "anatomical", "short"]);
export type AnatomyLabels = z.infer<typeof AnatomyLabels>;

export const AnatomyPicker = z.enum(["self", "admin"]);
export type AnatomyPicker = z.infer<typeof AnatomyPicker>;

/** Display labels for anatomy options */
export const ANATOMY_LABEL_PRESETS: Record<AnatomyLabels, Record<Anatomy, string>> = {
  amab: { amab: "AMAB", afab: "AFAB", both: "Both", none: "Neither" },
  gendered: { amab: "Male", afab: "Female", both: "Both", none: "Neither" },
  anatomical: { amab: "Penis", afab: "Vulva", both: "Both", none: "Neither" },
  short: { amab: "M", afab: "F", both: "Both", none: "—" },
};

export interface Answer {
  rating: Rating;
  timing: Timing | null;
  note: string | null;
}

export interface OperationPayload {
  key: string; // "questionId:role"
  data: Answer | null; // null = clear/unanswer
}

/** Question as returned by the questions.list query */
export interface QuestionData {
  id: string;
  categoryId: string;
  text: string;
  giveText: string | null;
  receiveText: string | null;
  description: string | null;
  notePrompt: string | null;
  targetGive: string;
  targetReceive: string;
  /**
   * Anatomies that must all be present somewhere in the group for this
   * question to render — covers cases (e.g. pregnancy) that no per-person
   * targetGive/targetReceive combination can express. Empty = no group gate.
   */
  requiresGroupAnatomy: string[];
  tier: number;
  /** Single-parent dependencies; transitively gated when a parent is answered "no". Empty when none. */
  requires: string[];
}

/** Category as returned by the questions.list query */
export interface CategoryData {
  id: string;
  label: string;
  description: string;
  sortOrder: number;
}

/**
 * Domain schemas for the `groups.status` procedure output — the single
 * source of truth for Person / Member / Group / GroupStatus shapes.
 * Server validates its output against these; client imports the inferred
 * types directly instead of deep-indexing RouterOutputs.
 *
 * `name`, `anatomy`, `progress` are plain strings here even though the
 * wire format may be opaque-encoded (e:1:... / p:1:...) — decoding happens
 * on the client in `decrypt-status.ts`. The schema is deliberately
 * permissive on these fields so encrypted payloads round-trip unchanged.
 */
export const personSchema = z.object({
  id: z.string(),
  name: z.string(),
  anatomy: z.string().nullable(),
  isAdmin: z.boolean(),
  isCompleted: z.boolean(),
});
export type Person = z.infer<typeof personSchema>;

export const memberSchema = z.object({
  id: z.string(),
  name: z.string(),
  anatomy: z.string().nullable(),
  isAdmin: z.boolean(),
  isCompleted: z.boolean(),
  progress: z.string().nullable(),
});
export type Member = z.infer<typeof memberSchema>;

export const groupSchema = z.object({
  id: z.string(),
  encrypted: z.boolean(),
  isReady: z.boolean(),
  isAdminReady: z.boolean(),
  questionMode: QuestionMode,
  showTiming: z.boolean(),
  anatomyLabels: AnatomyLabels.nullable(),
  anatomyPicker: AnatomyPicker.nullable(),
});
export type Group = z.infer<typeof groupSchema>;

export const groupStatusSchema = z.object({
  person: personSchema.nullable(),
  group: groupSchema,
  members: z.array(memberSchema),
});
export type GroupStatus = z.infer<typeof groupStatusSchema>;
