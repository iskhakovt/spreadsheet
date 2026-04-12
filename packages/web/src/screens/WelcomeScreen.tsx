import type { CategoryData } from "@spreadsheet/shared";
import type { RefObject } from "react";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { SyncIndicator } from "../components/SyncIndicator.js";
import type { Screen } from "../lib/build-screens.js";

interface WelcomeScreenProps {
  screen: Extract<Screen, { type: "welcome" }>;
  categoryMap: Record<string, CategoryData>;
  screens: Screen[];
  index: number;
  setIndex: (fn: (i: number) => number) => void;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  syncing: boolean;
  showSyncIndicator: boolean;
  pendingCount: number;
  onSync: () => void;
  onSummary?: () => void;
}

export function WelcomeScreen({
  screen,
  categoryMap,
  screens,
  index,
  setIndex,
  headingRef,
  syncing,
  showSyncIndicator,
  pendingCount,
  onSync,
  onSummary,
}: Readonly<WelcomeScreenProps>) {
  const cat = categoryMap[screen.categoryId];
  return (
    <Card>
      <div className="space-y-8 text-center py-8">
        {/* Eyebrow label — signals this is a category intro, not a question. */}
        <p
          className="stagger text-[11px] font-semibold uppercase tracking-[0.25em] text-accent/70"
          style={{ "--stagger-index": 0 } as React.CSSProperties}
        >
          New category
        </p>

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
          <Button fullWidth onClick={() => setIndex((i) => i + 1)}>
            Start
          </Button>
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
