import type { CategoryData, QuestionData } from "@spreadsheet/shared";
import { useMemo, useState } from "react";
import { Button } from "../components/Button.js";
import { BackLink } from "../components/back-link.js";
import { Card } from "../components/Card.js";
import { cn } from "../lib/cn.js";
import {
  getSelectedCategories,
  getSelectedTier,
  setSelectedCategories,
  setSelectedTier,
  useAnswers,
} from "../lib/storage.js";
import { UI } from "../lib/strings.js";
import { type Side, visibleSides } from "../lib/visibility.js";

interface SummaryProps {
  questions: QuestionData[];
  categories: CategoryData[];
  isAdmin: boolean;
  anatomy: string;
  otherAnatomies: string[];
  questionMode: string;
  onNavigateToCategory: (categoryId: string) => void;
  onBack: () => void;
  onReview: () => void;
  onViewGroup?: () => void;
}

export function Summary({
  questions,
  categories,
  isAdmin,
  anatomy,
  otherAnatomies,
  questionMode,
  onNavigateToCategory,
  onBack,
  onReview,
  onViewGroup,
}: Readonly<SummaryProps>) {
  const answers = useAnswers();
  const [selected, setSelected] = useState(() => new Set(getSelectedCategories() ?? []));
  const [tier, setTier] = useState(getSelectedTier);

  const grouped = useMemo(() => {
    const questionsById = new Map(questions.map((q) => [q.id, q]));
    const memo = new Map<string, Set<Side>>();

    return categories.map((cat) => {
      const catQuestions = questions.filter((q) => q.categoryId === cat.id && q.tier <= tier);
      let total = 0;
      let answered = 0;
      for (const q of catQuestions) {
        const v = visibleSides(q, anatomy, otherAnatomies, questionMode, answers, questionsById, memo);
        if (v.canGive) {
          total++;
          if (answers[`${q.id}:give`]) answered++;
        }
        if (v.canReceive) {
          total++;
          if (answers[`${q.id}:receive`]) answered++;
        }
        if (v.canMutual) {
          total++;
          if (answers[`${q.id}:mutual`]) answered++;
        }
      }
      return { category: cat, total, answered, enabled: selected.has(cat.id) };
    });
  }, [questions, categories, answers, selected, tier, anatomy, otherAnatomies, questionMode]);

  // Hide categories that have no visible questions for this user/group.
  // Without this filter, all-amab groups would see "Reproductive — 0 of 0"
  // because anatomy filtering happens in the question flow but not here.
  const visibleGrouped = useMemo(() => grouped.filter((g) => g.total > 0), [grouped]);

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

  const enabledGrouped = visibleGrouped.filter((g) => g.enabled);
  const totalAnswered = enabledGrouped.reduce((sum, g) => sum + g.answered, 0);
  const totalQuestions = enabledGrouped.reduce((sum, g) => sum + g.total, 0);
  const overallPct = totalQuestions > 0 ? (totalAnswered / totalQuestions) * 100 : 0;

  return (
    <Card>
      <div className="space-y-6">
        <BackLink onClick={onBack} label="Back to questions" />
        <div>
          <h1 className="text-2xl font-bold">Your progress</h1>
          <p className="text-text-muted mt-1">
            {totalAnswered} of {totalQuestions} answered
          </p>
        </div>

        {/* Overall progress bar */}
        <div
          className="h-2 rounded-full overflow-hidden progress-track"
          role="progressbar"
          aria-valuenow={totalAnswered}
          aria-valuemax={totalQuestions}
          aria-label="Overall progress"
        >
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500 ease-out progress-fill",
              overallPct > 0 && "progress-glow",
            )}
            style={{ width: `${overallPct}%` }}
          />
        </div>

        {/* Tier selector */}
        <fieldset className="flex gap-1 p-1 bg-surface/70 rounded-[var(--radius-sm)] border border-border/30">
          <legend className="sr-only">Question depth</legend>
          {([1, 2, 3, 4] as const).map((t) => {
            const info = UI.intro.tiers[t];
            return (
              <label
                key={t}
                className={cn(
                  "flex-1 px-3 py-1.5 rounded-[10px] text-sm font-medium text-center cursor-pointer transition-all duration-200",
                  tier === t
                    ? "bg-gradient-to-b from-accent to-accent-dark text-white shadow-accent-sm"
                    : "text-text-muted hover:text-text",
                )}
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
          {visibleGrouped.map(({ category, total, answered, enabled }) => {
            const catPct = total > 0 ? (answered / total) * 100 : 0;
            return (
              <div
                key={category.id}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-[var(--radius-sm)] border transition-all duration-200",
                  enabled ? "bg-surface/60 border-border/40 hover:bg-surface/80" : "bg-bg border-border/30 opacity-45",
                )}
              >
                {/* Toggle */}
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={() => toggleCategory(category.id)}
                  aria-label={`Include ${category.label}`}
                />

                {/* Category info + jump */}
                <button
                  type="button"
                  onClick={() => enabled && onNavigateToCategory(category.id)}
                  className="flex-1 text-left"
                  disabled={!enabled}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{category.label}</span>
                    <span className="text-xs text-text-muted/70 tabular-nums">
                      {answered}/{total}
                    </span>
                  </div>
                  {enabled && total > 0 && (
                    <div
                      className="mt-1.5 h-1 rounded-full overflow-hidden"
                      role="progressbar"
                      aria-valuenow={answered}
                      aria-valuemax={total}
                      aria-label={`${category.label} progress`}
                      style={{
                        background: "color-mix(in oklab, var(--color-bg) 90%, var(--color-border))",
                      }}
                    >
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${catPct}%`,
                          background:
                            catPct === 100
                              ? "var(--color-accent)"
                              : "color-mix(in srgb, var(--color-accent) 50%, var(--color-accent-light))",
                        }}
                      />
                    </div>
                  )}
                </button>
              </div>
            );
          })}
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
              className="w-full text-sm text-text-muted/70 hover:text-accent py-2 transition-colors duration-200"
            >
              Group members
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
