import type { Answer, CategoryData, QuestionData } from "@spreadsheet/shared";
import { useMemo } from "react";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { getAnswers, getSelectedCategories } from "../lib/storage.js";
import { UI } from "../lib/strings.js";

interface ReviewProps {
  questions: QuestionData[];
  categories: CategoryData[];
  onMarkComplete: () => void;
  onViewProgress: () => void;
  onEditQuestion: (key: string) => void;
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
}: Readonly<ReviewProps>) {
  const answers = getAnswers();
  const selectedCategories = getSelectedCategories() ?? [];

  const grouped = useMemo(() => {
    const groups: Record<
      string,
      {
        category: CategoryData;
        items: { key: string; label: string; answer: Answer | undefined }[];
      }
    > = {};

    for (const q of questions) {
      if (!selectedCategories.includes(q.categoryId)) continue;

      if (q.giveText && q.receiveText) {
        const giveKey = `${q.id}:give`;
        const receiveKey = `${q.id}:receive`;
        if (!groups[q.categoryId]) {
          const cat = categories.find((c) => c.id === q.categoryId);
          if (cat) groups[q.categoryId] = { category: cat, items: [] };
        }
        if (groups[q.categoryId]) {
          groups[q.categoryId].items.push({ key: giveKey, label: q.giveText, answer: answers[giveKey] });
          groups[q.categoryId].items.push({ key: receiveKey, label: q.receiveText, answer: answers[receiveKey] });
        }
      } else {
        const key = `${q.id}:mutual`;
        if (!groups[q.categoryId]) {
          const cat = categories.find((c) => c.id === q.categoryId);
          if (cat) groups[q.categoryId] = { category: cat, items: [] };
        }
        if (groups[q.categoryId]) {
          groups[q.categoryId].items.push({ key, label: q.text, answer: answers[key] });
        }
      }
    }
    return Object.values(groups);
  }, [questions, categories, selectedCategories, answers]);

  const totalAnswered = Object.keys(answers).length;
  const totalQuestions = grouped.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <Card>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">{UI.review.title}</h1>
          <p className="text-text-muted mt-1">{UI.review.answered(totalAnswered, totalQuestions)}</p>
        </div>

        {grouped.map((group) => (
          <div key={group.category.id}>
            <h3 className="text-sm font-medium text-text-muted mb-2">{group.category.label}</h3>
            <div className="space-y-1">
              {group.items.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  onClick={() => onEditQuestion(item.key)}
                  className="w-full text-left flex items-center justify-between px-4 py-2.5 rounded-lg hover:bg-surface transition-colors"
                >
                  <span className="text-sm truncate mr-4">{item.label}</span>
                  {item.answer ? (
                    <span className={`text-sm shrink-0 ${ratingStyle(item.answer.rating)}`}>
                      {RATING_LABELS[item.answer.rating]}
                      {item.answer.timing ? ` (${item.answer.timing})` : ""}
                    </span>
                  ) : (
                    <span className="text-sm text-text-muted/50 shrink-0">—</span>
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
