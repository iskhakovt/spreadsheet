import GitHubMark from "./github.svg?react";

const REPO_URL = "https://github.com/iskhakovt/spreadsheet";

/**
 * Subtle link to the project's GitHub repository. Visually muted — meant
 * to be discoverable to curious visitors without competing with primary
 * content. `rel="noopener noreferrer"` also strips the referrer so any
 * `#key=` fragment on the current URL never leaks to github.com.
 *
 * The GitHub mark is imported as a React component via vite-plugin-svgr so
 * it inherits `currentColor` and animates along with the link's text color
 * on hover. SVG source + license notes are in `./github.svg`.
 */
export function SourceLink() {
  return (
    <a
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-[11px] text-text-muted/50 hover:text-accent transition-colors duration-200 tracking-wide"
    >
      <GitHubMark width={12} height={12} />
      Source on GitHub
    </a>
  );
}
