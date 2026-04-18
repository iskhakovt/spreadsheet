import type { CategoryData } from "@spreadsheet/shared";
import type { RefObject } from "react";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { SyncIndicator } from "../components/SyncIndicator.js";
import type { Screen } from "../lib/build-screens.js";

interface CategoryWelcomeScreenProps {
  screen: Extract<Screen, { type: "welcome" }>;
  categoryMap: Readonly<Record<string, CategoryData>>;
  screens: readonly Screen[];
  index: number;
  setIndex: (fn: (i: number) => number) => void;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  syncing: boolean;
  showSyncIndicator: boolean;
  pendingCount: number;
  hasAnswersInCategory: boolean;
  /** Index of the first unanswered question in this category, or -1 if all
   *  questions in this category are answered. Used to branch the Start /
   *  Continue / Review-from-the-start primary button. */
  firstUnansweredInCategoryIdx: number;
  onSync: () => void;
  onSummary?: () => void;
}

export function CategoryWelcomeScreen({
  screen,
  categoryMap,
  screens,
  index,
  setIndex,
  headingRef,
  syncing,
  showSyncIndicator,
  pendingCount,
  hasAnswersInCategory,
  firstUnansweredInCategoryIdx,
  onSync,
  onSummary,
}: Readonly<CategoryWelcomeScreenProps>) {
  const cat = categoryMap[screen.categoryId];
  // First question of this category is always the screen right after the
  // welcome — buildScreens emits one welcome then contiguous questions.
  const firstQuestionIdx = index + 1;
  const hasUnanswered = firstUnansweredInCategoryIdx !== -1;

  const goToFirstUnanswered = () => setIndex(() => firstUnansweredInCategoryIdx);
  const goToFirstQuestion = () => setIndex(() => firstQuestionIdx);

  // Primary button label mirrors the /group CTA vocabulary:
  //   fresh (no answers)   → Start
  //   partial              → Continue → first unanswered
  //   complete             → Review from the start → first question
  const primaryLabel = !hasAnswersInCategory ? "Start" : hasUnanswered ? "Continue" : "Review from the start";
  const primaryHandler = !hasAnswersInCategory
    ? goToFirstQuestion
    : hasUnanswered
      ? goToFirstUnanswered
      : goToFirstQuestion;
  return (
    <Card>
      <div className="space-y-8 text-center py-8">
        {/* Eyebrow label — signals this is a category intro, not a question.
            Suppressed once the user has answers in this category so returning
            visitors don't see "New" for something they've already started. */}
        {!hasAnswersInCategory && (
          <p
            className="stagger text-[11px] font-semibold uppercase tracking-[0.25em] text-accent/70"
            style={{ "--stagger-index": 0 } as React.CSSProperties}
          >
            New category
          </p>
        )}

        <h2
          ref={headingRef}
          tabIndex={-1}
          className="stagger text-[2.5rem] font-bold leading-[1.02] tracking-[-0.02em] outline-none"
          style={{ "--stagger-index": 1 } as React.CSSProperties}
        >
          {cat?.label}
        </h2>

        {cat?.description && (
          <p
            className="stagger text-text-muted leading-[1.7] text-[15px] text-balance max-w-[22rem] mx-auto"
            style={{ "--stagger-index": 2 } as React.CSSProperties}
          >
            {cat.description}
          </p>
        )}

        <div
          className="stagger inline-flex items-center gap-3 text-xs text-text-muted/70"
          style={{ "--stagger-index": 2 } as React.CSSProperties}
        >
          <span className="h-px w-8 bg-gradient-to-r from-transparent to-border" />
          <span className="tabular-nums tracking-wide">{screen.questionCount} questions</span>
          <span className="h-px w-8 bg-gradient-to-l from-transparent to-border" />
        </div>

        <div className="stagger space-y-3 pt-2" style={{ "--stagger-index": 3 } as React.CSSProperties}>
          <Button fullWidth onClick={primaryHandler}>
            {primaryLabel}
          </Button>
          {/* Secondary option for partial categories — lets the user revisit
              answered questions from the top instead of resuming mid-flow. */}
          {hasAnswersInCategory && hasUnanswered && (
            <Button variant="ghost" fullWidth onClick={goToFirstQuestion}>
              Review from the start
            </Button>
          )}
          <Button
            variant="ghost"
            fullWidth
            onClick={() => {
              const nextIdx = screens.findIndex(
                (s, i) => i > index && s.type === "welcome" && s.categoryId !== screen.categoryId,
              );
              setIndex(() => (nextIdx !== -1 ? nextIdx : screens.length));
            }}
          >
            Skip this category
          </Button>
          {onSummary && (
            <button
              type="button"
              onClick={onSummary}
              className="text-sm text-text-muted/70 hover:text-accent transition-colors duration-200"
            >
              View all categories
            </button>
          )}
        </div>
        <div className="flex justify-center">
          <SyncIndicator syncing={syncing} show={showSyncIndicator} pendingCount={pendingCount} onSync={onSync} />
        </div>
      </div>
    </Card>
  );
}
