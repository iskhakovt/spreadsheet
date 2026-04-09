import type { Answer, CategoryData, Rating, Timing } from "@spreadsheet/shared";
import type { RefObject } from "react";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { SyncIndicator } from "../components/SyncIndicator.js";
import type { QuestionScreen } from "../lib/build-screens.js";
import { cn } from "../lib/cn.js";
import { UI } from "../lib/strings.js";

const RATING_OPTIONS: readonly { rating: Rating; label: string; variant: string; italic?: boolean }[] = [
  { rating: "yes", label: UI.question.yes, variant: "accent" },
  { rating: "if-partner-wants", label: UI.question.willing, variant: "accent-light" },
  { rating: "maybe", label: UI.question.maybe, variant: "neutral" },
  { rating: "fantasy", label: UI.question.fantasy, variant: "neutral", italic: true },
  { rating: "no", label: UI.question.no, variant: "outline" },
];

const variantStyles: Record<string, string> = {
  accent: "bg-accent text-accent-fg shadow-sm hover:shadow-md hover:brightness-105",
  "accent-light": "bg-accent-light text-accent-fg shadow-sm hover:shadow-md hover:brightness-105",
  neutral: "bg-neutral text-neutral-fg shadow-sm hover:brightness-105",
  outline: "bg-transparent text-neutral border-2 border-neutral/60 hover:border-neutral hover:bg-neutral/5",
};

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
}: QuestionCardProps) {
  const category = categoryMap[screen.categoryId];
  const catQuestionScreens = allQuestionScreens.filter((s) => s.categoryId === screen.categoryId);
  const posInCategory = catQuestionScreens.indexOf(screen) + 1;

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center justify-between mb-8 text-sm">
        <span className="text-text-muted">
          {category?.label} &rsaquo; {posInCategory} of {catQuestionScreens.length}
        </span>
        {onSummary && (
          <button type="button" onClick={onSummary} className="text-text-muted hover:text-accent">
            Progress
          </button>
        )}
      </div>

      {/* Screen reader announcement */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        Question {posInCategory} of {catQuestionScreens.length}, {category?.label}
      </div>

      {/* Question text + description — fixed height zone so buttons don't jump */}
      <div className="min-h-[6rem] mb-2">
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-bold leading-tight outline-none">
          {screen.displayText}
        </h2>
        {screen.question.description && (
          <button
            type="button"
            onClick={onToggleDescription}
            aria-expanded={showDescription}
            className="text-sm text-text-muted mt-3 block"
          >
            {UI.question.whatsThis} {showDescription ? "\u25B4" : "\u25BE"}
          </button>
        )}
        {showDescription && screen.question.description && (
          <p className="text-sm text-text-muted mt-2 leading-relaxed">{screen.question.description}</p>
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
        </div>
      ) : (
        <fieldset aria-label="Rate this activity" className="space-y-3 mb-6 mt-6">
          {RATING_OPTIONS.map((opt) => (
            <label
              key={opt.rating}
              className={cn(
                "flex items-center justify-center w-full",
                "px-6 py-4 rounded-[var(--radius-lg)] font-medium text-base",
                "transition-all duration-200 ease-out",
                "active:scale-[0.97] active:shadow-none",
                "cursor-pointer select-none",
                variantStyles[opt.variant],
                opt.italic && "italic",
                existingAnswer?.rating === opt.rating && "ring-2 ring-accent ring-offset-2 ring-offset-bg",
              )}
            >
              <input
                type="radio"
                name="rating"
                value={opt.rating}
                checked={existingAnswer?.rating === opt.rating}
                onChange={() => onRating(opt.rating)}
                className="sr-only"
              />
              {opt.label}
            </label>
          ))}
          <p className="text-xs text-text-muted text-center mt-2 hidden sm:block">Press 1–5 to answer</p>
        </fieldset>
      )}

      {/* Navigation */}
      <div className="flex justify-between text-sm">
        <button
          type="button"
          onClick={onBack}
          disabled={index === 0}
          aria-label="Previous question"
          className="flex items-center gap-1 text-text-muted disabled:opacity-50"
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
          className="flex items-center gap-1 text-text-muted"
        >
          {UI.question.skip}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" role="presentation" className="shrink-0">
            <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Progress bar + sync */}
      <div
        className="mt-6 h-1.5 bg-surface rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={totalAnswered}
        aria-valuemax={totalQuestions}
        aria-label="Overall progress"
      >
        <div
          className="h-full bg-accent rounded-full transition-all duration-300"
          style={{ width: `${totalQuestions > 0 ? (totalAnswered / totalQuestions) * 100 : 0}%` }}
        />
      </div>
      <div className="mt-1 h-4 flex justify-end">
        <SyncIndicator syncing={syncing} show={showSyncIndicator} pendingCount={pendingCount} onSync={onSync} />
      </div>
    </Card>
  );
}
