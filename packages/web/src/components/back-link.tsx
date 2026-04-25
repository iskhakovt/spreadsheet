import { ChevronLeft } from "lucide-react";
import { cn } from "../lib/cn.js";

interface BackLinkProps {
  onClick: () => void;
  label?: string;
  className?: string;
}

/**
 * Top-of-screen back affordance — chevron + label. Used as the universal
 * escape hatch on screens reached intentionally (Summary, Group, Review).
 * Structurally similar to `QuestionCard`'s Back/Skip row (lucide chevron
 * + muted text), with hover-to-accent to match the prominence of other
 * top-level navigation like `source-link.tsx` and `copy-my-link.tsx`.
 */
export function BackLink({ onClick, label = "Back", className }: Readonly<BackLinkProps>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 text-sm text-text-muted/70 hover:text-accent transition-colors duration-200",
        className,
      )}
    >
      <ChevronLeft size={16} strokeWidth={1.5} className="shrink-0" />
      {label}
    </button>
  );
}
