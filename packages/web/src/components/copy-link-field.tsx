import { cn } from "../lib/cn.js";

interface CopyLinkFieldProps {
  value: string;
  label: string;
  copied: boolean;
  onCopy: () => void;
  "data-testid"?: string;
}

/** Readonly link input + gradient copy button + screen-reader announcement. */
export function CopyLinkField({ value, label, copied, onCopy, "data-testid": testId }: Readonly<CopyLinkFieldProps>) {
  return (
    <div className="flex gap-2">
      <input
        type="text"
        readOnly
        value={value}
        aria-label={label}
        data-testid={testId}
        className="flex-1 px-3 py-2 rounded-[var(--radius-sm)] bg-bg/80 border border-border/40 text-sm text-text font-mono truncate"
      />
      <button
        type="button"
        onClick={onCopy}
        aria-label={`Copy ${label}`}
        className={cn(
          "px-4 py-2 rounded-[var(--radius-sm)] text-sm font-medium shrink-0",
          "bg-gradient-to-b from-accent to-accent-dark text-accent-fg shadow-accent-sm",
        )}
      >
        {copied ? "Copied!" : "Copy"}
      </button>
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </div>
  );
}
