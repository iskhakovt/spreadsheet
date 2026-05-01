import { expect, test } from "./fixtures.js";
import {
  answerAllQuestions,
  goThroughIntro,
  NAV_TIMEOUT,
  narrowToCategory,
  personBase,
  WS_TIMEOUT,
} from "./helpers.js";

test.describe("multi-tab isolation", () => {
  test("admin opens partner link in same browser — answers don't cross-contaminate", async ({
    multiTab: { ctx, admin },
  }) => {
    // Shared context = shared localStorage (simulates same browser, multiple tabs)
    await admin.goto("/");
    await admin.getByRole("button", { name: "Get started", exact: true }).click();
    await admin.getByRole("radio", { name: "All questions", exact: true }).click();
    await admin.getByRole("button", { name: "Create group", exact: true }).click();
    await expect(admin).toHaveURL(/\/p\/.+/);

    await expect(admin.getByText("Set up your group")).toBeVisible({ timeout: NAV_TIMEOUT });
    await admin.getByPlaceholder("Enter your name").fill("Alice");
    await admin.getByPlaceholder("Partner's name").fill("Bob");
    await admin.getByRole("button", { name: "Create & get links", exact: true }).click();
    await expect(admin.getByText("You're all set")).toBeVisible({ timeout: NAV_TIMEOUT });
    const bobLink = await admin.locator('[data-testid="partner-link"]').inputValue();

    // Admin answers one question with "No"
    await admin.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(admin);
    await narrowToCategory(admin, "Aftercare");
    await expect(admin.getByText(/\d+ questions/)).toBeVisible();
    await admin.getByRole("button", { name: "Start", exact: true }).click();
    await admin.getByRole("radio", { name: "No", exact: true }).click();

    // Verify via UI: press Back, admin's previous answer is still "No" selected
    await admin.getByRole("button", { name: "Previous question", exact: true }).click();
    await expect(admin.getByRole("radio", { name: "No", exact: true })).toHaveAttribute("aria-checked", "true");

    // Open Bob's link in same browser (new page in the SAME context, shared
    // localStorage). This is the crux of the multi-tab test — a new page in
    // a new context would be correctly isolated at the browser level; we
    // want to verify that the in-app scoped-storage keying prevents
    // cross-contamination even when the browser context IS shared.
    const bob = await ctx.newPage();
    await bob.goto(bobLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Aftercare");
    await expect(bob.getByText(/\d+ questions/)).toBeVisible();
    await bob.getByRole("button", { name: "Start", exact: true }).click();
    await bob.getByRole("radio", { name: "Yes", exact: true }).click();

    // Bob's answer is "Yes" — verify via UI same way
    await bob.getByRole("button", { name: "Previous question", exact: true }).click();
    await expect(bob.getByRole("radio", { name: "Yes", exact: true })).toHaveAttribute("aria-checked", "true");

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
      .getByRole("button", { name: "Start", exact: true })
      .click()
      .catch(() => {});
    await expect(admin.getByRole("radio", { name: "No", exact: true })).toHaveAttribute("aria-checked", "true");
  });

  test("admin marks complete after visiting partner link — marks correct person", async ({
    multiTab: { ctx, admin },
  }) => {
    await admin.goto("/");
    await admin.getByRole("button", { name: "Get started", exact: true }).click();
    await admin.getByRole("radio", { name: "All questions", exact: true }).click();
    await admin.getByRole("button", { name: "Create group", exact: true }).click();
    await expect(admin).toHaveURL(/\/p\/.+/);

    await expect(admin.getByText("Set up your group")).toBeVisible({ timeout: NAV_TIMEOUT });
    await admin.getByPlaceholder("Enter your name").fill("Alice");
    await admin.getByPlaceholder("Partner's name").fill("Bob");
    await admin.getByRole("button", { name: "Create & get links", exact: true }).click();
    await expect(admin.getByText("You're all set")).toBeVisible({ timeout: NAV_TIMEOUT });
    const bobLink = await admin.locator('[data-testid="partner-link"]').inputValue();

    // Open Bob's link in a second tab first (the risky action order that
    // used to cause "admin marks Bob complete" cross-contamination bugs)
    const bob = await ctx.newPage();
    await bob.goto(bobLink);
    await bob.close();

    // Back to admin — answer all and mark complete
    await admin.bringToFront();
    await admin.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(admin);
    await narrowToCategory(admin, "Aftercare");
    await answerAllQuestions(admin, "no");
    await admin.getByRole("button", { name: "I'm done", exact: true }).click();

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
    await admin.getByRole("button", { name: "Get started", exact: true }).click();
    await admin.getByRole("radio", { name: "All questions", exact: true }).click();
    await admin.getByRole("button", { name: "Create group", exact: true }).click();
    await expect(admin).toHaveURL(/\/p\/.+/);

    await expect(admin.getByText("Set up your group")).toBeVisible({ timeout: NAV_TIMEOUT });
    await admin.getByPlaceholder("Enter your name").fill("Alice");
    await admin.getByPlaceholder("Partner's name").fill("Bob");
    await admin.getByRole("button", { name: "Create & get links", exact: true }).click();
    await expect(admin.getByText("You're all set")).toBeVisible({ timeout: NAV_TIMEOUT });
    const bobLink = await admin.locator('[data-testid="partner-link"]').inputValue();

    // Alice answers and completes
    await admin.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(admin);
    await narrowToCategory(admin, "Aftercare");
    await answerAllQuestions(admin, "yes");
    await admin.getByRole("button", { name: "I'm done", exact: true }).click();
    await expect(admin.getByText("Waiting for everyone")).toBeVisible();

    // Bob answers and completes in same browser context
    const bob = await ctx.newPage();
    await bob.goto(bobLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Aftercare");
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done", exact: true }).click();

    // Bob should reach waiting or results
    await expect(bob.getByText("Your matches").or(bob.getByText("Waiting for everyone"))).toBeVisible({
      timeout: WS_TIMEOUT,
    });
  });

  test("cross-tab reactive: write in tab A updates tab B's Summary via the storage event", async ({
    multiTab: { ctx, admin },
  }) => {
    // Two tabs of the SAME person (same token, shared context → shared
    // localStorage). An answer committed in tab A should flow to tab B's
    // Summary without a reload, driven by the native `storage` event that
    // useAnswers/useSyncExternalStore subscribes to.
    await admin.goto("/");
    await admin.getByRole("button", { name: "Get started", exact: true }).click();
    await admin.getByRole("radio", { name: "All questions", exact: true }).click();
    await admin.getByRole("button", { name: "Create group", exact: true }).click();
    await expect(admin.getByText("Set up your group")).toBeVisible({ timeout: NAV_TIMEOUT });
    await admin.getByPlaceholder("Enter your name").fill("Alice");
    await admin.getByPlaceholder("Partner's name").fill("Bob");
    await admin.getByRole("button", { name: "Create & get links", exact: true }).click();
    await expect(admin.getByText("You're all set")).toBeVisible({ timeout: NAV_TIMEOUT });

    await admin.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(admin);
    await narrowToCategory(admin, "Foundations");

    // Open tab B to the same user's Summary.
    const base = personBase(admin.url());
    const tabB = await ctx.newPage();
    await tabB.goto(base + "/summary");
    await expect(tabB.getByText(/0 of \d+ answered/)).toBeVisible({ timeout: NAV_TIMEOUT });

    // Commit an answer in tab A.
    await admin.getByRole("button", { name: "Start", exact: true }).click();
    await admin.getByRole("radio", { name: "No", exact: true }).click();

    // Tab B reactively reflects the new count — no reload.
    await expect(tabB.getByText(/1 of \d+ answered/)).toBeVisible();
  });
});
