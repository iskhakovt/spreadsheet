import type { Anatomy } from "@spreadsheet/shared";
import { useState } from "react";
import { cn } from "../lib/cn.js";

export function AnatomyPicker({
  selected,
  onSelect,
  labels,
  unselectedClass = "bg-surface/60 border-border/40 text-text-muted",
}: Readonly<{
  selected: Anatomy | "";
  onSelect: (value: Anatomy) => void;
  labels: Record<Anatomy, string>;
  unselectedClass?: string;
}>) {
  const [showMore, setShowMore] = useState(false);
  const options: Anatomy[] = showMore ? ["amab", "afab", "both", "none"] : ["amab", "afab"];

  return (
    <div>
      <div role="radiogroup" aria-label="Body type" className="flex gap-2 flex-wrap">
        {options.map((a) => (
          // biome-ignore lint/a11y/useSemanticElements: button[role=radio] with roving tabindex for custom radio group
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={selected === a}
            onClick={() => onSelect(a)}
            className={cn(
              "flex-1 px-4 py-3 rounded-[var(--radius-sm)] border transition-all duration-200",
              selected === a
                ? "bg-gradient-to-b from-accent to-accent-dark text-accent-fg border-accent shadow-accent-sm"
                : unselectedClass,
            )}
          >
            {labels[a]}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setShowMore((v) => !v)}
        aria-expanded={showMore}
        className="text-xs text-text-muted/70 mt-1.5 hover:text-accent transition-colors duration-200"
      >
        {showMore ? "Show fewer options" : "Show more options"}
      </button>
    </div>
  );
}
