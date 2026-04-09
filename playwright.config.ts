import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    headless: true,
    actionTimeout: 10_000,
  },
  expect: {
    timeout: 10_000,
  },
  globalSetup: "./e2e/global-setup.ts",
});
