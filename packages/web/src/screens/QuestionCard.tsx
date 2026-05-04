import type { Answer, CategoryData, Rating } from "@spreadsheet/shared";
import { ChevronLeft, ChevronRight, HelpCircle, Pencil } from "lucide-react";
import { type ReactNode, type RefObject, useCallback, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { SyncIndicator } from "../components/SyncIndicator.js";
import type { QuestionScreen } from "../lib/build-screens.js";
import { cn } from "../lib/cn.js";
import { modKey, useHasKeyboard } from "../lib/keyboard-platform.js";
import { UI } from "../lib/strings.js";
import { type Variant, variantStyles } from "../lib/variant-styles.js";

const RATING_OPTIONS: readonly { rating: Rating; label: string; variant: Variant; italic?: boolean }[] = [
  { rating: "yes", label: UI.question.yes, variant: "accent" },
  { rating: "if-partner-wants", label: UI.question.willing, variant: "accent-light" },
  { rating: "maybe", label: UI.question.maybe, variant: "neutral" },
  { rating: "fantasy", label: UI.question.fantasy, variant: "neutral", italic: true },
  { rating: "no", label: UI.question.no, variant: "outline" },
];

const KEY_TO_RATING: Record<string, Rating> = {
  "1": "yes",
  "2": "if-partner-wants",
  "3": "maybe",
  "4": "fantasy",
  "5": "no",
};

const COMMIT_ANIMATION_NAME = "commit-alpha";

/** ms after the last keystroke before a note edit is persisted. */
const NOTE_DEBOUNCE_MS = 500;

interface QuestionCardProps {
  screen: QuestionScreen;
  categoryMap: Record<string, CategoryData>;
  allQuestionScreens: QuestionScreen[];
  existingAnswer: Answer | undefined;
  index: number;
  totalAnswered: number;
  totalQuestions: number;
  syncing: boolean;
  showSyncIndicator: boolean;
  pendingCount: number;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  onCommit: (answer: Answer) => void | Promise<void>;
  onAdvance: () => void;
  onBack: () => void;
  onSync: () => void;
  onSummary?: () => void;
}

function trimNote(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * True when the keyboard event originated from an editable element. Used to
 * suppress global keyboard shortcuts while the user is typing in the note
 * textarea — without this guard, "1"-"5" or "n"/"l" inside the textarea would
 * preventDefault the keystroke and hijack-commit a rating/timing.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.matches !== "function") return false;
  return el.matches("textarea, input, [contenteditable=''], [contenteditable='true']");
}

