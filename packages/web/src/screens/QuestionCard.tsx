import type { Answer, CategoryData, Rating, Timing } from "@spreadsheet/shared";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { SyncIndicator } from "../components/SyncIndicator.js";
import type { QuestionScreen } from "../lib/build-screens.js";
import { UI } from "../lib/strings.js";

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

      {/* Question text */}
      <div className="min-h-[3.5rem] mb-2">
        <h2 className="text-2xl font-bold leading-tight">{screen.displayText}</h2>
      </div>

      {/* What's this? */}
      {screen.question.description && (
        <button type="button" onClick={onToggleDescription} className="text-sm text-text-muted mb-4 block">
          {UI.question.whatsThis} {showDescription ? "\u25B4" : "\u25BE"}
        </button>
      )}
      {showDescription && screen.question.description && (
        <p className="text-sm text-text-muted mb-6 leading-relaxed">{screen.question.description}</p>
      )}

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
        <div className="space-y-3 mb-6 mt-6">
          {(
            [
              { rating: "yes" as const, label: UI.question.yes, variant: "accent" as const },
              { rating: "if-partner-wants" as const, label: UI.question.willing, variant: "accent-light" as const },
              { rating: "maybe" as const, label: UI.question.maybe, variant: "neutral" as const },
              {
                rating: "fantasy" as const,
                label: UI.question.fantasy,
                variant: "neutral" as const,
                className: "italic",
              },
              { rating: "no" as const, label: UI.question.no, variant: "outline" as const },
            ] as const
          ).map((btn) => (
            <Button
              key={btn.rating}
              variant={btn.variant}
              fullWidth
              className={`${"className" in btn ? btn.className : ""} ${existingAnswer?.rating === btn.rating ? "ring-2 ring-accent ring-offset-2 ring-offset-bg" : ""}`}
              onClick={() => onRating(btn.rating)}
            >
              {btn.label}
            </Button>
          ))}
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between text-sm">
        <button type="button" onClick={onBack} disabled={index === 0} className="text-text-muted disabled:opacity-30">
          &larr; {UI.question.back}
        </button>
        <button type="button" onClick={onSkip} className="text-text-muted">
          {UI.question.skip} &rarr;
        </button>
      </div>

      {/* Progress bar + sync */}
      <div className="mt-6 h-1.5 bg-surface rounded-full overflow-hidden">
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
