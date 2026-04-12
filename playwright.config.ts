import { defineConfig, devices } from "@playwright/test";

const visualArgs = [
  "--font-render-hinting=none",
  "--disable-skia-runtime-opts",
  "--disable-font-subpixel-positioning",
  "--disable-lcd-text",
  "--force-color-profile=srgb",
];

const visualExpect = {
  toHaveScreenshot: {
    animations: "disabled" as const,
    caret: "hide" as const,
    scale: "device" as const,
    threshold: 0.2,
    maxDiffPixelRatio: 0.01,
    stylePath: "./e2e/visual/screenshot.css",
    timeout: 15_000,
  },
};

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
      name: "visual-desktop",
      testMatch: /visual\/.+\.spec\.ts$/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 2,
        colorScheme: "light",
        reducedMotion: "reduce",
        launchOptions: { args: visualArgs },
      },
      expect: visualExpect,
    },
    {
      name: "visual-mobile",
      testMatch: /visual\/.+\.spec\.ts$/,
      use: {
        // Desktop Chrome with a mobile viewport — NOT iPhone/WebKit. We use
        // Chromium for both projects so the deterministic rendering args
        // (font-render-hinting, force-color-profile, etc.) apply uniformly.
        // The mobile viewport is what matters for layout regression; the UA
        // string is irrelevant (no server-side mobile detection).
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 664 },
        deviceScaleFactor: 2,
        isMobile: true,
        colorScheme: "light",
        reducedMotion: "reduce",
        launchOptions: { args: visualArgs },
      },
      expect: visualExpect,
    },
  ],
});
