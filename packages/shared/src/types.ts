import { z } from "zod";

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
  targetGive: string;
  targetReceive: string;
  tier: number;
}

/** Category as returned by the questions.list query */
export interface CategoryData {
  id: string;
  label: string;
  description: string;
  sortOrder: number;
}
