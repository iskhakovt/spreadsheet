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
    // 0.001 = 0.1% of pixels. Tight enough to catch a one-line copy change.
    maxDiffPixelRatio: 0.001,
    stylePath: "./e2e/visual/screenshot.css",
    timeout: 15_000,
  },
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  // No retries — investigate flakes at the root cause.
  retries: 0,
  workers: process.env.CI ? 4 : "50%",
  fullyParallel: true,
  use: {
    headless: true,
    actionTimeout: 10_000,
  },
  expect: {
    timeout: 1_000,
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
        // `hasTouch: true` emulates a coarse primary pointer via CDP, which
        // flips `matchMedia('(pointer: fine)')` to false — the signal our
        // useHasKeyboard heuristic relies on to hide keyboard hints on
        // touch devices. Without it the project would screenshot the
        // desktop-pointer experience at a mobile width, which has been
        // misleading us into shipping kbd hints to phones.
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 664 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        colorScheme: "light",
        reducedMotion: "reduce",
        launchOptions: { args: visualArgs },
      },
      expect: visualExpect,
    },
  ],
});