export function QuestionCard({
  screen,
  categoryMap,
  allQuestionScreens,
  existingAnswer,
  index,
  totalAnswered,
  totalQuestions,
  syncing,
  showSyncIndicator,
  pendingCount,
  headingRef,
  onCommit,
  onAdvance,
  onBack,
  onSync,
  onSummary,
}: Readonly<QuestionCardProps>) {
  const hasKeyboard = useHasKeyboard();
  const category = categoryMap[screen.categoryId];
  const catQuestionScreens = allQuestionScreens.filter((s) => s.categoryId === screen.categoryId);
  const posInCategory = catQuestionScreens.indexOf(screen) + 1;

  const progressPct = totalQuestions > 0 ? (totalAnswered / totalQuestions) * 100 : 0;

  const [helpOpen, setHelpOpen] = useState(false);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const helpPopoverRef = useRef<HTMLDivElement>(null);
  const helpCloseRef = useRef<HTMLButtonElement>(null);

  // Refs threaded through children for keyboard-flow focus moves:
  // rating commit → focus textarea, Cmd+Enter pre-rating → focus first rating.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const firstRatingRef = useRef<HTMLButtonElement>(null);

  // Note state — local while editing, debounced into onCommit. The textarea
  // is reseeded from existingAnswer when the user navigates between questions
  // (screen.key change), so per-question notes don't leak across cards.
  const notePrompt = screen.question.notePrompt;
  const [noteDraft, setNoteDraft] = useState<string>(existingAnswer?.note ?? "");
  const [pillExpanded, setPillExpanded] = useState(false);
  // Reseed local UI state on navigation only (screen.key change). Including
  // existingAnswer in the dep array would re-clobber the live noteDraft on
  // every commit (the parent re-passes a new existingAnswer right after each
  // onCommit call), losing whatever the user is typing.
  useEffect(() => {
    setNoteDraft(existingAnswer?.note ?? "");
    setPillExpanded(false);
  }, [screen.key]);

  const trimmedDraft = trimNote(noteDraft);
  const draftHasContent = trimmedDraft !== null;
  // True iff the typed draft differs from the saved note. Drives the
  // "Save & next" vs "Next" label — without this, the label says "Save"
  // any time the textarea has content, including the pre-fill of an
  // unchanged saved note (the re-commit guard in handleNext skips the
  // no-op write, but the label was lying about it).
  const noteDirty = trimmedDraft !== (existingAnswer?.note ?? null);
  // Layout B (note section visible) when the question prompts for a note,
  // when there's already a note, or when the user opted in via the hairline
  // link. Pre-rating prompted questions also start in Layout B so the prompt
  // is visible from the beginning.
  const noteVisible = notePrompt !== null || draftHasContent || pillExpanded;

  // `pointerdown` not `mousedown` so touch + pen dismiss uniformly.
  useEffect(() => {
    if (!helpOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setHelpOpen(false);
    }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (helpPopoverRef.current?.contains(target)) return;
      if (helpButtonRef.current?.contains(target)) return;
      setHelpOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [helpOpen]);

  // Move focus into the popover on open — without this, keyboard users have
  // no defined landing; Escape still closes from anywhere.
  useEffect(() => {
    if (helpOpen) helpCloseRef.current?.focus();
  }, [helpOpen]);

  // Dismiss help on category jump.
  useEffect(() => {
    setHelpOpen(false);
  }, [screen.key]);

  // Debounced note commit — only persists when there's a rating to attach
  // the note to. Pre-rating typing stays in local draft state until the user
  // commits a rating (which carries the current note).
  const commitNote = useEffectEvent((answer: Answer) => onCommit(answer));
  useEffect(() => {
    if (!existingAnswer) return;
    const trimmed = trimNote(noteDraft);
    if (trimmed === existingAnswer.note) return;
    const t = setTimeout(() => {
      void commitNote({ ...existingAnswer, note: trimmed });
    }, NOTE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [noteDraft, existingAnswer]);

  // --- handlers wrapped in useCallback so child memos stay stable ---

  // Await commit before advance — letting the storage event propagate and
  // useAnswers update before setIndex schedules the next render. Without
  // the await, gating-based visibility on the *next* question would
  // briefly read stale answers (the original saveAnswer had a microtask
  // yield via `await encodeValue(...)` between setAnswer and setIndex,
  // which we preserve here).
  // Advance when there's no note section, or when the user typed before
  // rating (their workflow is done — `noteDirty` is computed above).
  // Otherwise stay so they can type; for keyboard commits, move focus into
  // the textarea so they don't have to Tab to find it.
  const advanceFromRating = useCallback(
    async (rating: Rating, source: "keyboard" | "mouse") => {
      await onCommit({ rating, note: trimNote(noteDraft) });
      if (!noteVisible || noteDirty) {
        onAdvance();
      } else if (source === "keyboard") {
        textareaRef.current?.focus();
      }
    },
    [noteDraft, noteVisible, noteDirty, onCommit, onAdvance],
  );

  const handleNext = useCallback(async () => {
    // Flush any pending note debounce before advancing.
    if (existingAnswer) {
      const trimmed = trimNote(noteDraft);
      if (trimmed !== existingAnswer.note) {
        await onCommit({ ...existingAnswer, note: trimmed });
      }
    }
    onAdvance();
  }, [existingAnswer, noteDraft, onCommit, onAdvance]);

  // Cmd/Ctrl+Enter from the textarea. With a rating already in place, behaves
  // like Save & next. Without a rating, focuses the first rating button so
  // the user has a clear next step instead of a silent no-op.
  const handleCmdEnter = useCallback(() => {
    if (existingAnswer) {
      void handleNext();
    } else {
      firstRatingRef.current?.focus();
    }
  }, [existingAnswer, handleNext]);

  const handleSkip = useCallback(() => {
    onAdvance();
  }, [onAdvance]);

  const handleAddNote = useCallback(() => setPillExpanded(true), []);

  return (
    <Card>
      {/* Header — category pill + position on the left, help icon + Progress
          chip on the right. */}
      <div className="relative flex items-center justify-between mb-4">
        <span className="inline-flex items-center gap-2 text-xs font-medium text-text-muted tracking-wide">
          <span className="relative flex items-center justify-center">
            <span
              className="absolute w-2 h-2 rounded-full bg-accent/30"
              style={{ animation: "gentle-pulse 2.5s ease-in-out infinite" }}
            />
            <span className="relative w-1.5 h-1.5 rounded-full bg-accent" />
          </span>
          <span className="uppercase tracking-[0.08em]">{category?.label}</span>
          <span className="text-text-muted/30">&middot;</span>
          <span className="tabular-nums text-text-muted/60">
            {posInCategory}/{catQuestionScreens.length}
          </span>
        </span>
        <div className="inline-flex items-center gap-1.5">
          <button
            ref={helpButtonRef}
            type="button"
            onClick={() => setHelpOpen((v) => !v)}
            aria-haspopup="dialog"
            aria-expanded={helpOpen}
            aria-label="What do these ratings mean?"
            className="inline-flex items-center justify-center w-6 h-6 rounded-full text-text-muted/75 bg-surface/50 border border-border/70 hover:text-accent hover:border-accent/35 hover:bg-white transition-all duration-200"
          >
            <HelpCircle size={13} strokeWidth={2} />
          </button>
          {onSummary && (
            <button
              type="button"
              onClick={onSummary}
              className="inline-flex items-center text-xs font-medium text-text-muted bg-surface/60 border border-border/40 rounded-full px-3 py-1 hover:text-accent hover:border-accent/35 hover:bg-white transition-all duration-200"
            >
              Progress
            </button>
          )}
        </div>
        {helpOpen && <HelpPopover ref={helpPopoverRef} closeRef={helpCloseRef} onClose={() => setHelpOpen(false)} />}
      </div>
      {/* Screen reader announcement */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        Question {posInCategory} of {catQuestionScreens.length}, {category?.label}
      </div>
      {/* Question text + reserved description slot — keyed on screen.key for
          per-question fade-in, giving the flow a page-turning rhythm. The
          min-h floor reserves space for a 2-line heading (≈3.8rem) + the
          description slot below (2.75rem) + the mt-4 gap, so rating buttons
          don't jump between 1-line and 2-line questions. */}
      <div key={screen.key} className="animate-in min-h-[7.75rem] mb-2">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-[1.65rem] font-bold leading-[1.18] tracking-[-0.015em] outline-none text-balance"
        >
          {screen.displayText}
        </h2>
        <div className="mt-4 min-h-[2.75rem]">
          {screen.question.description && (
            <p className="text-sm text-text-muted/85 text-pretty italic leading-[1.55]">
              {screen.question.description}
            </p>
          )}
        </div>
      </div>
      {/* Answer controls — RatingGroup owns its keyboard listener locally
          (scoped by mount) and its commit animation state (local useState). */}
      <RatingGroup existingAnswer={existingAnswer} onRating={advanceFromRating} firstButtonRef={firstRatingRef} />

      {/* Note section — visible when notePrompt is set on this question, the
          user already has a note, or they tapped "+ Add a note". Stays open
          across rating commits in Layout B (auto-advance suppressed).

          The keyboard hint below it (focus-within only) advertises the
          ⌘+Enter shortcut: jumps to the rating buttons pre-rate, advances
          post-rate. Slot height is reserved so showing/hiding the hint
          doesn't shift the layout. */}
      {noteVisible && (
        <div className="group">
          <NoteSection
            key={`note-${screen.key}`}
            textareaRef={textareaRef}
            notePrompt={notePrompt}
            value={noteDraft}
            onChange={setNoteDraft}
            onCmdEnter={handleCmdEnter}
          />
          {hasKeyboard && (
            <div
              className="min-h-[1.4rem] pt-1.5 text-[11px] text-center text-text-muted/55 leading-none opacity-0 transition-opacity duration-150 group-focus-within:opacity-100"
              aria-hidden="true"
            >
              <kbd className="inline-flex items-center justify-center font-mono text-[10px] leading-[9px] align-middle px-1.5 py-0.5 rounded bg-surface border border-border text-text">
                {modKey()}+↵
              </kbd>{" "}
              {existingAnswer ? "save & next" : "jump to the rating"}
            </div>
          )}
        </div>
      )}

      {/* Primary Next — only when the note section is visible (Layout B).
          Sits above the shared Back/Skip row so the same nav controls show
          on every question regardless of layout. */}
      {noteVisible && (
        <Button fullWidth onClick={handleNext} disabled={!existingAnswer} data-testid="note-next" className="mt-4 mb-2">
          {existingAnswer ? (noteDirty ? "Save & next" : "Next") : "Rate to continue"}
        </Button>
      )}
      {/* Shared Back / [+Add a note] / Skip row. The middle "+ Add a note"
          affordance only renders in Layout A (no note section yet) so it
          adds zero vertical chrome to ordinary questions. */}
      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={onBack}
          disabled={index === 0}
          aria-label="Previous question"
          className="flex items-center gap-1 text-text-muted/70 hover:text-accent disabled:opacity-40 disabled:hover:text-text-muted/70 transition-colors duration-200"
        >
          <ChevronLeft size={16} strokeWidth={1.5} className="shrink-0" />
          {UI.question.back}
        </button>
        {!noteVisible && (
          <button
            type="button"
            onClick={handleAddNote}
            aria-label="Add a note"
            className="flex items-center gap-1 text-text-muted/70 hover:text-accent transition-colors duration-200"
          >
            <Pencil size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
            <span>Add a note</span>
          </button>
        )}
        {/* Skip is hidden once the user has typed a note draft — Skip
            doesn't commit, so it would silently throw the draft away. */}
        {!draftHasContent && (
          <button
            type="button"
            onClick={handleSkip}
            aria-label="Skip question"
            className="flex items-center gap-1 text-text-muted/70 hover:text-accent transition-colors duration-200"
          >
            {UI.question.skip}
            <ChevronRight size={16} strokeWidth={1.5} className="shrink-0" />
          </button>
        )}
      </div>
      {/* Progress bar — gradient fill warms as it grows, subtle inset shadow
          gives the track depth. */}
      <div
        className="mt-4 h-1.5 rounded-full overflow-hidden progress-track"
        role="progressbar"
        aria-valuenow={totalAnswered}
        aria-valuemax={totalQuestions}
        aria-label="Overall progress"
      >
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500 ease-out progress-fill",
            progressPct > 0 && "progress-glow",
          )}
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <div className="mt-1.5 h-4 flex justify-end">
        <SyncIndicator syncing={syncing} show={showSyncIndicator} pendingCount={pendingCount} onSync={onSync} />
      </div>
    </Card>
  );
}

/** Inline note input — pencil icon left, textarea right, dashed peach hairline above. */
function NoteSection({
  textareaRef,
  notePrompt,
  value,
  onChange,
  onCmdEnter,
}: Readonly<{
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  notePrompt: string | null;
  value: string;
  onChange: (next: string) => void;
  /** Cmd/Ctrl+Enter from the textarea. Always defined — handler decides what to do based on whether a rating exists. */
  onCmdEnter: () => void;
}>) {
  const id = useId();
  const placeholder = notePrompt ?? "A line or two, only if it helps.";
  return (
    <div className="mt-3 mb-2 pt-3 border-t border-dashed border-accent/30">
      <label htmlFor={id} className="sr-only">
        Note (optional)
      </label>
      <div className="flex items-start gap-2.5">
        <Pencil size={14} strokeWidth={1.5} className="shrink-0 mt-1 text-accent/60" aria-hidden="true" />
        <textarea
          ref={textareaRef}
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter — Save & next when rated, otherwise hop focus
            // to the rating buttons so the user has a visible next step.
            // Plain Enter falls through to the browser default (newline).
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onCmdEnter();
            }
          }}
          placeholder={placeholder}
          rows={3}
          className="flex-1 min-h-[3.75rem] bg-transparent text-sm leading-[1.55] text-text placeholder:italic placeholder:text-text-muted/55 resize-none outline-none focus-visible:outline-none"
        />
      </div>
    </div>
  );
}

