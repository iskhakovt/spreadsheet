import { Coffee } from "lucide-react";

/**
 * Quiet "buy me a coffee" link, rendered next to <SourceLink> on the
 * Landing and post-completion results surfaces.
 *
 * Routed through the same-origin `/api/out` proxy: the server holds the
 * actual tip-jar URL (hardcoded — it's the upstream author's tip jar, not
 * a per-deploy slot) and counts click-throughs by placement.
 * `rel="noopener noreferrer"` strips the referrer so any `#key=` fragment
 * on the current URL never leaks once the proxy redirects.
 */
export function TipJarLink({ placement }: Readonly<{ placement: "landing" | "results" }>) {
  return (
    <a
      href={`/api/out?dest=tip&placement=${placement}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-[11px] text-text-muted/50 hover:text-accent transition-colors duration-200 tracking-wide"
    >
      <Coffee size={12} strokeWidth={1.75} />
      Buy me a coffee
    </a>
  );
}
