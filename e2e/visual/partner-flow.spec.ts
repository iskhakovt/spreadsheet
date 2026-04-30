import { expect, test } from "../fixtures.js";
import { answerAllQuestions, goThroughIntro, narrowToCategory, personBase } from "../helpers.js";

test.describe("non-admin partner flow", () => {
  test("waiting (non-admin) — no group members button", async ({ alice, bob }) => {
    // Create a group in all-questions mode
    await alice.goto("/");
    await alice.getByRole("button", { name: "Get started", exact: true }).click();
    await alice.getByRole("radio", { name: "All questions", exact: true }).click();
    await alice.getByRole("button", { name: "Create group", exact: true }).click();
    await expect(alice).toHaveURL(/\/p\/.+/);

    await alice.getByPlaceholder("Enter your name").fill("Alice");
    await alice.getByPlaceholder("Partner's name").fill("Bob");
    await alice.getByRole("button", { name: "Create & get links", exact: true }).click();
    await expect(alice.getByText("You're all set")).toBeVisible();
    const partnerLink = await alice.locator('[data-testid="partner-link"]').inputValue();

    // Bob opens link → goes straight to intro (name already set by admin)
    await bob.goto(partnerLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Group & External");
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done", exact: true }).click();

    // --- Waiting screen (non-admin) — no "View group members" button ---
    await expect(bob.getByText("Waiting for everyone")).toBeVisible();
    await expect(bob.getByRole("button", { name: "View group members", exact: true })).toHaveCount(0);
    await expect(bob).toHaveScreenshot("waiting-non-admin.png");
  });

  test("self-pick anatomy flow — pending and pick screens", async ({ alice, bob }) => {
    // Create filtered-mode group where each person picks their own anatomy
    await alice.goto("/");
    await alice.getByRole("button", { name: "Get started", exact: true }).click();
    await alice.getByRole("radio", { name: "Each person", exact: true }).click();
    await alice.getByRole("button", { name: "Create group", exact: true }).click();
    await expect(alice).toHaveURL(/\/p\/.+/);

    // Setup without anatomy (self-pick mode)
    await alice.getByPlaceholder("Enter your name").fill("Alice");
    await alice.getByPlaceholder("Partner's name").fill("Bob");
    await alice.getByRole("button", { name: "Create & get links", exact: true }).click();
    await expect(alice.getByText("You're all set")).toBeVisible();
    const partnerLink = await alice.locator('[data-testid="partner-link"]').inputValue();

    // Alice starts → picks own anatomy
    await alice.getByRole("button", { name: "Start filling out", exact: true }).click();
    await expect(alice.getByText("One quick thing")).toBeVisible();
    await expect(alice).toHaveScreenshot("pick-anatomy.png");

    // Expand to show all 4 anatomy types
    await alice.getByRole("button", { name: "Show more options", exact: true }).click();
    await expect(alice).toHaveScreenshot("pick-anatomy-expanded.png");

    // Alice picks anatomy → lands on pending (waiting for Bob to pick)
    await alice.getByRole("radio", { name: "Vulva", exact: true }).click();
    await alice.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(alice.getByText("Almost there")).toBeVisible();
    await expect(alice).toHaveScreenshot("pending-waiting-anatomy.png");

    // Bob opens link → anatomy pick screen
    await bob.goto(partnerLink);
    await expect(bob.getByText("One quick thing")).toBeVisible();
    await expect(bob).toHaveScreenshot("pick-anatomy-partner.png");
  });

  // Regression test for a dead "Add person" button: the client used to render
  // it whenever the computed isReady was false (some partner's anatomy was
  // still pending), but the server's addPerson rejects with "Can't add people
  // after group is marked ready" once setupAdmin has run. Now Group.tsx
  // branches on isAdminReady (server-truth), so admin returning to /group
  // mid-flow sees "Your group" + the primary CTA, not the dead button.
  test("group screen — no dead Add Person button while waiting for partner anatomy", async ({ alice }) => {
    // Inline setup (not createGroupAndSetup) — this test needs filtered
    // mode + self-pick anatomy + a 3rd partner, which the helper doesn't
    // expose. Once Alice picks her own anatomy, the partners' anatomy
    // remains null, putting the client in the !isReady && isAdminReady
    // window the regression depends on.
    await alice.goto("/");
    await alice.getByRole("button", { name: "Get started", exact: true }).click();
    await alice.getByRole("radio", { name: "Each person", exact: true }).click();
    await alice.getByRole("button", { name: "Create group", exact: true }).click();
    await expect(alice).toHaveURL(/\/p\/.+/);

    await alice.getByPlaceholder("Enter your name").fill("Alice");
    await alice.getByPlaceholder("Partner's name").first().fill("Bob");
    await alice.getByRole("button", { name: "+ Add another person", exact: true }).click();
    await alice.getByPlaceholder("Partner's name").last().fill("Carol");
    await alice.getByRole("button", { name: "Create & get links", exact: true }).click();
    await expect(alice.getByText("You're all set")).toBeVisible();

    // Alice picks her own anatomy so she clears the /anatomy guard.
    await alice.getByRole("button", { name: "Start filling out", exact: true }).click();
    await expect(alice.getByText("One quick thing")).toBeVisible();
    await alice.getByRole("radio", { name: "Vulva", exact: true }).click();
    await alice.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(alice.getByText("Almost there")).toBeVisible();

    // Bob and Carol haven't picked yet → client isReady=false but server-side
    // isAdminReady=true. /group is a free route, so admin can navigate there.
    const base = personBase(alice.url());
    await alice.goto(base + "/group");

    // Title is "Your group" (server-finalized), not "Invite your partner(s)".
    await expect(alice.getByRole("heading", { name: "Your group" })).toBeVisible();
    // No dead "Add person" button — server would reject the mutation.
    await expect(alice.getByRole("button", { name: "Add person", exact: true })).toHaveCount(0);
    // Primary CTA is visible (Continue, since Alice has answered nothing yet).
    await expect(alice.getByRole("button", { name: "Start filling out", exact: true })).toBeVisible();

    await expect(alice).toHaveScreenshot("group-isAdminReady-waiting-anatomy.png");
  });
});
