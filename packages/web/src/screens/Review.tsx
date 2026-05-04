import type { CategoryData, QuestionData } from "@spreadsheet/shared";
import { useMemo, useState } from "react";
import { Button } from "../components/Button.js";
import { BackLink } from "../components/back-link.js";
import { Card } from "../components/Card.js";
import { buildReviewGroups } from "../lib/build-screens.js";
import { cn } from "../lib/cn.js";
import { useAnswers } from "../lib/self-journal.js";
import { getSelectedCategories } from "../lib/storage.js";
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
  // Mount-time snapshot — `getSelectedCategories()` re-parses localStorage
  // and returns a new array each call, which would invalidate the grouped
  // memo on every render. Same pattern as Question.tsx.
  const [selectedCategories] = useState<string[]>(() => getSelectedCategories() ?? []);

  const categoryMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

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
                  className="w-full text-left flex flex-col px-4 py-2.5 rounded-[var(--radius-sm)] hover:bg-surface/70 transition-colors duration-200"
                >
                  <div className="flex items-center justify-between w-full gap-4">
                    <span className="text-sm truncate">{item.label}</span>
                    {item.answer ? (
                      <span className={cn("text-sm shrink-0", ratingStyle(item.answer.rating))}>
                        {RATING_LABELS[item.answer.rating]}
                      </span>
                    ) : (
                      <span className="text-sm text-text-muted/40 shrink-0">&mdash;</span>
                    )}
                  </div>
                  {item.answer?.note && (
                    <p className="mt-1 text-xs italic text-text-muted/85 leading-[1.55] text-pretty">
                      {item.answer.note}
                    </p>
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
