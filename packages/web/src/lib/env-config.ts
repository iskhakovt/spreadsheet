interface EnvConfig {
  REQUIRE_ENCRYPTION?: boolean;
}

declare global {
  interface Window {
    __ENV?: EnvConfig;
  }
}

export type {};
