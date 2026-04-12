import { expect, test } from "../fixtures.js";
import { answerAllQuestions, goThroughIntro, narrowToCategory } from "../helpers.js";

test.describe("non-admin partner flow", () => {
  test("waiting (non-admin) — no group members button", async ({ alice, bob }) => {
    // Create a group in all-questions mode
    await alice.goto("/");
    await alice.getByText("Get started").click();
    await alice.getByText("All questions").click();
    await alice.getByText("Create group").click();
    await expect(alice).toHaveURL(/\/p\/.+/);

    await alice.getByPlaceholder("Enter your name").fill("Alice");
    await alice.getByPlaceholder("Partner's name").fill("Bob");
    await alice.getByText("Create & get links").click();
    await expect(alice.getByText("You're all set")).toBeVisible();
    const partnerLink = await alice.locator("input[readonly]").inputValue();

    // Bob opens link → goes straight to intro (name already set by admin)
    await bob.goto(partnerLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Group & External");
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done" }).click();

    // --- Waiting screen (non-admin) — no "View group members" button ---
    await expect(bob.getByText("Waiting for everyone")).toBeVisible();
    await expect(bob.getByText("View group members")).not.toBeVisible();
    await expect(bob).toHaveScreenshot("waiting-non-admin.png");
  });

  test("self-pick anatomy flow — pending and pick screens", async ({ alice, bob }) => {
    // Create filtered-mode group where each person picks their own anatomy
    await alice.goto("/");
    await alice.getByText("Get started").click();
    await alice.getByText("Each person").click();
    await alice.getByText("Create group").click();
    await expect(alice).toHaveURL(/\/p\/.+/);

    // Setup without anatomy (self-pick mode)
    await alice.getByPlaceholder("Enter your name").fill("Alice");
    await alice.getByPlaceholder("Partner's name").fill("Bob");
    await alice.getByText("Create & get links").click();
    await expect(alice.getByText("You're all set")).toBeVisible();
    const partnerLink = await alice.locator("input[readonly]").inputValue();

    // Alice starts → picks own anatomy
    await alice.getByText("Start filling out").click();
    await expect(alice.getByText("One quick thing")).toBeVisible();
    await expect(alice).toHaveScreenshot("pick-anatomy.png");

    // Expand to show all 4 anatomy types
    await alice.getByText("Show more options").click();
    await expect(alice).toHaveScreenshot("pick-anatomy-expanded.png");

    // Alice picks anatomy → lands on pending (waiting for Bob to pick)
    await alice.getByRole("radio", { name: "Vulva" }).click();
    await alice.getByRole("button", { name: "Continue" }).click();
    await expect(alice.getByText("Almost there")).toBeVisible();
    await expect(alice).toHaveScreenshot("pending-waiting-anatomy.png");

    // Bob opens link → anatomy pick screen
    await bob.goto(partnerLink);
    await expect(bob.getByText("One quick thing")).toBeVisible();
    await expect(bob).toHaveScreenshot("pick-anatomy-partner.png");
  });
});
