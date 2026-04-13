import type { Answer, CategoryData, Rating, Timing } from "@spreadsheet/shared";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type RefObject, useRef, useState } from "react";
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
}: Readonly<QuestionCardProps>) {
  const category = categoryMap[screen.categoryId];
  const catQuestionScreens = allQuestionScreens.filter((s) => s.categoryId === screen.categoryId);
  const posInCategory = catQuestionScreens.indexOf(screen) + 1;

  const progressPct = totalQuestions > 0 ? (totalAnswered / totalQuestions) * 100 : 0;

  return (
    <Card>
      {/* Header — category pill on the left, Progress link on the right.
          The pill groups category label + position inside the category so
          the eye reads "where am I" as one unit. */}
      <div className="flex items-center justify-between mb-8">
        <span className="inline-flex items-center gap-2 text-xs font-medium text-text-muted tracking-wide">
          <span className="relative flex items-center justify-center">
            <span className="absolute w-2 h-2 rounded-full bg-accent/40 animate-ping" />
            <span className="relative w-1.5 h-1.5 rounded-full bg-accent" />
          </span>
          <span className="uppercase">{category?.label}</span>
          <span className="text-text-muted/40">&middot;</span>
          <span className="tabular-nums">
            {posInCategory}/{catQuestionScreens.length}
          </span>
        </span>
        {onSummary && (
          <button
            type="button"
            onClick={onSummary}
            className="text-xs font-medium text-text-muted hover:text-accent transition-colors"
          >
            Progress
          </button>
        )}
      </div>
      {/* Screen reader announcement */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        Question {posInCategory} of {catQuestionScreens.length}, {category?.label}
      </div>
      {/* Question text + description — fixed height zone so buttons don't jump.
          Keyed on screen.key so each question fades in individually, giving the
          flow a gentle "turning the page" rhythm instead of content swapping in
          place. */}
      <div key={screen.key} className="animate-in min-h-[6rem] mb-2">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className="text-[1.65rem] font-bold leading-[1.2] tracking-tight outline-none text-balance"
        >
          {screen.displayText}
        </h2>
        {screen.question.description && (
          <button
            type="button"
            onClick={onToggleDescription}
            aria-expanded={showDescription}
            className="text-sm text-text-muted/80 mt-3 inline-flex items-center gap-1 hover:text-accent transition-colors"
          >
            {UI.question.whatsThis} {showDescription ? "\u25B4" : "\u25BE"}
          </button>
        )}
        {showDescription && screen.question.description && (
          <p className="text-sm text-text-muted mt-2 leading-relaxed animate-in">{screen.question.description}</p>
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
          <p className="text-xs text-text-muted text-center mt-2 hidden sm:block">Press 1 or 2</p>
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
          className="flex items-center gap-1 text-text-muted disabled:opacity-50"
        >
          <ChevronLeft size={16} strokeWidth={1.5} className="shrink-0" />
          {UI.question.back}
        </button>
        <button
          type="button"
          onClick={onSkip}
          aria-label="Skip question"
          className="flex items-center gap-1 text-text-muted"
        >
          {UI.question.skip}
          <ChevronRight size={16} strokeWidth={1.5} className="shrink-0" />
        </button>
      </div>
      {/* Progress bar + sync — gradient fill warms as it grows, subtle
          inset shadow gives the track a little depth without feeling heavy. */}
      <div
        className="mt-8 h-1.5 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={totalAnswered}
        aria-valuemax={totalQuestions}
        aria-label="Overall progress"
        style={{
          background: "color-mix(in oklab, var(--color-surface) 85%, var(--color-border))",
          boxShadow: "inset 0 1px 2px rgba(58, 48, 40, 0.06)",
        }}
      >
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${progressPct}%`,
            background: "linear-gradient(90deg, var(--color-accent-light) 0%, var(--color-accent) 100%)",
            boxShadow: progressPct > 0 ? "0 0 8px rgba(208, 128, 88, 0.35)" : "none",
          }}
        />
      </div>
      <div className="mt-1 h-4 flex justify-end">
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
            "active:scale-[0.97] active:shadow-none",
            "cursor-pointer select-none",
            variantStyles[opt.variant],
            opt.italic && "italic",
            existingAnswer?.rating === opt.rating && "ring-2 ring-accent ring-offset-2 ring-offset-bg",
          )}
        >
          {opt.label}
        </button>
      ))}
      <p className="text-xs text-text-muted text-center mt-2 hidden sm:block">Press 1–5 to answer</p>
    </div>
  );
}
