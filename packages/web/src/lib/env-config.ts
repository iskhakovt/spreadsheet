interface EnvConfig {
  REQUIRE_ENCRYPTION?: boolean;
  /** Optional tip-jar URL (Buy Me a Coffee, GitHub Sponsors, Ko-fi, etc.).
   *  When set, a quiet link is rendered next to the GitHub source link on
   *  the Landing footer and the post-completion results page. Empty/null
   *  hides the link. */
  TIP_JAR_URL?: string | null;
}

declare global {
  interface Window {
    __ENV?: EnvConfig;
  }
}

export type {};
