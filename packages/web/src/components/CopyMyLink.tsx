import { buildPersonLink } from "../lib/crypto.js";
import { getAuthToken } from "../lib/session.js";
import { useCopy } from "../lib/use-copy.js";

function LinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" role="presentation" className="shrink-0">
      <path
        d="M6.5 9.5L9.5 6.5M5.5 11.5L4 13a2.12 2.12 0 0 1-3-3l1.5-1.5M10.5 4.5L12 3a2.12 2.12 0 0 1 3 3l-1.5 1.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" role="presentation" className="shrink-0">
      <path
        d="M3.5 8.5L6.5 11.5L12.5 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Subtle "Copy my link" button for encrypted groups.
 * Builds the full URL including the #key= fragment so the user can
 * reopen on another device or save it as a bookmark.
 * Renders nothing when the group is not encrypted.
 */
export function CopyMyLink({ encrypted }: Readonly<{ encrypted: boolean }>) {
  const { copiedIndex, copy } = useCopy();
  const copied = copiedIndex !== null;

  if (!encrypted) return null;

  function handleCopy() {
    // getAuthToken() is always set — CopyMyLink only renders inside PersonApp
    // which calls setSession(token) synchronously before any child renders.
    const token = getAuthToken();
    if (token) copy(buildPersonLink(token));
  }

  return (
    <div className="pt-2 mt-2 border-t border-border/30 text-center">
      <button
        type="button"
        onClick={handleCopy}
        className={`inline-flex items-center gap-1.5 text-xs transition-colors ${
          copied ? "text-match-green" : "text-text-muted/70 hover:text-accent"
        }`}
      >
        {copied ? <CheckIcon /> : <LinkIcon />}
        {copied ? "Link copied!" : "Copy my link"}
      </button>
    </div>
  );
}
