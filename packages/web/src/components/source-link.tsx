import GitHubMark from "./github.svg?react";

/**
 * Subtle link to the project's GitHub repository. Visually muted — meant
 * to be discoverable to curious visitors without competing with primary
 * content.
 *
 * Routed through the same-origin `/api/out` proxy so the server can count
 * click-throughs by placement without third-party analytics. The proxy
 * resolves the destination URL — keeping it server-side means the link
 * here never carries the actual destination, so a misset bundle can't
 * accidentally point clicks anywhere unexpected. `rel="noopener noreferrer"`
 * also strips the referrer so any `#key=` fragment on the current URL
 * never leaks to github.com.
 *
 * The GitHub mark is imported as a React component via vite-plugin-svgr so
 * it inherits `currentColor` and animates along with the link's text color
 * on hover. SVG source + license notes are in `./github.svg`.
 */
export function SourceLink({ placement }: Readonly<{ placement: "landing" | "results" }>) {
  return (
    <a
      href={`/api/out?dest=source&placement=${placement}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-[11px] text-text-muted/50 hover:text-accent transition-colors duration-200 tracking-wide"
    >
      <GitHubMark width={12} height={12} />
      Source on GitHub
    </a>
  );
}
