import { defineConfig, devices } from "@playwright/test";

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
  projects: [
    {
      name: "e2e",
      testIgnore: /visual\//,
    },
    {
      name: "visual",
      testMatch: /visual\/.+\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 480, height: 900 },
        deviceScaleFactor: 1,
        colorScheme: "light",
        reducedMotion: "reduce",
        launchOptions: {
          args: [
            "--font-render-hinting=none",
            "--disable-skia-runtime-opts",
            "--disable-font-subpixel-positioning",
            "--disable-lcd-text",
            "--force-color-profile=srgb",
          ],
        },
      },
      expect: {
        toHaveScreenshot: {
          animations: "disabled",
          caret: "hide",
          scale: "css",
          threshold: 0.2,
          maxDiffPixelRatio: 0.01,
        },
      },
    },
  ],
});
