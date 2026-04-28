import { Coffee } from "lucide-react";

/**
 * Quiet "buy me a coffee" link, rendered next to <SourceLink> on the
 * Landing and post-completion results surfaces. Reads the URL from
 * `window.__ENV.TIP_JAR_URL` (server-injected at request time) — when
 * unset (most environments) the link is hidden entirely so this is
 * opt-in per-deploy rather than baked into the bundle.
 *
 * `rel="noopener noreferrer"` strips the referrer so any `#key=` fragment
 * on the current URL never leaks to the tip-jar host. Since the link
 * stays inert until clicked (no script load on render), the privacy
 * story is preserved for every visitor who never clicks.
 */
export function TipJarLink() {
  const url = typeof window !== "undefined" ? window.__ENV?.TIP_JAR_URL : null;
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-[11px] text-text-muted/50 hover:text-accent transition-colors duration-200 tracking-wide"
    >
      <Coffee size={12} strokeWidth={1.75} />
      Buy me a coffee
    </a>
  );
}
