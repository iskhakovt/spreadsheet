import { expect, test } from "../fixtures.js";
import {
  answerQuestionsCycling,
  createGroupAndSetup,
  goThroughIntro,
  narrowToCategory,
  personBase,
} from "../helpers.js";

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
    const partnerLink = await alice.locator('[data-testid="partner-link"]').inputValue();
    const base = personBase(alice.url());

    // --- Group screen ---
    await alice.getByText("Start filling out").click();
    await alice.goto(base + "/group");
    await expect(alice.getByText("Your group")).toBeVisible();
    await expect(alice).toHaveScreenshot("group-members.png");

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

    // Answer with mixed ratings for review variety
    await answerQuestionsCycling(alice, ["yes", "if-partner-wants", "maybe", "fantasy", "no"]);

    // --- End of questions (all answered — some skipped via "no") ---
    await expect(alice.getByText("All done!").or(alice.getByText("That's the last one"))).toBeVisible();
    await expect(alice).toHaveScreenshot("end-of-questions.png");

    // Mark complete → waiting
    await alice.getByRole("button", { name: "I'm done" }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();

    // --- Summary screen with partial progress ---
    await alice.getByText("Edit my answers").click();
    await alice.goto(base + "/summary");
    await expect(alice.getByText("Your progress")).toBeVisible();
    await expect(alice).toHaveScreenshot("summary.png");

    // --- Review screen with mixed ratings ---
    await alice.getByRole("button", { name: "Review answers" }).click();
    await expect(alice.getByText("Review your answers")).toBeVisible();
    await expect(alice).toHaveScreenshot("review.png");

    // --- Waiting screen (admin, not all complete) ---
    await alice.goto(base + "/waiting");
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();
    await expect(alice).toHaveScreenshot("waiting-admin.png");

    // --- Bob answers with complementary mix for match type variety ---
    await bob.goto(partnerLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Group & External");
    // Bob: yes, maybe, yes, fantasy, yes — produces:
    //   Q1: Alice=yes  Bob=yes        → match
    //   Q2: Alice=ipw  Bob=maybe      → possible
    //   Q3: Alice=maybe Bob=yes       → possible
    //   Q4: Alice=fantasy Bob=fantasy  → fantasy
    //   Q5: Alice=no  Bob=yes         → hidden
    //   ...cycles repeat
    await answerQuestionsCycling(bob, ["yes", "maybe", "yes", "fantasy", "yes"]);
    await bob.getByRole("button", { name: "I'm done" }).click();

    // --- Results with match type variety (no timing → no green-light column) ---
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

  test("question with description + help popover", async ({ page }) => {
    // `phone-sex` is the first Foundations question with a description;
    // `dirty-talk` and `sexting` each split into give + receive screens, so
    // four No clicks advance past them to phone-sex.
    await createGroupAndSetup(page);
    await page.getByText("Start filling out").click();
    await goThroughIntro(page);
    await narrowToCategory(page, "Foundations");
    await page.getByRole("button", { name: "Start" }).click();
    for (let i = 0; i < 4; i++) {
      await page.getByRole("radio", { name: "No" }).click();
    }

    await expect(page.getByText("Phone sex / voice notes")).toBeVisible();
    await expect(page.getByText(/Sexual conversation or erotic audio/)).toBeVisible();
    await expect(page).toHaveScreenshot("question-with-description.png");

    // Help popover open — verifies the rating-mode glossary
    await page.getByRole("button", { name: /What do these ratings mean/ }).click();
    await expect(page.getByRole("dialog", { name: "Rating glossary" })).toBeVisible();
    await expect(page).toHaveScreenshot("question-with-help-popover.png");
  });
});
