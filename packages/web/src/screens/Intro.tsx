import { MAX_TIER, type Tier } from "@spreadsheet/shared";
import { useState } from "react";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { cn } from "../lib/cn.js";
import { getSelectedTier, setHasSeenIntro, setSelectedTier } from "../lib/storage.js";
import { UI } from "../lib/strings.js";

const TIER_QUESTIONS: Record<number, string> = { 1: "~90", 2: "~250", 3: "~360", 4: "~400" };
const TIERS: Tier[] = Array.from({ length: MAX_TIER }, (_, i) => (i + 1) as Tier);

export function Intro({ showTiming, onDone }: Readonly<{ showTiming: boolean; onDone: () => void }>) {
  const [tier, setTier] = useState(getSelectedTier);

  return (
    <Card>
      <div className="space-y-8">
        <h1 className="text-2xl font-bold">{UI.intro.title}</h1>
        <ol className="space-y-4">
          {UI.intro.steps.map((step, i) => (
            <li key={step} className="flex items-center gap-3.5">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-surface/80 border border-border/30 flex items-center justify-center text-sm font-medium text-text-muted">
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
          <p className="text-xs italic text-text-muted/80 leading-[1.55]">{UI.intro.answersFootnote}</p>
          {showTiming && (
            <div className="pt-3 border-t border-border/40">
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
          <div role="radiogroup" aria-label="Question depth" className="space-y-2">
            {TIERS.map((t) => {
              const info = UI.intro.tiers[t];
              const selected = tier === t;
              return (
                // biome-ignore lint/a11y/useSemanticElements: button[role=radio] for custom radio group
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setTier(t)}
                  className={cn(
                    "w-full text-left px-4 py-3.5 rounded-[var(--radius-md)] border-2 transition-all duration-200",
                    selected
                      ? "border-accent bg-accent/[0.06] shadow-[0_0_0_1px_rgb(208_128_88/0.1)]"
                      : "border-border/60 bg-surface/50 hover:border-border hover:bg-surface/70",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{info.label}</span>
                    <span className="text-xs text-text-muted/70 tabular-nums">{TIER_QUESTIONS[t]} questions</span>
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
