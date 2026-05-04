import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import {
  answerAllQuestions,
  createGroupAndSetup,
  dismissNotePromptIfPresent,
  goThroughIntro,
  narrowToCategory,
} from "./helpers.js";

/**
 * Curated viewport matrix — a representative slice of real-world sizes,
 * not an exhaustive device list. Each screen marked "should not scroll"
 * is asserted at every viewport here.
 *
 * Heights are what matters for scroll regression; widths must still be
 * plausible so media queries fire correctly.
 */
const VIEWPORTS = [
  { name: "mobile-sm", width: 375, height: 667 }, // iPhone SE — smallest common
  { name: "mobile-md", width: 390, height: 844 }, // iPhone 13-15 baseline
  { name: "mobile-lg", width: 412, height: 915 }, // Pixel 7 / Android flagship
  { name: "tablet", width: 768, height: 1024 }, // iPad portrait
  { name: "laptop-sm", width: 1280, height: 800 }, // 13" MacBook (matches visual-desktop)
  { name: "laptop-md", width: 1440, height: 900 }, // 15" MacBook Air
  { name: "desktop", width: 1920, height: 1080 }, // Common desktop monitor
] as const;

type ViewportName = (typeof VIEWPORTS)[number]["name"];
type ScreenName =
  | "landing"
  | "intro"
  | "category-welcome"
  | "question-card"
  | "question-long-desc"
  | "all-done"
  | "waiting";

/**
 * Per-screen list of viewports where scroll is tolerated. Additions here
 * should be rare and justified — the whole point of this suite is to
 * catch *unintentional* scroll. Document the reason inline.
 */
const EXPECTED_TO_SCROLL: Partial<Record<ScreenName, ReadonlySet<ViewportName>>> = {
  // Intro is first-run-only onboarding — 3 "how it works" steps, a 5-item
  // answer legend, and a 4-option tier picker. The 4th tier (Edge) added
  // ~80px of content height, pushing intro past the 1080px desktop budget
  // too. Trimming would cost comprehension for a screen users see once.
  intro: new Set(["mobile-sm", "mobile-md", "mobile-lg", "tablet", "laptop-sm", "laptop-md", "desktop"]),
  // Long-description questions (e.g. reassurance-after, primal-play — 100+
  // char descriptions wrapping to 3 lines) plus the 5-button rating stack
  // are one line short of fitting on iPhone SE (375×667). Closing the gap
  // would require capping description length or collapsing descriptions
  // behind a tap — both are design calls.
  "question-long-desc": new Set(["mobile-sm"]),
};

async function assertNoScroll(page: Page, screen: ScreenName, vp: (typeof VIEWPORTS)[number]) {
  if (EXPECTED_TO_SCROLL[screen]?.has(vp.name)) return;

  // Let layout settle — two rAF frames + 50ms catches any last-paint
  // reflow (animate-in entrances that shift final height, late font loads).
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 50)));
      }),
  );

  const { scrollHeight, clientHeight } = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }));

  const overflow = scrollHeight - clientHeight;
  expect(
    overflow,
    `${screen} @ ${vp.name}: overflowed by ${overflow}px (scrollHeight=${scrollHeight}, clientHeight=${clientHeight})`,
  ).toBeLessThanOrEqual(1);
}

for (const vp of VIEWPORTS) {
  test.describe(`no scroll @ ${vp.name} (${vp.width}x${vp.height})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("landing", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("button", { name: "Get started", exact: true })).toBeVisible();
      await assertNoScroll(page, "landing", vp);
    });

    test("onboarding + question flow", async ({ page }) => {
      // Single flow covers five internal screens so group-creation cost
      // amortizes: intro → category welcome → question card → "all done"
      // → waiting. Each screen is checked against the exclusion map in
      // assertNoScroll — intro is expected to scroll on all but desktop.
      await createGroupAndSetup(page);
      await page.getByRole("button", { name: "Start filling out", exact: true }).click();

      await expect(page.getByText("Here's how it works")).toBeVisible();
      await assertNoScroll(page, "intro", vp);

      await goThroughIntro(page);

      await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
      await assertNoScroll(page, "category-welcome", vp);

      await narrowToCategory(page, "Group & External");

      await page.getByRole("button", { name: "Start", exact: true }).click();
      await expect(page.getByText("Yes", { exact: true })).toBeVisible();
      await assertNoScroll(page, "question-card", vp);

      await answerAllQuestions(page, "no");
      await expect(page.getByText("All done!").or(page.getByText("That's the last one"))).toBeVisible();
      await assertNoScroll(page, "all-done", vp);

      await page.getByRole("button", { name: "I'm done", exact: true }).click();
      await expect(page.getByText("Waiting for everyone")).toBeVisible();
      await assertNoScroll(page, "waiting", vp);
    });

    test("question card shapes — long description", async ({ page }) => {
      // The primary onboarding test above happens to hit a short question
      // with no description. Tall shapes are a real risk: a multi-line
      // description or a multi-line heading can push the card past the
      // viewport at tight heights (laptop-sm was at 4px overflow before
      // the Card padding trim). Explicitly exercise the worst realistic
      // shapes at every viewport.
      //
      // Target: Aftercare → reassurance-after (tier 1, position 6). Its
      // 103-char description wraps to 2-3 lines, exceeding the reserved
      // min-h floor.
      await createGroupAndSetup(page);
      await page.getByRole("button", { name: "Start filling out", exact: true }).click();
      await goThroughIntro(page);
      await narrowToCategory(page, "Aftercare");

      await page.getByRole("button", { name: "Start", exact: true }).click();

      // Walk forward with No until the long-description question appears.
      // Loop-until-target rather than a fixed count — tolerant to question
      // bank reordering or new give/receive splits in earlier entries.
      const target = page.getByText("Verbal reassurance after intense play");
      for (let i = 0; i < 20 && !(await target.isVisible().catch(() => false)); i++) {
        await page.getByRole("radio", { name: "No", exact: true }).click();
        await dismissNotePromptIfPresent(page);
      }
      await expect(target).toBeVisible();
      await expect(page.getByText(/you're amazing, I love you/)).toBeVisible();
      await assertNoScroll(page, "question-long-desc", vp);
    });
  });
}
