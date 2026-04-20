import { expect, test } from "./fixtures.js";
import { answerAllQuestions, createGroupAndSetup, goThroughIntro, narrowToCategory } from "./helpers.js";

// Mobile viewport — short enough that Summary overflows the viewport,
// so the test exercises the real "user scrolled the page before the
// nav click" state that motivated RouteReset.
test.use({ viewport: { width: 390, height: 664 } });

test.describe("RouteReset — scroll + focus on SPA navigation", () => {
  test("scrolls to top and focuses the route's heading when navigating between screens", async ({ page }) => {
    await createGroupAndSetup(page);
    await page.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(page);
    await narrowToCategory(page, "Group & External");
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Seed 2 answers so Review has rows to render. Stay on /questions —
    // "Group & External" has 7 entries, so we're still mid-flow after 2.
    await page.getByRole("radio", { name: "Yes", exact: true }).click();
    await page.getByRole("radio", { name: "No", exact: true }).click();

    // Navigate to Summary via the in-app Progress button (wouter
    // navigate, not a goto). Summary is the canonical "long page" — 16
    // category rows push "Review answers" below the 664px fold.
    await page.getByRole("button", { name: "Progress", exact: true }).click();
    await expect(page.getByText("Your progress")).toBeVisible();

    // Explicitly scroll Summary so the next click fires from a non-zero
    // scroll state. Without RouteReset this would carry over to Review.
    await page.evaluate(() => window.scrollTo(0, 400));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    // Wouter SPA nav → RouteReset should fire on the location change.
    await page.getByRole("button", { name: "Review answers", exact: true }).click();
    await expect(page.getByText("Review your answers")).toBeVisible();

    // Assert: scroll reset, focus on the new heading.
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBe(0);

    const activeTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(activeTag).toBe("H1");

    const activeText = await page.evaluate(() => document.activeElement?.textContent);
    expect(activeText).toContain("Review your answers");
  });

  test("does not reset scroll on initial page load — the user didn't navigate, and a scrollTo would undo any anchor-driven position", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Get started", exact: true })).toBeVisible();

    // On a fresh load, focus should be on <body> (the browser default)
    // — not hijacked onto the Landing h1 by RouteReset.
    const activeTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(activeTag).toBe("BODY");
  });
});

test.describe("useScrollReset — scroll on sub-state transitions", () => {
  test("scrolls to top when advancing to the next question card", async ({ page }) => {
    await createGroupAndSetup(page);
    await page.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(page);
    await narrowToCategory(page, "Group & External");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(page.getByRole("radio", { name: "Yes", exact: true })).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 400));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    await page.getByRole("radio", { name: "No", exact: true }).click();
    // Wait for the next question to confirm the transition completed.
    await expect(page.getByRole("radio", { name: "Yes", exact: true })).toBeVisible();

    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("scrolls to top when the group setup form transitions to the success screen", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Get started", exact: true }).click();
    await page.getByRole("radio", { name: "All questions", exact: true }).click();
    await page.getByRole("button", { name: "Create group", exact: true }).click();
    await expect(page.getByText("Set up your group")).toBeVisible();

    await page.getByPlaceholder("Enter your name").fill("Alice");
    await page.getByPlaceholder("Partner's name").fill("Bob");
    // Add extra partners so the form is tall enough to have been scrolled.
    for (const name of ["Charlie", "Dana"]) {
      await page.getByRole("button", { name: "+ Add another person", exact: true }).click();
      await page.getByPlaceholder("Partner's name").last().fill(name);
    }

    await page.evaluate(() => window.scrollTo(0, 400));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Create & get links", exact: true }).click();
    await expect(page.getByText("You're all set")).toBeVisible();

    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("scrolls to top when switching between pair tabs on the results screen", async ({ alice, bob, carol }) => {
    const { partnerLinks } = await createGroupAndSetup(alice, {
      adminName: "Alice",
      partnerName: "Bob",
      extraPartners: ["Carol"],
    });

    await alice.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Touch & Body");
    await answerAllQuestions(alice, "yes");
    await alice.getByRole("button", { name: "I'm done", exact: true }).click();

    await bob.goto(partnerLinks[0]);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Touch & Body");
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done", exact: true }).click();

    await carol.goto(partnerLinks[1]);
    await goThroughIntro(carol);
    await narrowToCategory(carol, "Touch & Body");
    await answerAllQuestions(carol, "yes");
    await carol.getByRole("button", { name: "I'm done", exact: true }).click();

    await expect(carol.getByText("Your matches")).toBeVisible();
    const tabList = carol.getByRole("tablist", { name: "Pair results", exact: true });
    await expect(tabList).toBeVisible();

    await carol.evaluate(() => window.scrollTo(0, 400));
    await expect.poll(() => carol.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    await tabList.getByRole("tab").nth(1).click();

    expect(await carol.evaluate(() => window.scrollY)).toBe(0);
  });
});
