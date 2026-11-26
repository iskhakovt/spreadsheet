import { z } from "zod";
import { type Opened, sealedOutput } from "./sealed.js";

/** Highest valid tier number. Adding tier 5 means bumping this; the four
 *  tier labels in lib/strings.ts and the slider arrays follow from it. */
export const MAX_TIER = 4;
export type Tier = 1 | 2 | 3 | 4;

export const Rating = z.enum(["yes", "if-partner-wants", "maybe", "fantasy", "no"]);
export type Rating = z.infer<typeof Rating>;

export const Anatomy = z.enum(["amab", "afab", "both", "none"]);
export type Anatomy = z.infer<typeof Anatomy>;

/** A person's display name, the plaintext inside a sealed `name` field. */
export const PersonName = z.string().min(1);

export const Target = z.enum(["all", "amab", "afab"]);
export type Target = z.infer<typeof Target>;

export const Role = z.enum(["give", "receive", "mutual"]);
export type Role = z.infer<typeof Role>;

/**
 * Comparison semantics for a question — how two people's answers combine on
 * the /results page. This is a *display-only* axis: it changes how an answer
 * pair is classified into a match bucket, never how answers are stored.
 *
 *  - `activity`  (default) — "do you both want to do this?" Positive overlap
 *    is surfaced; a "no" from either side hides the row (privacy / no pressure).
 *  - `agreement` — a symmetric norm. Both-affirm, both-decline, AND a split
 *    are all meaningful: a mutual "no" is alignment worth showing (not hidden),
 *    and a split is surfaced as something to discuss (e.g. barrier/risk norms,
 *    exclusivity, response norms, competing preferences like lighting).
 *  - `disclose`  — a self-referential preference or stated need where the note
 *    is the content. Each person's answer always surfaces to the partner
 *    regardless of overlap; there's no "match" verdict (e.g. pubic hair,
 *    sensory accommodations, "words I don't want used").
 */
export const Compare = z.enum(["activity", "agreement", "disclose"]);
export type Compare = z.infer<typeof Compare>;

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

/**
 * Answer payload schema. Used both for serialization (canonical write
 * shape) and deserialization (lenient read of legacy data).
 *
 *  - `note` defaults to `null` when missing, so older entries that carry
 *    only `{ rating, timing }` parse cleanly.
 *  - The legacy `timing: "now" | "later" | null` field gets stripped on
 *    read via Zod's default object-strip behavior; write paths use
 *    `Answer.parse()` to guarantee no stray keys ever ship.
 */
export const Answer = z.object({
  rating: Rating,
  note: z.string().nullable().default(null),
});
export type Answer = z.infer<typeof Answer>;

/**
 * Journal operation payload, the plaintext inside a sealed op. `key` is
 * `questionId:role`; `data: null` clears the answer. The client's journal
 * replay checks `key` against the canonical shape separately.
 */
export const OperationPayload = z.object({
  key: z.string(),
  data: Answer.nullable(),
});
export type OperationPayload = z.infer<typeof OperationPayload>;

