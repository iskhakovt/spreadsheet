interface EnvConfig {
  SENTRY_DSN?: string;
  REQUIRE_ENCRYPTION?: boolean;
}

declare global {
  interface Window {
    __ENV?: EnvConfig;
  }
}

export type {};
