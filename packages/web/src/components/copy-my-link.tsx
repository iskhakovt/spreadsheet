import { Check, Link } from "lucide-react";
import { cn } from "../lib/cn.js";
import { buildPersonLink } from "../lib/crypto.js";
import { useCopy } from "../lib/use-copy.js";

interface CopyMyLinkProps {
  encrypted: boolean;
  token: string;
}

/**
 * Subtle "Copy my link" button for encrypted groups.
 * Builds the full URL including the #key= fragment so the user can
 * reopen on another device or save it as a bookmark.
 * Renders nothing when the group is not encrypted.
 */
export function CopyMyLink({ encrypted, token }: Readonly<CopyMyLinkProps>) {
  const { copiedIndex, copy } = useCopy();
  const copied = copiedIndex !== null;

  if (!encrypted) return null;

  function handleCopy() {
    copy(buildPersonLink(token));
  }

  return (
    <div className="pt-2 mt-2 border-t border-border/30 text-center">
      <button
        type="button"
        onClick={handleCopy}
        className={cn(
          "inline-flex items-center gap-1.5 text-xs transition-colors",
          copied ? "text-match-green" : "text-text-muted/70 hover:text-accent",
        )}
      >
        {copied ? <Check size={12} strokeWidth={1.5} /> : <Link size={12} strokeWidth={1.5} />}
        {copied ? "Link copied!" : "Copy my link"}
      </button>
    </div>
  );
}
