import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
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
