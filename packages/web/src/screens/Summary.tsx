import type { CategoryData, QuestionData } from "@spreadsheet/shared";
import { useMemo, useState } from "react";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import {
  getAnswers,
  getSelectedCategories,
  getSelectedTier,
  setSelectedCategories,
  setSelectedTier,
} from "../lib/storage.js";
import { UI } from "../lib/strings.js";

interface SummaryProps {
  questions: QuestionData[];
  categories: CategoryData[];
  isAdmin: boolean;
  onNavigateToCategory: (categoryId: string) => void;
  onBack: () => void;
  onReview: () => void;
  onViewGroup?: () => void;
}

export function Summary({
  questions,
  categories,
  isAdmin,
  onNavigateToCategory,
  onBack,
  onReview,
  onViewGroup,
}: SummaryProps) {
  const answers = getAnswers();
  const [selected, setSelected] = useState(() => new Set(getSelectedCategories() ?? []));
  const [tier, setTier] = useState(getSelectedTier);

  const grouped = useMemo(() => {
    return categories.map((cat) => {
      const catQuestions = questions.filter((q) => q.categoryId === cat.id && q.tier <= tier);
      let total = 0;
      let answered = 0;
      for (const q of catQuestions) {
        if (q.giveText && q.receiveText) {
          total += 2;
          if (answers[`${q.id}:give`]) answered++;
          if (answers[`${q.id}:receive`]) answered++;
        } else {
          total += 1;
          if (answers[`${q.id}:mutual`]) answered++;
        }
      }
      return { category: cat, total, answered, enabled: selected.has(cat.id) };
    });
  }, [questions, categories, answers, selected, tier]);

  function toggleCategory(catId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      setSelectedCategories([...next]);
      return next;
    });
  }

  function handleTierChange(newTier: number) {
    setTier(newTier);
    setSelectedTier(newTier);
  }

  const totalAnswered = grouped.reduce((sum, g) => sum + g.answered, 0);
  const totalQuestions = grouped.filter((g) => g.enabled).reduce((sum, g) => sum + g.total, 0);

  return (
    <Card>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Your progress</h1>
          <p className="text-text-muted mt-1">
            {totalAnswered} of {totalQuestions} answered
          </p>
        </div>

        {/* Overall progress bar */}
        <div className="h-2 bg-surface rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-300"
            style={{ width: `${totalQuestions > 0 ? (totalAnswered / totalQuestions) * 100 : 0}%` }}
          />
        </div>

        {/* Tier selector */}
        <fieldset className="flex gap-1 p-1 bg-surface rounded-lg">
          <legend className="sr-only">Question depth</legend>
          {([1, 2, 3] as const).map((t) => {
            const info = UI.intro.tiers[t];
            return (
              <label
                key={t}
                className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium text-center cursor-pointer transition-colors ${
                  tier === t ? "bg-accent text-white" : "text-text-muted hover:text-text"
                }`}
              >
                <input
                  type="radio"
                  name="tier"
                  value={t}
                  checked={tier === t}
                  onChange={() => handleTierChange(t)}
                  className="sr-only"
                />
                {info.label}
              </label>
            );
          })}
        </fieldset>

        {/* Category list */}
        <div className="space-y-2">
          {grouped.map(({ category, total, answered, enabled }) => (
            <div
              key={category.id}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors ${
                enabled ? "bg-surface border-border" : "bg-bg border-border/50 opacity-50"
              }`}
            >
              {/* Toggle */}
              <button
                type="button"
                onClick={() => toggleCategory(category.id)}
                className={`w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors ${
                  enabled ? "bg-accent border-accent" : "border-border"
                }`}
              >
                {enabled && (
                  <svg
                    aria-hidden="true"
                    className="w-3 h-3 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>

              {/* Category info + jump */}
              <button
                type="button"
                onClick={() => enabled && onNavigateToCategory(category.id)}
                className="flex-1 text-left"
                disabled={!enabled}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{category.label}</span>
                  <span className="text-xs text-text-muted">
                    {answered}/{total}
                  </span>
                </div>
                {enabled && total > 0 && (
                  <div className="mt-1.5 h-1 bg-bg rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent/60 rounded-full transition-all duration-300"
                      style={{ width: `${(answered / total) * 100}%` }}
                    />
                  </div>
                )}
              </button>
            </div>
          ))}
        </div>

        <div className="space-y-3 pt-2">
          <Button fullWidth onClick={onBack}>
            Back to questions
          </Button>
          <Button variant="ghost" fullWidth onClick={onReview}>
            Review answers
          </Button>
          {isAdmin && onViewGroup && (
            <button
              type="button"
              onClick={onViewGroup}
              className="w-full text-sm text-text-muted hover:text-accent py-2"
            >
              Group members
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
