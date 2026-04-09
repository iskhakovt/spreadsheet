import { useState } from "react";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { getSelectedTier, setHasSeenIntro, setSelectedTier } from "../lib/storage.js";
import { UI } from "../lib/strings.js";

const TIER_QUESTIONS: Record<number, string> = { 1: "~65", 2: "~150", 3: "~190" };

export function Intro({ showTiming, onDone }: { showTiming: boolean; onDone: () => void }) {
  const [tier, setTier] = useState(getSelectedTier);

  return (
    <Card>
      <div className="space-y-8 pt-6">
        <h1 className="text-2xl font-bold">{UI.intro.title}</h1>
        <ol className="space-y-4">
          {UI.intro.steps.map((step, i) => (
            <li key={i} className="flex items-center gap-3">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-surface flex items-center justify-center text-sm font-medium text-text-muted">
                {i + 1}
              </span>
              <span className="text-text-muted leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>

        {/* Answer legend */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">{UI.intro.answersTitle}</h2>
          <dl className="space-y-1.5">
            {Object.values(UI.intro.answers).map(([label, desc]) => (
              <div key={label} className="flex gap-2 text-sm">
                <dt className="font-medium w-32 flex-shrink-0">{label}</dt>
                <dd className="text-text-muted">{desc}</dd>
              </div>
            ))}
          </dl>
          {showTiming && (
            <div className="pt-2 border-t border-border">
              <p className="text-sm font-medium mb-1.5">{UI.intro.timingTitle}</p>
              <dl className="space-y-1.5">
                {Object.values(UI.intro.timing).map(([label, desc]) => (
                  <div key={label} className="flex gap-2 text-sm">
                    <dt className="font-medium w-32 flex-shrink-0">{label}</dt>
                    <dd className="text-text-muted">{desc}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>

        {/* Tier picker */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">{UI.intro.tierTitle}</h2>
          <div className="space-y-2">
            {([1, 2, 3] as const).map((t) => {
              const info = UI.intro.tiers[t];
              const selected = tier === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTier(t)}
                  className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-colors ${
                    selected ? "border-accent bg-accent/10" : "border-border bg-surface hover:border-border/80"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{info.label}</span>
                    <span className="text-xs text-text-muted">{TIER_QUESTIONS[t]} questions</span>
                  </div>
                  <p className="text-sm text-text-muted mt-0.5">{info.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        <Button
          fullWidth
          onClick={() => {
            setSelectedTier(tier);
            setHasSeenIntro();
            onDone();
          }}
        >
          {UI.intro.start}
        </Button>
      </div>
    </Card>
  );
}
