import { expect, test } from "./fixtures.js";
import { answerAllQuestions, narrowToCategory } from "./helpers.js";

test.describe("filtered mode — self-pick anatomy flow", () => {
  test("both players pick anatomy, wait for each other, then answer", async ({ alice, bob }) => {
    // Admin creates filtered group with self-pick anatomy
    await alice.goto("/");
    await alice.getByText("Get started").click();
    // Default is "Filter by body" — keep it
    // Switch "Who picks?" to "Each person"
    await alice.getByText("Each person").click();
    await alice.getByText("Create group").click();
    await expect(alice).toHaveURL(/\/p\/.+/);

    // Admin setup — no anatomy pickers in self-pick mode
    await expect(alice.getByText("Set up your group")).toBeVisible();
    await alice.getByPlaceholder("Enter your name").fill("Alice");
    await alice.getByPlaceholder("Partner's name").fill("Bob");
    await alice.getByText("Create & get links").click();
    await expect(alice.getByText("You're all set")).toBeVisible();

    // Extract Bob's link
    const bobLink = await alice.locator('[data-testid="partner-link"]').inputValue();

    // Alice clicks "Start filling out" → should see anatomy picker (self-pick, her anatomy is null)
    await alice.getByText("Start filling out").click();
    await expect(alice.getByText("One quick thing")).toBeVisible();
    await expect(alice.getByText("Pick your body type")).toBeVisible();

    // Alice picks anatomy
    await alice.getByRole("radio", { name: "Vulva", exact: true }).click();
    await alice.getByRole("button", { name: "Continue", exact: true }).click();

    // Alice should land on pending screen — waiting for Bob to pick anatomy
    await expect(alice.getByText("Almost there")).toBeVisible();
    await expect(alice.getByText("Waiting for everyone to finish setting up")).toBeVisible();
    await expect(alice.getByText("Setting up...")).toBeVisible();

    // Bob opens his link
    await bob.goto(bobLink);

    // Bob should see anatomy picker (self-pick, his anatomy is null)
    await expect(bob.getByText("One quick thing")).toBeVisible();
    await bob.getByRole("radio", { name: "Penis", exact: true }).click();
    await bob.getByRole("button", { name: "Continue", exact: true }).click();

    // Bob should advance past pending (Alice already picked) → intro
    await expect(bob.getByText("Here's how it works")).toBeVisible();

    // WS push delivers the group-ready broadcast → guard redirects to /intro
    await expect(alice.getByText("Here's how it works")).toBeVisible({ timeout: 5000 });

    // Both go through intro → narrow via Summary UI → answer → complete
    await alice.getByText("Let's go").click();
    await narrowToCategory(alice, "Group & External");
    await answerAllQuestions(alice, "yes");
    await alice.getByRole("button", { name: "I'm done", exact: true }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();

    await bob.getByText("Let's go").click();
    await narrowToCategory(bob, "Group & External");
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done", exact: true }).click();

    // Both complete → Bob sees results
    await expect(bob.getByText("Your matches")).toBeVisible();
    await expect(bob.getByText("You & Alice")).toBeVisible();
  });
});
