import { cn } from "../lib/cn.js";

interface ToggleOption<T extends string> {
  value: T;
  label: string;
}

interface ToggleGroupProps<T extends string> {
  options: ToggleOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: "md" | "sm";
  "aria-label"?: string;
}

export function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  "aria-label": ariaLabel,
}: ToggleGroupProps<T>) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex gap-2">
      {options.map((opt) => (
        // biome-ignore lint/a11y/useSemanticElements: button[role=radio] for custom radio group
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={opt.value === value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "flex-1 border text-sm font-medium transition-all duration-200",
            size === "md" ? "px-4 py-3 rounded-[var(--radius-md)]" : "px-3 py-2.5 rounded-[var(--radius-sm)]",
            opt.value === value
              ? "bg-accent text-accent-fg border-accent shadow-sm"
              : "bg-surface border-border text-text-muted hover:border-accent/30",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
