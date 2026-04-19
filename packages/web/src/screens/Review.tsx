import type { CategoryData, QuestionData } from "@spreadsheet/shared";
import { useMemo } from "react";
import { Button } from "../components/Button.js";
import { BackLink } from "../components/back-link.js";
import { Card } from "../components/Card.js";
import { buildReviewGroups } from "../lib/build-screens.js";
import { cn } from "../lib/cn.js";
import { getSelectedCategories, useAnswers } from "../lib/storage.js";
import { UI } from "../lib/strings.js";

interface ReviewProps {
  questions: QuestionData[];
  categories: CategoryData[];
  onMarkComplete: () => void;
  onViewProgress: () => void;
  onEditQuestion: (key: string) => void;
  onBack: () => void;
}

const RATING_LABELS: Record<string, string> = {
  yes: UI.question.yes,
  "if-partner-wants": UI.question.willing,
  maybe: UI.question.maybe,
  fantasy: UI.question.fantasy,
  no: UI.question.no,
};

function ratingStyle(rating: string): string {
  switch (rating) {
    case "yes":
      return "text-accent font-medium";
    case "if-partner-wants":
      return "text-accent-light font-medium";
    case "no":
      return "text-neutral";
    case "fantasy":
      return "text-neutral italic";
    default:
      return "text-text-muted";
  }
}

export function Review({
  questions,
  categories,
  onMarkComplete,
  onViewProgress,
  onEditQuestion,
  onBack,
}: Readonly<ReviewProps>) {
  const answers = useAnswers();
  const selectedCategories = getSelectedCategories() ?? [];

  // Category-by-id lookup — `useAnswers` gives stable answers identity, so
  // memoizing here is worthwhile; categoryMap is stable per `categories`.
  const categoryMap = useMemo(() => {
    const map = new Map<string, CategoryData>();
    for (const c of categories) map.set(c.id, c);
    return map;
  }, [categories]);

  // Grouping extracted to `buildReviewGroups` for testability — see
  // build-screens.ts. Pure function of its inputs; unit-tested there.
  const grouped = useMemo(
    () => buildReviewGroups(questions, categoryMap, selectedCategories, answers),
    [questions, categoryMap, selectedCategories, answers],
  );

  const totalAnswered = Object.keys(answers).length;
  const totalQuestions = grouped.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <Card>
      <div className="space-y-6">
        <BackLink onClick={onBack} />
        <div>
          <h1 className="text-2xl font-bold">{UI.review.title}</h1>
          <p className="text-text-muted mt-1">{UI.review.answered(totalAnswered, totalQuestions)}</p>
        </div>

        {grouped.map((group) => (
          <div key={group.category.id}>
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-text-muted/80 mb-2">
              <span className="w-1 h-1 rounded-full bg-accent/60" />
              {group.category.label}
            </h3>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  onClick={() => onEditQuestion(item.key)}
                  className="w-full text-left flex items-center justify-between px-4 py-2.5 rounded-[var(--radius-sm)] hover:bg-surface/70 transition-colors duration-200"
                >
                  <span className="text-sm truncate mr-4">{item.label}</span>
                  {item.answer ? (
                    <span className={cn("text-sm shrink-0", ratingStyle(item.answer.rating))}>
                      {RATING_LABELS[item.answer.rating]}
                      {item.answer.timing ? ` (${item.answer.timing})` : ""}
                    </span>
                  ) : (
                    <span className="text-sm text-text-muted/40 shrink-0">&mdash;</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="space-y-3 pt-4">
          <Button fullWidth onClick={onMarkComplete}>
            {UI.review.done}
          </Button>
          <Button variant="ghost" fullWidth onClick={onViewProgress}>
            Edit categories
          </Button>
        </div>
      </div>
    </Card>
  );
}
