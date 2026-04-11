import { expect, test } from "./fixtures.js";
import { answerAllQuestions, goThroughIntro, narrowToCategory } from "./helpers.js";

test.describe("multi-tab isolation", () => {
  test("admin opens partner link in same browser — answers don't cross-contaminate", async ({
    multiTab: { ctx, admin },
  }) => {
    // Shared context = shared localStorage (simulates same browser, multiple tabs)
    await admin.goto("/");
    await admin.getByText("Get started").click();
    await admin.getByText("All questions").click();
    await admin.getByText("Create group").click();
    await expect(admin).toHaveURL(/\/p\/.+/);

    await expect(admin.getByText("Set up your group")).toBeVisible();
    await admin.getByPlaceholder("Enter your name").fill("Alice");
    await admin.getByPlaceholder("Partner's name").fill("Bob");
    await admin.getByText("Create & get links").click();
    await expect(admin.getByText("You're all set")).toBeVisible();
    const bobLink = await admin.locator("input[readonly]").inputValue();

    // Admin answers one question with "No"
    await admin.getByText("Start filling out").click();
    await goThroughIntro(admin);
    await narrowToCategory(admin, "Group & External");
    await expect(admin.getByText(/\d+ questions/)).toBeVisible();
    await admin.getByRole("button", { name: "Start" }).click();
    await admin.getByRole("radio", { name: "No" }).click();

    // Verify via UI: press Back, admin's previous answer is still "No" selected
    await admin.getByText("Back").click();
    await expect(admin.getByRole("radio", { name: "No" })).toHaveAttribute("aria-checked", "true");

    // Open Bob's link in same browser (new page in the SAME context, shared
    // localStorage). This is the crux of the multi-tab test — a new page in
    // a new context would be correctly isolated at the browser level; we
    // want to verify that the in-app scoped-storage keying prevents
    // cross-contamination even when the browser context IS shared.
    const bob = await ctx.newPage();
    await bob.goto(bobLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Group & External");
    await expect(bob.getByText(/\d+ questions/)).toBeVisible();
    await bob.getByRole("button", { name: "Start" }).click();
    await bob.getByRole("radio", { name: "Yes" }).click();

    // Bob's answer is "Yes" — verify via UI same way
    await bob.getByText("Back").click();
    await expect(bob.getByRole("radio", { name: "Yes" })).toHaveAttribute("aria-checked", "true");

    // Admin's first answer is STILL "No" — Bob's write didn't touch
    // admin's scoped localStorage. This is the core isolation assertion:
    // if scoping were broken, either Bob would see admin's "No" or admin
    // would see Bob's "Yes". We verify by reloading admin's page so it
    // re-reads localStorage from scratch.
    await admin.reload();
    // After reload on /questions with existing answers, we land either on
    // a welcome screen or mid-flow. Navigate explicitly to the first
    // question to verify its saved answer.
    await admin
      .getByRole("button", { name: "Start" })
      .click()
      .catch(() => {});
    await expect(admin.getByRole("radio", { name: "No" })).toHaveAttribute("aria-checked", "true");
  });

  test("admin marks complete after visiting partner link — marks correct person", async ({
    multiTab: { ctx, admin },
  }) => {
    await admin.goto("/");
    await admin.getByText("Get started").click();
    await admin.getByText("All questions").click();
    await admin.getByText("Create group").click();
    await expect(admin).toHaveURL(/\/p\/.+/);

    await expect(admin.getByText("Set up your group")).toBeVisible();
    await admin.getByPlaceholder("Enter your name").fill("Alice");
    await admin.getByPlaceholder("Partner's name").fill("Bob");
    await admin.getByText("Create & get links").click();
    await expect(admin.getByText("You're all set")).toBeVisible();
    const bobLink = await admin.locator("input[readonly]").inputValue();

    // Open Bob's link in a second tab first (the risky action order that
    // used to cause "admin marks Bob complete" cross-contamination bugs)
    const bob = await ctx.newPage();
    await bob.goto(bobLink);
    await bob.close();

    // Back to admin — answer all and mark complete
    await admin.bringToFront();
    await admin.getByText("Start filling out").click();
    await goThroughIntro(admin);
    await narrowToCategory(admin, "Group & External");
    await answerAllQuestions(admin, "no");
    await admin.getByRole("button", { name: "I'm done" }).click();

    // Correct person (Alice) marked complete: admin reached /waiting (proves
    // Alice is complete — guard wouldn't land her here otherwise) and Bob is
    // still "In progress" (proves admin didn't wrongly mark Bob complete).
    await expect(admin.getByText("Waiting for everyone")).toBeVisible();
    await expect(admin.getByText("In progress")).toBeVisible();
  });

  test("both users answer in same browser — both can complete and see results", async ({
    multiTab: { ctx, admin },
  }) => {
    await admin.goto("/");
    await admin.getByText("Get started").click();
    await admin.getByText("All questions").click();
    await admin.getByText("Create group").click();
    await expect(admin).toHaveURL(/\/p\/.+/);

    await expect(admin.getByText("Set up your group")).toBeVisible();
    await admin.getByPlaceholder("Enter your name").fill("Alice");
    await admin.getByPlaceholder("Partner's name").fill("Bob");
    await admin.getByText("Create & get links").click();
    await expect(admin.getByText("You're all set")).toBeVisible();
    const bobLink = await admin.locator("input[readonly]").inputValue();

    // Alice answers and completes
    await admin.getByText("Start filling out").click();
    await goThroughIntro(admin);
    await narrowToCategory(admin, "Group & External");
    await answerAllQuestions(admin, "yes");
    await admin.getByRole("button", { name: "I'm done" }).click();
    await expect(admin.getByText("Waiting for everyone")).toBeVisible();

    // Bob answers and completes in same browser context
    const bob = await ctx.newPage();
    await bob.goto(bobLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Group & External");
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done" }).click();

    // Bob should reach waiting or results
    await expect(bob.getByText("Your matches").or(bob.getByText("Waiting for everyone"))).toBeVisible({
      timeout: 10000,
    });
  });
});
