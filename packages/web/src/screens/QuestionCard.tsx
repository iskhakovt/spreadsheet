import type { Answer, CategoryData, Rating, Timing } from "@spreadsheet/shared";
import { ChevronLeft, ChevronRight, HelpCircle, Pencil } from "lucide-react";
import { type RefObject, useCallback, useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { SyncIndicator } from "../components/SyncIndicator.js";
import type { QuestionScreen } from "../lib/build-screens.js";
import { cn } from "../lib/cn.js";
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
  /** group.showTiming — whether yes/willing fans out to a now/later sub-question. */
  showTimingFlow: boolean;
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
  showTimingFlow,
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
  const category = categoryMap[screen.categoryId];
  const catQuestionScreens = allQuestionScreens.filter((s) => s.categoryId === screen.categoryId);
  const posInCategory = catQuestionScreens.indexOf(screen) + 1;

  const progressPct = totalQuestions > 0 ? (totalAnswered / totalQuestions) * 100 : 0;

  const [helpOpen, setHelpOpen] = useState(false);
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const helpPopoverRef = useRef<HTMLDivElement>(null);
  const helpCloseRef = useRef<HTMLButtonElement>(null);

  // Note state — local while editing, debounced into onCommit. The textarea
  // is reseeded from existingAnswer when the user navigates between questions
  // (screen.key change), so per-question notes don't leak across cards.
  const notePrompt = screen.question.notePrompt;
  const [noteDraft, setNoteDraft] = useState<string>(existingAnswer?.note ?? "");
  const [pillExpanded, setPillExpanded] = useState(false);
  // Pending timing flow — yes/willing on showTimingFlow groups fans out to
  // the now/later sub-question. The TimingButtons component owns the keys.
  const [pendingRating, setPendingRating] = useState<Rating | null>(null);
  const showTiming = pendingRating !== null;
  // Reseed local UI state on navigation only (screen.key change). Including
  // existingAnswer in the dep array would re-clobber the live noteDraft on
  // every commit (the parent re-passes a new existingAnswer right after each
  // onCommit call), losing whatever the user is typing.
  useEffect(() => {
    setNoteDraft(existingAnswer?.note ?? "");
    setPillExpanded(false);
    setPendingRating(null);
  }, [screen.key]);

  const draftHasContent = trimNote(noteDraft) !== null;
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

  // Dismiss help on mode flip / commit / category jump.
  useEffect(() => {
    setHelpOpen(false);
  }, [showTiming, screen.key]);

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
  const handleRating = useCallback(
    async (rating: Rating) => {
      if (showTimingFlow && (rating === "yes" || rating === "if-partner-wants")) {
        setPendingRating(rating);
        return;
      }
      const answer: Answer = { rating, timing: null, note: trimNote(noteDraft) };
      await onCommit(answer);
      if (!noteVisible) onAdvance();
    },
    [showTimingFlow, noteDraft, noteVisible, onCommit, onAdvance],
  );

  const handleTiming = useCallback(
    async (timing: Timing) => {
      if (!pendingRating) return;
      const answer: Answer = { rating: pendingRating, timing, note: trimNote(noteDraft) };
      await onCommit(answer);
      setPendingRating(null);
      if (!noteVisible) onAdvance();
    },
    [pendingRating, noteDraft, noteVisible, onCommit, onAdvance],
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

  const handleSkip = useCallback(() => {
    setPendingRating(null);
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
            aria-label={showTiming ? "What do these timings mean?" : "What do these ratings mean?"}
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
        {helpOpen && (
          <HelpPopover
            ref={helpPopoverRef}
            closeRef={helpCloseRef}
            mode={showTiming ? "timing" : "rating"}
            onClose={() => setHelpOpen(false)}
          />
        )}
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
      {/* Answer controls — RatingGroup and TimingButtons both own their
          keyboard listeners locally (scoped by mount) and their commit
          animation state (local useState). */}
      {showTiming ? (
        <TimingButtons onTiming={handleTiming} />
      ) : (
        <RatingGroup existingAnswer={existingAnswer} onRating={handleRating} />
      )}

      {/* Note section — visible when notePrompt is set on this question, the
          user already has a note, or they tapped "+ Add a note". Stays open
          across rating commits in Layout B (auto-advance suppressed). */}
      {noteVisible && (
        <NoteSection
          key={`note-${screen.key}`}
          notePrompt={notePrompt}
          value={noteDraft}
          onChange={setNoteDraft}
          onSubmit={existingAnswer ? handleNext : undefined}
        />
      )}

      {/* Action row — primary Next when the note section is visible (Layout B),
          thin Back/Skip otherwise (Layout A). The Layout A row also carries
          the inline "+ Add a note" affordance for ordinary questions, so we
          don't add vertical chrome below the ratings. */}
      {noteVisible ? (
        <div className="mt-4 space-y-2">
          <Button fullWidth onClick={handleNext} disabled={!existingAnswer} data-testid="note-next">
            {existingAnswer ? (draftHasContent ? "Save & next" : "Next") : "Rate to continue"}
          </Button>
          <div className="flex justify-between text-xs text-text-muted/65 px-1">
            <button
              type="button"
              onClick={onBack}
              disabled={index === 0}
              aria-label="Previous question"
              className="hover:text-accent disabled:opacity-40 disabled:hover:text-text-muted/65 transition-colors duration-200"
            >
              {UI.question.back}
            </button>
            {!draftHasContent && (
              <button
                type="button"
                onClick={handleSkip}
                aria-label="Skip question"
                className="hover:text-accent transition-colors duration-200"
              >
                {UI.question.skip}
              </button>
            )}
          </div>
        </div>
      ) : (
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
          {/* Inline "+ Add a note" — only for ordinary questions without a
              saved note. Sits between Back and Skip so it adds zero vertical
              chrome to the card; styled to match Back/Skip prominence so it
              reads as a peer action, not a footnote. */}
          <button
            type="button"
            onClick={handleAddNote}
            aria-label="Add a note"
            className="flex items-center gap-1 text-text-muted/70 hover:text-accent transition-colors duration-200"
          >
            <Pencil size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
            <span>Add a note</span>
          </button>
          <button
            type="button"
            onClick={handleSkip}
            aria-label="Skip question"
            className="flex items-center gap-1 text-text-muted/70 hover:text-accent transition-colors duration-200"
          >
            {UI.question.skip}
            <ChevronRight size={16} strokeWidth={1.5} className="shrink-0" />
          </button>
        </div>
      )}
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
  notePrompt,
  value,
  onChange,
  onSubmit,
}: Readonly<{
  notePrompt: string | null;
  value: string;
  onChange: (next: string) => void;
  /** Cmd/Ctrl+Enter from the textarea. Undefined when no rating yet (no answer to commit). */
  onSubmit?: () => void;
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
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter inside the textarea → save & next. Plain Enter
            // adds a newline (default). The submit handler is undefined when
            // there's no rating to commit, so the shortcut is inert until
            // the user has answered.
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onSubmit) {
              e.preventDefault();
              onSubmit();
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
 * style). Owns its own number-key listener (1-5) so the shortcut scopes to
 * exactly when the group is mounted (showTiming=false). Keyboard commits run
 * through the α animation path; mouse clicks commit instantly.
 */
export function RatingGroup({
  existingAnswer,
  onRating,
}: Readonly<{
  existingAnswer: Answer | undefined;
  onRating: (r: Rating) => void;
}>) {
  const checkedIdx = existingAnswer ? RATING_OPTIONS.findIndex((o) => o.rating === existingAnswer.rating) : -1;
  const [focusIdx, setFocusIdx] = useState(checkedIdx >= 0 ? checkedIdx : 0);
  const [committing, setCommitting] = useState<Rating | null>(null);
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
      onRating(rating);
    }
  }

  function handleAnimationEnd(rating: Rating, e: React.AnimationEvent<HTMLButtonElement>) {
    // Filter by name so the ambient transition on the selected ring
    // doesn't also fire this handler.
    if (e.animationName !== COMMIT_ANIMATION_NAME) return;
    if (committing !== rating) return;
    setCommitting(null);
    onRating(rating);
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
 * Timing sub-question (Now / Later) — mirrors RatingGroup's commit pattern
 * with its own keyboard listener (1/n, 2/l). Only mounts when `showTiming`
 * is true; listener lifetime is scoped to the mount.
 */
export function TimingButtons({ onTiming }: Readonly<{ onTiming: (t: Timing) => void }>) {
  const [committing, setCommitting] = useState<Timing | null>(null);

  useEffect(() => {
    if (committing) return;
    function onKey(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      if (e.key === "1" || e.key === "n") {
        e.preventDefault();
        setCommitting("now");
      } else if (e.key === "2" || e.key === "l") {
        e.preventDefault();
        setCommitting("later");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [committing]);

  function handleClick(timing: Timing, e: React.MouseEvent<HTMLButtonElement>) {
    if (committing) return;
    // Same keyboard-vs-mouse detection as RatingGroup — see the detailed
    // note there, including the programmatic .click() caveat.
    if (e.detail === 0) {
      setCommitting(timing);
    } else {
      onTiming(timing);
    }
  }

  function handleAnimationEnd(timing: Timing, e: React.AnimationEvent<HTMLButtonElement>) {
    if (e.animationName !== COMMIT_ANIMATION_NAME) return;
    if (committing !== timing) return;
    setCommitting(null);
    onTiming(timing);
  }

  return (
    <div className="space-y-3 mb-6">
      <p className="text-sm text-text-muted">{UI.question.when}</p>
      <div className="flex gap-3">
        <Button
          variant="accent"
          fullWidth
          onClick={(e) => handleClick("now", e)}
          onAnimationEnd={(e) => handleAnimationEnd("now", e)}
          className={cn(committing === "now" && "commit-alpha")}
        >
          {UI.question.now}
        </Button>
        <Button
          variant="neutral"
          fullWidth
          onClick={(e) => handleClick("later", e)}
          onAnimationEnd={(e) => handleAnimationEnd("later", e)}
          className={cn(committing === "later" && "commit-alpha")}
        >
          {UI.question.later}
        </Button>
      </div>
      <p className="text-xs text-text-muted/60 text-center mt-2 hidden sm:block">Press 1 or 2</p>
    </div>
  );
}

/**
 * In-context glossary popover. Anchors below the help icon in the card
 * header and lists either the rating options (default) or the timing
 * options (when the user is on the Now/Later sub-question). Strings come
 * from `UI.intro.answers` / `UI.intro.timing` so the language matches the
 * intro screen verbatim — recall, not re-explanation.
 */
const RATING_HELP: { key: string; label: string; desc: string; labelClass: string }[] = [
  { key: "yes", label: UI.intro.answers.yes[0], desc: UI.intro.answers.yes[1], labelClass: "text-accent" },
  {
    key: "willing",
    label: UI.intro.answers.willing[0],
    desc: UI.intro.answers.willing[1],
    labelClass: "text-accent-light-dark",
  },
  { key: "maybe", label: UI.intro.answers.maybe[0], desc: UI.intro.answers.maybe[1], labelClass: "text-text" },
  {
    key: "fantasy",
    label: UI.intro.answers.fantasy[0],
    desc: UI.intro.answers.fantasy[1],
    labelClass: "text-text italic",
  },
  { key: "no", label: UI.intro.answers.no[0], desc: UI.intro.answers.no[1], labelClass: "text-text-muted" },
];

const TIMING_HELP: { key: string; label: string; desc: string; labelClass: string }[] = [
  { key: "now", label: UI.intro.timing.now[0], desc: UI.intro.timing.now[1], labelClass: "text-accent" },
  { key: "later", label: UI.intro.timing.later[0], desc: UI.intro.timing.later[1], labelClass: "text-text" },
];

function HelpPopover({
  ref,
  closeRef,
  mode,
  onClose,
}: Readonly<{
  ref?: RefObject<HTMLDivElement | null>;
  closeRef?: RefObject<HTMLButtonElement | null>;
  mode: "rating" | "timing";
  onClose: () => void;
}>) {
  const items = mode === "rating" ? RATING_HELP : TIMING_HELP;
  const title = mode === "rating" ? "What each rating means" : "What each option means";
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={mode === "rating" ? "Rating glossary" : "Timing glossary"}
      // max-w caps the popover at the viewport's inner width minus a margin,
      // safety net if the card padding ever tightens on the smallest devices.
      className="absolute top-9 right-0 w-72 max-w-[calc(100vw-2rem)] bg-white border border-border/70 rounded-[var(--radius-md)] shadow-warm-lg p-4 z-10 animate-in"
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted/85">{title}</p>
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
      <ul className="space-y-2.5">
        {items.map((item) => (
          <li key={item.key} className="grid grid-cols-[88px_1fr] gap-3 text-[13px] leading-snug">
            <span className={cn("font-semibold", item.labelClass)}>{item.label}</span>
            <span className="text-text-muted">{item.desc}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
