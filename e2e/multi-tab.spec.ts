import { expect, test } from "./fixtures.js";
import { answerAllQuestions, goThroughIntro, scopedGet, setCategories } from "./helpers.js";

test.describe("multi-tab isolation", () => {
  test("admin opens partner link in same browser — answers don't cross-contaminate", async ({ browser }) => {
    // Single context = shared localStorage (simulates same browser, multiple tabs)
    const ctx = await browser.newContext();
    const admin = await ctx.newPage();

    await admin.goto("/");
    await admin.getByText("Get started").click();
    await admin.getByText("All questions").click();
    await admin.getByText("Create group").click();
    await expect(admin).toHaveURL(/\/p\/.+/);

    await expect(admin.getByText("Set up your group")).toBeVisible();
    await admin.getByPlaceholder("Enter your name").fill("Alice");
    await admin.getByPlaceholder("Partner's name").fill("Bob");
    await admin.getByText("Create & get links").click();
    await expect(admin.getByText("You're all set")).toBeVisible({ timeout: 10000 });
    const bobLink = await admin.locator("input[readonly]").inputValue();

    // Admin answers one question
    await setCategories(admin, ["group"]);
    await admin.getByText("Start filling out").click();
    await goThroughIntro(admin);
    await expect(admin.getByText(/\d+ questions/)).toBeVisible({ timeout: 10000 });
    await admin.getByRole("button", { name: "Start" }).click();
    await admin.getByRole("button", { name: "No" }).click();

    // Verify admin has scoped answers
    const adminAnswers = await scopedGet(admin, "answers");
    expect(adminAnswers).toBeTruthy();
    expect(Object.values(JSON.parse(adminAnswers!))[0]).toHaveProperty("rating", "no");

    // Open Bob's link in same browser (new page, shared localStorage)
    const bob = await ctx.newPage();
    await bob.goto(bobLink);
    await setCategories(bob, ["group"]);
    await goThroughIntro(bob);
    await expect(bob.getByText(/\d+ questions/)).toBeVisible({ timeout: 10000 });
    await bob.getByRole("button", { name: "Start" }).click();
    await bob.getByRole("button", { name: "Yes" }).click();
    await bob.getByRole("button", { name: "Now" }).click();

    // Bob has separate scoped answers
    const bobAnswers = await scopedGet(bob, "answers");
    expect(bobAnswers).toBeTruthy();
    expect(Object.values(JSON.parse(bobAnswers!))[0]).toHaveProperty("rating", "yes");

    // Admin's answers untouched
    const adminAnswersAfter = await scopedGet(admin, "answers");
    expect(adminAnswersAfter).toBe(adminAnswers);

    await ctx.close();
  });

  test("admin marks complete after visiting partner link — marks correct person", async ({ browser }) => {
    const ctx = await browser.newContext();
    const admin = await ctx.newPage();

    await admin.goto("/");
    await admin.getByText("Get started").click();
    await admin.getByText("All questions").click();
    await admin.getByText("Create group").click();
    await expect(admin).toHaveURL(/\/p\/.+/);

    await expect(admin.getByText("Set up your group")).toBeVisible();
    await admin.getByPlaceholder("Enter your name").fill("Alice");
    await admin.getByPlaceholder("Partner's name").fill("Bob");
    await admin.getByText("Create & get links").click();
    await expect(admin.getByText("You're all set")).toBeVisible({ timeout: 10000 });
    const bobLink = await admin.locator("input[readonly]").inputValue();

    // Set categories, THEN open Bob's link (the risky action order)
    await setCategories(admin, ["group"]);
    const bob = await ctx.newPage();
    await bob.goto(bobLink);
    await bob.close();

    // Back to admin — answer all and mark complete
    await admin.bringToFront();
    await admin.getByText("Start filling out").click();
    await goThroughIntro(admin);
    await answerAllQuestions(admin, "no");
    await admin.getByRole("button", { name: "I'm done" }).click();

    // Correct person (Alice) marked complete
    await expect(admin.getByText("Waiting for everyone")).toBeVisible({ timeout: 10000 });
    await expect(admin.getByText("Done")).toBeVisible();
    await expect(admin.getByText("In progress")).toBeVisible();

    await ctx.close();
  });

  test("both users answer in same browser — both can complete and see results", async ({ browser }) => {
    const ctx = await browser.newContext();
    const admin = await ctx.newPage();

    await admin.goto("/");
    await admin.getByText("Get started").click();
    await admin.getByText("All questions").click();
    await admin.getByText("Create group").click();
    await expect(admin).toHaveURL(/\/p\/.+/);

    await expect(admin.getByText("Set up your group")).toBeVisible();
    await admin.getByPlaceholder("Enter your name").fill("Alice");
    await admin.getByPlaceholder("Partner's name").fill("Bob");
    await admin.getByText("Create & get links").click();
    await expect(admin.getByText("You're all set")).toBeVisible({ timeout: 10000 });
    const bobLink = await admin.locator("input[readonly]").inputValue();

    // Alice answers and completes
    await setCategories(admin, ["group"]);
    await admin.getByText("Start filling out").click();
    await goThroughIntro(admin);
    await answerAllQuestions(admin, "yes");
    await admin.getByRole("button", { name: "I'm done" }).click();
    await expect(admin.getByText("Waiting for everyone")).toBeVisible({ timeout: 10000 });
    await expect(admin.getByText("Done")).toBeVisible({ timeout: 10000 });

    // Bob answers and completes in same browser
    const bob = await ctx.newPage();
    await bob.goto(bobLink);
    await setCategories(bob, ["group"]);
    await goThroughIntro(bob);
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done" }).click();

    // Bob should reach waiting or results
    await expect(
      bob.getByText("Your results").or(bob.getByText("Waiting for everyone")),
    ).toBeVisible({ timeout: 10000 });

    await ctx.close();
  });
});
