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
      <div className="flex gap-2 flex-wrap">
        {options.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => onSelect(a)}
            className={`flex-1 px-4 py-3 rounded-lg border transition-colors ${
              selected === a ? "bg-accent text-accent-fg border-accent" : unselectedClass
            }`}
          >
            {labels[a]}
          </button>
        ))}
      </div>
      <button type="button" onClick={() => setShowMore((v) => !v)} className="text-xs text-text-muted mt-1">
        {showMore ? "Show fewer options" : "Show more options"}
      </button>
    </div>
  );
}
