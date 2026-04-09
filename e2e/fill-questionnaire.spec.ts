import { expect, test } from "./fixtures.js";
import { answerAllQuestions, createGroupAndSetup, setCategories, setTier } from "./helpers.js";

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

    // Restrict to one category for speed
    await setCategories(page, ["foundations"]);

    await page.getByText("Start filling out").click();

    // Should see intro
    await expect(page.getByText("Here's how it works")).toBeVisible();
    await page.getByText("Let's go").click();

    // Should see category welcome screen (no more category picker)
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

    // Restrict to one category for speed
    await setCategories(page, ["group"]);
    await page.getByText("Start filling out").click();

    // Intro screen should show tier picker
    await expect(page.getByText("How many questions?")).toBeVisible();
    await expect(page.getByText("Essentials")).toBeVisible();
    await expect(page.getByText("Curious")).toBeVisible();
    await expect(page.getByText("Adventurous")).toBeVisible();

    // "Curious" should be selected by default (has accent border)
    await page.getByText("Let's go").click();

    // Should proceed to questions
    await expect(page.getByText(/\d+ questions/)).toBeVisible();
  });

  test("changing tier on Summary updates question counts", async ({ page }) => {
    await createGroupAndSetup(page);

    // Use a category with mixed tiers (power has 1 T1, 7 T2, 7 T3)
    await setCategories(page, ["power"]);
    await setTier(page, 1);
    await page.getByText("Start filling out").click();
    await page.getByText("Let's go").click();

    // Start category, land on a question, then navigate to Summary
    await page.getByRole("button", { name: "Start" }).click();
    await page.getByText("Progress").click();

    // Summary should show Essentials selected and a count for power
    await expect(page.getByText("Your progress")).toBeVisible();
    const essentialsCount = await page.locator("text=/\\d+\\/\\d+/").first().textContent();
    const essentialTotal = Number(essentialsCount?.split("/")[1] ?? 0);

    // Switch to Adventurous on Summary
    await page.getByText("Adventurous").click();

    // Count should increase
    const adventurousCount = await page.locator("text=/\\d+\\/\\d+/").first().textContent();
    const adventurousTotal = Number(adventurousCount?.split("/")[1] ?? 0);

    expect(adventurousTotal).toBeGreaterThan(essentialTotal);
  });
});
