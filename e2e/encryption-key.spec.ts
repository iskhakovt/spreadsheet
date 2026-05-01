import { expect, test } from "./fixtures.js";
import {
  answerAllQuestions,
  createGroupAndSetup,
  goThroughIntro,
  NAV_TIMEOUT,
  narrowToCategory,
  personBase,
  WS_TIMEOUT,
} from "./helpers.js";

test.describe("missing encryption key", () => {
  test("shows error when opening encrypted group without #key=", async ({ alice, bob }) => {
    const { partnerLink } = await createGroupAndSetup(alice, { encrypted: true });

    // Strip the #key= fragment from the partner link
    const linkWithoutKey = partnerLink.replace(/#key=.*$/, "");
    expect(linkWithoutKey).not.toContain("#key=");

    await bob.goto(linkWithoutKey);
    // MissingKeyError has retry: false — the screen should appear without retry delay
    await expect(bob.getByText("Encryption key missing")).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(bob.getByText("the key wasn't included in your link")).toBeVisible();
  });

  test("works normally when encryption key is present", async ({ alice, bob }) => {
    const { partnerLink } = await createGroupAndSetup(alice, { encrypted: true });
    expect(partnerLink).toContain("#key=");

    await bob.goto(partnerLink);
    // Bob should see the intro, not an error
    await expect(bob.getByText("Here's how it works")).toBeVisible({ timeout: 2_000 });
  });
});

test.describe("copy my link button", () => {
  test("visible on encrypted group idle screens", async ({ alice, bob }) => {
    const { partnerLink } = await createGroupAndSetup(alice, { encrypted: true });

    // Alice: fill out and mark complete → waiting screen
    await alice.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Group & External");
    await answerAllQuestions(alice, "yes");
    await alice.getByRole("button", { name: "I'm done", exact: true }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();
    await expect(alice.getByText("Copy my link")).toBeVisible();

    // Alice: navigate to group screen (free route)
    await alice.getByRole("button", { name: "View group members", exact: true }).click();
    await expect(alice.getByText("Your group")).toBeVisible();
    await expect(alice.getByText("Copy my link")).toBeVisible();

    // Navigate Alice back to /waiting so the guard can redirect to /results
    const base = personBase(alice.url());
    await alice.goto(base + "/waiting");

    // Bob: fill out and mark complete
    await bob.goto(partnerLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Group & External");
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done", exact: true }).click();

    // Both complete → results screen
    await expect(bob.getByText("Your matches")).toBeVisible({ timeout: WS_TIMEOUT });
    await expect(bob.getByText("Copy my link")).toBeVisible();

    await expect(alice.getByText("Your matches")).toBeVisible({ timeout: WS_TIMEOUT });
    await expect(alice.getByText("Copy my link")).toBeVisible();
  });

  test("not visible on non-encrypted group", async ({ alice }) => {
    await createGroupAndSetup(alice, { encrypted: false });

    // Alice: fill out and mark complete → waiting screen
    await alice.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Group & External");
    await answerAllQuestions(alice, "yes");
    await alice.getByRole("button", { name: "I'm done", exact: true }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();
    await expect(alice.getByText("Copy my link")).toHaveCount(0);
  });
});

test.describe("admin own link on setup completion", () => {
  test("shows admin link with copy button and an embedded key", async ({ page }) => {
    await createGroupAndSetup(page, { encrypted: true });
    await expect(page.getByText("Your link", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Copy your link")).toBeVisible();
    const adminLink = await page.getByLabel("Your invite link").inputValue();
    expect(adminLink).toContain("#key=");
  });
});
