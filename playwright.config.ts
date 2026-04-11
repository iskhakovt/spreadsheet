import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  // Local runs get the same retry as CI. Under heavy parallel worker load
  // (4+ concurrent Chromium instances sharing one machine's CPU), React
  // commits + Playwright polling occasionally bump past the 10s expect
  // timeout on cross-user assertions. CI's workers=2 sidesteps this, but
  // dev machines running at workers=50% hit it intermittently. One retry
  // absorbs the transient failures without masking real bugs (two
  // consecutive failures still surface).
  retries: 1,
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