/** Progress payload a client reports on each sync: unique questions rated of those in its selected categories. */
export const Progress = z.object({
  answered: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type Progress = z.infer<typeof Progress>;

/**
 * The fixed value an encrypted group's key check seals. Its content doesn't
 * matter: the check proves a key by opening under it (design/sync.md § Key
 * verification).
 */
export const KEY_CHECK = "group-key-check:1" as const;
export const KeyCheck = z.literal(KEY_CHECK);
export type KeyCheck = z.infer<typeof KeyCheck>;

/**
 * Opaque journal entry id as it appears on the wire. The server seals the
 * internal bigserial so clients can't read the global journal row count
 * from it. Clients must treat it as an opaque, equality-only token: no
 * parsing, no numeric comparison. Order comes from the server's response
 * order, never from the id itself.
 */
export const JournalEntryId = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
export type JournalEntryId = z.infer<typeof JournalEntryId>;

export const JournalEntry = z.object({
  id: JournalEntryId,
  personId: z.string(),
  operation: sealedOutput<OperationPayload>(),
});
/** Journal entry as the client receives it (operation still sealed). */
export type JournalEntry = z.infer<typeof JournalEntry>;
/** Journal entry as server code builds it from DB rows, before output validation. */
export type JournalEntryRow = z.input<typeof JournalEntry>;

/**
 * Wire shape returned by `sync.selfJournal` (and the backfill stage of
 * `sync.onSelfJournalChange`). Per-person, ungated, used by `useSelfJournal`
 * to hydrate the caller's own answers cache.
 *
 * Defined here in shared so the server route can `.output()` it for runtime
 * validation at the RPC boundary, and so the client can rely on the shape
 * without a `RouterOutputs` chain.
 *
 * `cursor` is the id of the last entry the response covers (or the echoed
 * input cursor on an empty delta) — pass it back as `sinceId`.
 */
export const SelfJournalResponse = z.object({
  entries: z.array(JournalEntry),
  cursor: JournalEntryId.nullable(),
  stoken: z.string().nullable(),
});
export type SelfJournalResponse = z.infer<typeof SelfJournalResponse>;

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
  /**
   * How answers to this question combine on /results. Optional on the read
   * type so a stale `questions.list` cache (pre-`compare` shape) degrades
   * gracefully — absent is treated as "activity". The server always sets it.
   */
  compare?: Compare;
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
 *
 * `name`, `anatomy` and `progress` are sealed (`p:1:…` / `e:1:…`), so each
 * type comes in flavours:
 *  - `SealedX` — what the client receives (z.output): sealed fields typed `Sealed<T>`.
 *  - `X` — what the UI works with after the client's codec opened every
 *    field (`Opened<SealedX>`). It's deliberately not assignable back to a
 *    sealed input.
 *  - `GroupStatusRow` — what the server returns before `.output()`
 *    validation (z.input): sealed fields as plain strings.
 */
export const personSchema = z.object({
  id: z.string(),
  name: sealedOutput<string>(),
  anatomy: sealedOutput<Anatomy>().nullable(),
  isAdmin: z.boolean(),
  isCompleted: z.boolean(),
});
export type SealedPerson = z.infer<typeof personSchema>;
export type Person = Opened<SealedPerson>;

export const memberSchema = z.object({
  id: z.string(),
  name: sealedOutput<string>(),
  anatomy: sealedOutput<Anatomy>().nullable(),
  isAdmin: z.boolean(),
  isCompleted: z.boolean(),
  progress: sealedOutput<Progress>().nullable(),
});
export type SealedMember = z.infer<typeof memberSchema>;
export type Member = Opened<SealedMember>;

/** Wire shape returned by `sync.journal` (group-wide, gated on all-complete). */
export const GroupJournalResponse = z.object({
  members: z.array(memberSchema.pick({ id: true, name: true, anatomy: true })),
  entries: z.array(JournalEntry),
  cursor: JournalEntryId.nullable(),
});
export type GroupJournalResponse = z.infer<typeof GroupJournalResponse>;

export const groupSchema = z.object({
  id: z.string(),
  encrypted: z.boolean(),
  /** Encrypted groups: `KEY_CHECK` sealed under the group key. Null in plaintext groups and encrypted ones created before it. */
  keyCheck: sealedOutput<KeyCheck>().nullable(),
  isReady: z.boolean(),
  isAdminReady: z.boolean(),
  questionMode: QuestionMode,
  anatomyLabels: AnatomyLabels.nullable(),
  anatomyPicker: AnatomyPicker.nullable(),
});
export type SealedGroup = z.infer<typeof groupSchema>;
/** The group as the UI sees it: opening the status consumes the key check. */
export type Group = Omit<SealedGroup, "keyCheck">;

export const groupStatusSchema = z.object({
  person: personSchema.nullable(),
  group: groupSchema,
  members: z.array(memberSchema),
});
export type SealedGroupStatus = z.infer<typeof groupStatusSchema>;
export type GroupStatusRow = z.input<typeof groupStatusSchema>;
export type GroupStatus = Opened<Omit<SealedGroupStatus, "group">> & { group: Group };
