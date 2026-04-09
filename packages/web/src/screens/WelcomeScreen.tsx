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
}: WelcomeScreenProps) {
  const cat = categoryMap[screen.categoryId];
  return (
    <Card>
      <div className="animate-in space-y-6 pt-12 text-center">
        <h2 ref={headingRef} tabIndex={-1} className="text-2xl font-bold outline-none">
          {cat?.label}
        </h2>
        {cat?.description && <p className="text-text-muted">{cat.description}</p>}
        <p className="text-sm text-text-muted">{screen.questionCount} questions</p>
        <div className="space-y-3 pt-4">
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
            <button type="button" onClick={onSummary} className="text-sm text-text-muted hover:text-accent">
              View all categories
            </button>
          )}
        </div>
        <SyncIndicator syncing={syncing} show={showSyncIndicator} pendingCount={pendingCount} onSync={onSync} />
      </div>
    </Card>
  );
}
