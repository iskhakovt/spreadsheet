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
