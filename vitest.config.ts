import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["packages/*/src/**/*.test.{ts,tsx}"],
          exclude: ["packages/*/src/**/*.integration.test.ts"],
          env: { REQUIRE_ENCRYPTION: "false" },
          // Node 25+ defines a global `localStorage` that is `undefined`
          // without `--localstorage-file`, and happy-dom doesn't replace it,
          // so DOM tests see no localStorage. Disable Node's Web Storage so
          // the happy-dom one wins (vitest-dev/vitest#8757). The flag exists
          // since Node 22.4, so it's a no-op on the current Node 24 runtime.
          execArgv: ["--no-experimental-webstorage"],
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["packages/*/src/**/*.integration.test.ts"],
          globalSetup: "./packages/server/src/test/integration-setup.ts",
          testTimeout: 60_000,
          hookTimeout: 600_000,
          // Integration tests share a single Postgres container; running test
          // files in parallel causes TRUNCATE / FK deadlocks.
          fileParallelism: false,
          env: { REQUIRE_ENCRYPTION: "false" },
        },
      },
    ],
  },
});
