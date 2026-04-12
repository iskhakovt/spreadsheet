import { expect, test } from "../fixtures.js";
import { answerAllQuestions, createGroupAndSetup, goThroughIntro, narrowToCategory } from "../helpers.js";

/** Extract the /p/{token} base path from a full URL. */
function personBase(url: string): string {
  const match = url.match(/(\/p\/[^/#?]+)/);
  if (!match) throw new Error(`Can't extract person base from URL: ${url}`);
  return match[1];
}

test.describe("admin 2-person flow", () => {
  test("setup → invite → intro → questions → summary → review → waiting → results", async ({ alice, bob }) => {
    // --- GroupSetup: form with partner names ---
    await alice.goto("/");
    await alice.getByText("Get started").click();
    await alice.getByText("All questions").click();
    await alice.getByText("Create group").click();
    await expect(alice).toHaveURL(/\/p\/.+/);
    await expect(alice.getByText("Set up your group")).toBeVisible();

    await alice.getByPlaceholder("Enter your name").fill("Alice");
    await alice.getByPlaceholder("Partner's name").fill("Bob");
    await expect(alice).toHaveScreenshot("setup-form.png");

    await alice.getByText("Create & get links").click();
    await expect(alice.getByText("You're all set")).toBeVisible();
    await expect(alice).toHaveScreenshot("setup-links.png");

    // Grab the partner link for Bob and the base path
    const partnerLink = await alice.locator("input[readonly]").inputValue();
    const base = personBase(alice.url());

    // --- Invite screen ---
    await alice.getByText("Start filling out").click();
    await alice.goto(base + "/invite");
    await expect(alice.getByText("Invite your partner")).toBeVisible();
    await expect(alice).toHaveScreenshot("invite-members.png");

    // --- Intro screen (without timing) ---
    await alice.goto(base + "/intro");
    await expect(alice.getByText("Here's how it works")).toBeVisible();
    await expect(alice).toHaveScreenshot("intro-no-timing.png");

    await goThroughIntro(alice);

    // --- Welcome screen (category interstitial) ---
    await expect(alice.getByRole("button", { name: "Start" })).toBeVisible();
    await expect(alice).toHaveScreenshot("welcome-screen.png");

    // Narrow to a small category for speed
    await narrowToCategory(alice, "Group & External");

    // --- Question card (unanswered) ---
    await alice.getByRole("button", { name: "Start" }).click();
    await expect(alice.getByText("Yes", { exact: true })).toBeVisible();
    await expect(alice).toHaveScreenshot("question-unanswered.png");

    // Answer all with yes (review screenshot gets variety from give/receive role labels)
    await answerAllQuestions(alice, "yes");

    // --- End of questions (all answered) ---
    await expect(alice.getByText("All done!")).toBeVisible();
    await expect(alice).toHaveScreenshot("end-all-answered.png");

    // Mark complete → waiting
    await alice.getByRole("button", { name: "I'm done" }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();

    // --- Summary screen (via "Edit my answers" → navigate to /summary) ---
    await alice.getByText("Edit my answers").click();
    await alice.goto(base + "/summary");
    await expect(alice.getByText("Your progress")).toBeVisible();
    await expect(alice).toHaveScreenshot("summary.png");

    // --- Review screen ---
    await alice.getByRole("button", { name: "Review answers" }).click();
    await expect(alice.getByText("Review your answers")).toBeVisible();
    await expect(alice).toHaveScreenshot("review.png");

    // --- Waiting screen (admin, not all complete) ---
    await alice.goto(base + "/waiting");
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();
    await expect(alice).toHaveScreenshot("waiting-admin.png");

    // --- Bob completes to trigger results ---
    await bob.goto(partnerLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Group & External");
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done" }).click();

    // --- Results / Comparison (2 people) ---
    // After Bob completes, Alice auto-redirects to /results via WS push + route guard
    await expect(alice.getByText("Your matches")).toBeVisible({ timeout: 10_000 });
    await expect(alice).toHaveScreenshot("results-2p.png");
  });

  test("intro with timing enabled", async ({ page }) => {
    await createGroupAndSetup(page, { showTiming: true });
    await page.getByText("Start filling out").click();
    await expect(page.getByText("Here's how it works")).toBeVisible();
    await expect(page).toHaveScreenshot("intro-with-timing.png");

    // Question with timing sub-question
    await goThroughIntro(page);
    await narrowToCategory(page, "Group & External");
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByText("Yes", { exact: true })).toBeVisible();

    // Answer yes → timing sub-question must appear
    await page.getByRole("radio", { name: "Yes" }).click();
    await expect(page.getByRole("button", { name: "Now" })).toBeVisible();
    await expect(page).toHaveScreenshot("question-timing.png");
  });
});
