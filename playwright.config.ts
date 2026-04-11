import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  // No retries — investigate flakes at the root cause.
  retries: 0,
  workers: process.env.CI ? 2 : "50%",
  fullyParallel: true,
  use: {
    headless: true,
    actionTimeout: 10_000,
  },
  expect: {
    timeout: 10_000,
  },
  globalSetup: "./e2e/global-setup.ts",
});
