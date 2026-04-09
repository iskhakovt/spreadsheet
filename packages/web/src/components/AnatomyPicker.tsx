import type { Anatomy } from "@spreadsheet/shared";
import { useState } from "react";

export function AnatomyPicker({
  selected,
  onSelect,
  labels,
  unselectedClass = "bg-surface border-border text-text-muted",
}: {
  selected: Anatomy | "";
  onSelect: (value: Anatomy) => void;
  labels: Record<Anatomy, string>;
  unselectedClass?: string;
}) {
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
            className={`flex-1 px-4 py-3 rounded-lg border transition-colors ${
              selected === a ? "bg-accent text-accent-fg border-accent" : unselectedClass
            }`}
          >
            {labels[a]}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setShowMore((v) => !v)}
        aria-expanded={showMore}
        className="text-xs text-text-muted mt-1"
      >
        {showMore ? "Show fewer options" : "Show more options"}
      </button>
    </div>
  );
}
