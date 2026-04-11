import { expect, test } from "./fixtures.js";
import { answerAllQuestions, createGroupAndSetup, narrowToCategory } from "./helpers.js";

test.describe("questionnaire flow", () => {
  test("create group → setup → answer questions", async ({ page }) => {
    // Create group
    await page.goto("/");
    await page.getByText("Get started").click();
    await page.getByText("All questions").click();
    await page.getByLabel('Ask "now or later?"').check();
    await page.getByText("Create group").click();
    await expect(page).toHaveURL(/\/p\/.+/);

    // Combined setup — admin name + partner
    await expect(page.getByText("Set up your group")).toBeVisible();
    await page.getByPlaceholder("Enter your name").fill("Alice");
    await page.getByPlaceholder("Partner's name").fill("Bob");
    await page.getByText("Create & get links").click();

    // Links screen
    await expect(page.getByText("You're all set")).toBeVisible();
    await page.getByText("Start filling out").click();

    // Should see intro
    await expect(page.getByText("Here's how it works")).toBeVisible();
    await page.getByText("Let's go").click();

    // Narrow to Foundations via Summary UI to keep the test focused, but
    // still exercises the real Summary flow (no localStorage poke).
    await narrowToCategory(page, "Foundations");

    // Should see category welcome screen
    await expect(page.getByText("Foundations")).toBeVisible();
    await expect(page.getByText(/\d+ questions/)).toBeVisible();
    await page.getByRole("button", { name: "Start" }).click();

    // Should see first question
    await expect(page.getByRole("radio", { name: "Yes" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "No" })).toBeVisible();

    // Answer with "Yes" → should show timing
    await page.getByRole("radio", { name: "Yes" }).click();
    await expect(page.getByText("When?")).toBeVisible();
    await page.getByRole("button", { name: "Now" }).click();

    // Should advance to next question
    await expect(page.getByRole("button", { name: "Skip question" })).toBeVisible();

    // Finish any remaining questions with No
    await answerAllQuestions(page, "no");
  });

  test("tier picker appears on intro and filters questions", async ({ page }) => {
    await createGroupAndSetup(page);

    await page.getByText("Start filling out").click();

    // Intro screen should show tier picker
    await expect(page.getByText("How many questions?")).toBeVisible();
    await expect(page.getByText("Essentials")).toBeVisible();
    await expect(page.getByText("Curious")).toBeVisible();
    await expect(page.getByText("Adventurous")).toBeVisible();

    // "Curious" should be selected by default (has accent border)
    await page.getByText("Let's go").click();

    // Should proceed to questions — narrow to a single category via UI
    await narrowToCategory(page, "Group & External");
    await expect(page.getByText(/\d+ questions/)).toBeVisible();
  });

  test("changing tier on Summary updates question counts", async ({ page }) => {
    await createGroupAndSetup(page);

    // Intro → pick Essentials tier via the Intro screen's tier picker.
    // The label is visible on Intro as part of the tier selector.
    await page.getByText("Start filling out").click();
    await expect(page.getByText("How many questions?")).toBeVisible();
    await page.getByText("Essentials").click();
    await page.getByText("Let's go").click();

    // Narrow to Power Exchange (has a mix of T1, T2, T3 questions, so tier
    // changes produce visible count changes).
    await narrowToCategory(page, "Power Exchange");

    // Start category, land on a question, then navigate to Summary
    await page.getByRole("button", { name: "Start" }).click();
    await page.getByRole("button", { name: "Progress" }).click();

    // Summary should show Essentials currently selected and a count for power
    await expect(page.getByText("Your progress")).toBeVisible();
    const essentialsCount = await page.locator("text=/\\d+\\/\\d+/").first().textContent();
    const essentialTotal = Number(essentialsCount?.split("/")[1] ?? 0);

    // Switch to Adventurous on Summary
    await page.getByText("Adventurous").click();

    // Count should increase (more questions unlocked at higher tier)
    const adventurousCount = await page.locator("text=/\\d+\\/\\d+/").first().textContent();
    const adventurousTotal = Number(adventurousCount?.split("/")[1] ?? 0);

    expect(adventurousTotal).toBeGreaterThan(essentialTotal);
  });
});
