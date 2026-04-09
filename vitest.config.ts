import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["packages/*/src/**/*.test.ts"],
          exclude: ["packages/*/src/**/*.integration.test.ts"],
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
        },
      },
    ],
  },
});
