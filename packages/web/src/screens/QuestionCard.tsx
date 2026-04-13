import type { Answer, CategoryData, Rating, Timing } from "@spreadsheet/shared";
import { type RefObject, useRef, useState } from "react";
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

interface QuestionCardProps {
  screen: QuestionScreen;
  categoryMap: Record<string, CategoryData>;
  allQuestionScreens: QuestionScreen[];
  existingAnswer: Answer | undefined;
  index: number;
  totalAnswered: number;
  totalQuestions: number;
  showTiming: boolean;
  showDescription: boolean;
  syncing: boolean;
  showSyncIndicator: boolean;
  pendingCount: number;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  onRating: (rating: Rating) => void;
  onTiming: (timing: Timing) => void;
  onBack: () => void;
  onSkip: () => void;
  onToggleDescription: () => void;
  onSync: () => void;
  onSummary?: () => void;
}

export function QuestionCard({
  screen,
  categoryMap,
  allQuestionScreens,
  existingAnswer,
  index,
  totalAnswered,
  totalQuestions,
  showTiming,
  showDescription,
  syncing,
  showSyncIndicator,
  pendingCount,
  headingRef,
  onRating,
  onTiming,
  onBack,
  onSkip,
  onToggleDescription,
  onSync,
  onSummary,
}: Readonly<QuestionCardProps>) {
  const category = categoryMap[screen.categoryId];
  const catQuestionScreens = allQuestionScreens.filter((s) => s.categoryId === screen.categoryId);
  const posInCategory = catQuestionScreens.indexOf(screen) + 1;

  const progressPct = totalQuestions > 0 ? (totalAnswered / totalQuestions) * 100 : 0;

  return (
    <Card>
      {/* Header — category pill + position, Progress link on the right. */}
      <div className="flex items-center justify-between mb-8">
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
        {onSummary && (
          <button
            type="button"
            onClick={onSummary}
            className="text-xs font-medium text-text-muted/70 hover:text-accent transition-colors duration-200"
          >
            Progress
          </button>
        )}
      </div>
      {/* Screen reader announcement */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        Question {posInCategory} of {catQuestionScreens.length}, {category?.label}
      </div>
      {/* Question text + description — keyed on screen.key for per-question
          fade-in, giving the flow a page-turning rhythm. */}
      <div key={screen.key} className="animate-in min-h-[6rem] mb-2">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-[1.65rem] font-bold leading-[1.18] tracking-[-0.015em] outline-none text-balance"
        >
          {screen.displayText}
        </h2>
        {screen.question.description && (
          <button
            type="button"
            onClick={onToggleDescription}
            aria-expanded={showDescription}
            className="text-sm text-text-muted/70 mt-3 inline-flex items-center gap-1.5 hover:text-accent transition-colors duration-200"
          >
            {UI.question.whatsThis}
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              role="presentation"
              className={cn("transition-transform duration-200", showDescription && "rotate-180")}
            >
              <path d="M2 4L5 7L8 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
        {showDescription && screen.question.description && (
          <p className="text-sm text-text-muted mt-2.5 leading-relaxed animate-in">{screen.question.description}</p>
        )}
      </div>
      {/* Timing sub-question */}
      {showTiming ? (
        <div className="space-y-3 mb-6">
          <p className="text-sm text-text-muted">{UI.question.when}</p>
          <div className="flex gap-3">
            <Button variant="accent" fullWidth onClick={() => onTiming("now")}>
              {UI.question.now}
            </Button>
            <Button variant="neutral" fullWidth onClick={() => onTiming("later")}>
              {UI.question.later}
            </Button>
          </div>
          <p className="text-xs text-text-muted/60 text-center mt-2 hidden sm:block">Press 1 or 2</p>
        </div>
      ) : (
        <RatingGroup existingAnswer={existingAnswer} onRating={onRating} />
      )}

      {/* Navigation */}
      <div className="flex justify-between text-sm">
        <button
          type="button"
          onClick={onBack}
          disabled={index === 0}
          aria-label="Previous question"
          className="flex items-center gap-1 text-text-muted/70 hover:text-text-muted disabled:opacity-40 transition-colors duration-200"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" role="presentation" className="shrink-0">
            <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          {UI.question.back}
        </button>
        <button
          type="button"
          onClick={onSkip}
          aria-label="Skip question"
          className="flex items-center gap-1 text-text-muted/70 hover:text-text-muted transition-colors duration-200"
        >
          {UI.question.skip}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" role="presentation" className="shrink-0">
            <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {/* Progress bar — gradient fill warms as it grows, subtle inset shadow
          gives the track depth. */}
      <div
        className="mt-8 h-1.5 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={totalAnswered}
        aria-valuemax={totalQuestions}
        aria-label="Overall progress"
        style={{
          background: "color-mix(in oklab, var(--color-surface) 85%, var(--color-border))",
          boxShadow: "inset 0 1px 2px rgba(58, 48, 40, 0.05)",
        }}
      >
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${progressPct}%`,
            background: "linear-gradient(90deg, var(--color-accent-light) 0%, var(--color-accent) 100%)",
            boxShadow: progressPct > 0 ? "0 0 10px rgba(208, 128, 88, 0.3)" : "none",
          }}
        />
      </div>
      <div className="mt-1.5 h-4 flex justify-end">
        <SyncIndicator syncing={syncing} show={showSyncIndicator} pendingCount={pendingCount} onSync={onSync} />
      </div>
    </Card>
  );
}

/** Roving-tabindex radio group — button[role="radio"] pattern (Radix/React Aria style). */
function RatingGroup({
  existingAnswer,
  onRating,
}: Readonly<{
  existingAnswer: Answer | undefined;
  onRating: (r: Rating) => void;
}>) {
  const checkedIdx = existingAnswer ? RATING_OPTIONS.findIndex((o) => o.rating === existingAnswer.rating) : -1;
  const [focusIdx, setFocusIdx] = useState(checkedIdx >= 0 ? checkedIdx : 0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function handleKeyDown(e: React.KeyboardEvent) {
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

  return (
    <div role="radiogroup" aria-label="Rate this activity" className="space-y-3 mb-6 mt-6" onKeyDown={handleKeyDown}>
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
          onClick={() => onRating(opt.rating)}
          className={cn(
            "flex items-center justify-center w-full",
            "px-6 py-4 rounded-[var(--radius-lg)] font-medium text-base",
            "transition-all duration-200 ease-out",
            "active:scale-[0.975] active:brightness-[0.97]",
            "cursor-pointer select-none",
            variantStyles[opt.variant],
            opt.italic && "italic",
            existingAnswer?.rating === opt.rating && "ring-2 ring-accent/60 ring-offset-2 ring-offset-bg scale-[1.01]",
          )}
        >
          {opt.label}
        </button>
      ))}
      <p className="text-xs text-text-muted/50 text-center mt-2 hidden sm:block">Press 1–5 to answer</p>
    </div>
  );
}