/**
 * Roving-tabindex radio group — button[role="radio"] pattern (Radix/React Aria
 * style). Owns its own number-key listener (1-5). Keyboard commits run
 * through the α animation path; mouse clicks commit instantly.
 */
export function RatingGroup({
  existingAnswer,
  onRating,
  firstButtonRef,
}: Readonly<{
  existingAnswer: Answer | undefined;
  onRating: (r: Rating, source: "keyboard" | "mouse") => void;
  /** Exposed so the parent can focus the first rating from a Cmd+Enter pre-rating. */
  firstButtonRef?: RefObject<HTMLButtonElement | null>;
}>) {
  const checkedIdx = existingAnswer ? RATING_OPTIONS.findIndex((o) => o.rating === existingAnswer.rating) : -1;
  const [focusIdx, setFocusIdx] = useState(checkedIdx >= 0 ? checkedIdx : 0);
  const [committing, setCommitting] = useState<Rating>();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  // Number-key shortcut (1-5). Window-scoped — no need to focus the group
  // first. Ignored while a commit animation is running, AND ignored when
  // focus is inside an editable element (textarea/input/contenteditable),
  // so typing in the note doesn't hijack-commit a rating.
  useEffect(() => {
    if (committing) return;
    function onKey(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      const rating = KEY_TO_RATING[e.key];
      if (rating) {
        e.preventDefault();
        setCommitting(rating);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [committing]);

  function handleArrowKeyDown(e: React.KeyboardEvent) {
    const len = RATING_OPTIONS.length;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      const next = (focusIdx + 1) % len;
      setFocusIdx(next);
      refs.current[next]?.focus();
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      const prev = (focusIdx - 1 + len) % len;
      setFocusIdx(prev);
      refs.current[prev]?.focus();
    }
  }

  function handleButtonClick(rating: Rating, e: React.MouseEvent<HTMLButtonElement>) {
    if (committing) return;
    // detail === 0 → keyboard activation (Enter/Space on focused button);
    // detail ≥ 1 → real mouse click. Keyboard path shows the commit
    // animation, mouse path is instant.
    //
    // Gotcha: programmatic `.click()` also reports detail === 0, so test
    // helpers that want the instant path must use Playwright's locator
    // `.click()` (which produces detail ≥ 1), not `element.click()`.
    if (e.detail === 0) {
      setCommitting(rating);
    } else {
      onRating(rating, "mouse");
    }
  }

  function handleAnimationEnd(rating: Rating, e: React.AnimationEvent<HTMLButtonElement>) {
    // Filter by name so the ambient transition on the selected ring
    // doesn't also fire this handler.
    if (e.animationName !== COMMIT_ANIMATION_NAME) return;
    if (committing !== rating) return;
    setCommitting(undefined);
    onRating(rating, "keyboard");
  }

  return (
    <div
      role="radiogroup"
      aria-label="Rate this activity"
      className="space-y-3 mb-6 mt-6"
      onKeyDown={handleArrowKeyDown}
    >
      {RATING_OPTIONS.map((opt, i) => (
        // biome-ignore lint/a11y/useSemanticElements: button[role=radio] is the WAI-ARIA APG pattern for custom radio groups (roving tabindex)
        <button
          key={opt.rating}
          ref={(el) => {
            refs.current[i] = el;
            if (i === 0 && firstButtonRef) firstButtonRef.current = el;
          }}
          type="button"
          role="radio"
          aria-checked={existingAnswer?.rating === opt.rating}
          tabIndex={i === focusIdx ? 0 : -1}
          onClick={(e) => handleButtonClick(opt.rating, e)}
          onAnimationEnd={(e) => handleAnimationEnd(opt.rating, e)}
          className={cn(
            "flex items-center justify-center w-full",
            "px-6 py-4 rounded-[var(--radius-lg)] font-medium text-base",
            "transition-all duration-200 ease-out",
            "active:scale-[0.975] active:brightness-[0.97]",
            "cursor-pointer select-none",
            variantStyles[opt.variant],
            opt.italic && "italic",
            existingAnswer?.rating === opt.rating && "ring-2 ring-accent/60 ring-offset-2 ring-offset-bg scale-[1.01]",
            committing === opt.rating && "commit-alpha",
          )}
        >
          {opt.label}
        </button>
      ))}
      <p className="text-xs text-text-muted/50 text-center mt-2 hidden sm:block">Press 1–5 to answer</p>
    </div>
  );
}

/**
 * In-context glossary popover. Anchors below the help icon in the card
 * header and lists the rating options. Strings come from
 * `UI.intro.answers` so the language matches the intro screen verbatim —
 * recall, not re-explanation.
 */
interface HelpItem {
  key: string;
  label: string;
  desc: string;
  labelClass: string;
  /** Keyboard shortcut(s) that commit this option, surfaced in the popover's Keyboard section. */
  shortcuts: string[];
}

const RATING_HELP: HelpItem[] = [
  {
    key: "yes",
    label: UI.intro.answers.yes[0],
    desc: UI.intro.answers.yes[1],
    labelClass: "text-accent",
    shortcuts: ["1"],
  },
  {
    key: "willing",
    label: UI.intro.answers.willing[0],
    desc: UI.intro.answers.willing[1],
    labelClass: "text-accent-light-dark",
    shortcuts: ["2"],
  },
  {
    key: "maybe",
    label: UI.intro.answers.maybe[0],
    desc: UI.intro.answers.maybe[1],
    labelClass: "text-text",
    shortcuts: ["3"],
  },
  {
    key: "fantasy",
    label: UI.intro.answers.fantasy[0],
    desc: UI.intro.answers.fantasy[1],
    labelClass: "text-text italic",
    shortcuts: ["4"],
  },
  {
    key: "no",
    label: UI.intro.answers.no[0],
    desc: UI.intro.answers.no[1],
    labelClass: "text-text-muted",
    shortcuts: ["5"],
  },
];

function HelpPopover({
  ref,
  closeRef,
  onClose,
}: Readonly<{
  ref?: RefObject<HTMLDivElement | null>;
  closeRef?: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}>) {
  const hasKeyboard = useHasKeyboard();
  // Three-column when the kbd column is rendered, two-column otherwise.
  // The kbd column uses minmax so it stays tight for single-key rows (`1`)
  // but grows for multi-glyph cells (`Ctrl+↵`) without overflowing into
  // the label column.
  const rowCls = hasKeyboard
    ? "grid grid-cols-[minmax(3.6rem,max-content)_4.2rem_1fr] gap-3 items-center text-[13px] leading-snug"
    : "grid grid-cols-[4.2rem_1fr] gap-3 items-center text-[13px] leading-snug";
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Rating glossary"
      // max-w caps the popover at the viewport's inner width minus a margin,
      // safety net if the card padding ever tightens on the smallest devices.
      className="absolute top-9 right-0 w-80 max-w-[calc(100vw-2rem)] bg-white border border-border/70 rounded-[var(--radius-md)] shadow-warm-lg p-4 z-10 animate-in"
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted/85">
          What each rating means
        </p>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-text-muted/60 hover:text-accent transition-colors text-base leading-none -mt-1 -mr-1 px-1"
        >
          ×
        </button>
      </div>
      <ul className="space-y-2">
        {RATING_HELP.map((item) => (
          <li key={item.key} className={rowCls}>
            {hasKeyboard && (
              <span className="flex items-center gap-0.5">
                {item.shortcuts.map((s, i) => (
                  <span key={s} className="contents">
                    {i > 0 && <span className="text-text-muted/60 text-[0.72rem] mx-0.5">/</span>}
                    <Kbd>{s}</Kbd>
                  </span>
                ))}
              </span>
            )}
            <span className={cn("font-medium", item.labelClass)}>{item.label}</span>
            <span className="text-text-muted">{item.desc}</span>
          </li>
        ))}
      </ul>

      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted/85 mt-5 mb-2.5">Notes</p>
      <p className="text-[13px] text-text-muted leading-relaxed mb-3">
        Optional. Some questions show a prompt and reveal the field — for the rest,{" "}
        <em className="not-italic text-text">+ Add a note</em> opens it. Only your group sees them
      </p>
      {hasKeyboard && (
        <div className={rowCls}>
          <span className="flex items-center">
            <Kbd>{modKey()}</Kbd>
            <span className="text-text-muted/60 text-[0.72rem] mx-1">+</span>
            <Kbd>↵</Kbd>
          </span>
          <span className="font-medium">Save &amp; next</span>
          <span className="text-text-muted">From inside the note</span>
        </div>
      )}
    </div>
  );
}

function Kbd({ children }: Readonly<{ children: ReactNode }>) {
  // line-height < font-size collapses descender slack so glyphs sit in optical center.
  return (
    <kbd className="inline-flex items-center justify-center font-mono text-[11px] leading-[10px] align-middle px-1.5 py-0.5 rounded bg-surface border border-border text-text">
      {children}
    </kbd>
  );
}
