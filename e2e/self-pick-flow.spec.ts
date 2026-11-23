import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { answerAllQuestions, NAV_TIMEOUT, narrowToCategory, REALTIME_TIMEOUT } from "./helpers.js";

interface ProfileInput {
  name: string;
  anatomy: string | null;
}

/**
 * Click Continue on /anatomy and return the `groups.setProfile` input it sent.
 * The batch URL lists procedures (`/api/trpc/a,b`) and the body keys each
 * input by its index in that list.
 */
async function continueAndCaptureProfile(page: Page): Promise<ProfileInput> {
  const proceduresOf = (url: string) => new URL(url).pathname.replace(/^\/api\/trpc\//, "").split(",");
  const [req] = await Promise.all([
    page.waitForRequest((r) => r.method() === "POST" && proceduresOf(r.url()).includes("groups.setProfile")),
    page.getByRole("button", { name: "Continue", exact: true }).click(),
  ]);
  const body = JSON.parse(req.postData() ?? "{}") as Record<string, ProfileInput>;
  const input = body[String(proceduresOf(req.url()).indexOf("groups.setProfile"))];
  expect(input, "groups.setProfile input in batch body").toBeDefined();
  return input;
}

/**
 * Every profile field travels sealed, in the group's mode: ciphertext in an
 * encrypted group, `p:1:<json>` in a plaintext one, never a raw string.
 * /anatomy re-sends the (opened) name alongside the picked anatomy, so both
 * must be sealed again on the way out.
 */
function expectProfileOnWire(input: ProfileInput, encrypted: boolean, plain: ProfileInput) {
  if (encrypted) {
    expect(input.name).toMatch(/^e:1:/);
    expect(input.anatomy).toMatch(/^e:1:/);
  } else {
    expect(input).toEqual({
      name: `p:1:${JSON.stringify(plain.name)}`,
      anatomy: `p:1:${JSON.stringify(plain.anatomy)}`,
    });
  }
}

test.describe("filtered mode — self-pick anatomy flow", () => {
  for (const encrypted of [false, true]) {
    test(`both players pick anatomy, wait for each other, then answer [encrypted=${encrypted}]`, async ({
      alice,
      bob,
    }) => {
      // Admin creates filtered group with self-pick anatomy
      await alice.goto("/");
      await alice.getByRole("button", { name: "Get started", exact: true }).click();
      // Default is "Filter by body" — keep it
      // Switch "Who picks?" to "Each person"
      await alice.getByRole("radio", { name: "Each person", exact: true }).click();
      if (encrypted) {
        await alice.getByLabel("End-to-end encryption").check();
      }
      await alice.getByRole("button", { name: "Create group", exact: true }).click();
      await expect(alice).toHaveURL(/\/p\/.+/);

      // Admin setup — no anatomy pickers in self-pick mode
      await expect(alice.getByText("Set up your group")).toBeVisible({ timeout: NAV_TIMEOUT });
      await alice.getByPlaceholder("Enter your name").fill("Alice");
      await alice.getByPlaceholder("Partner's name").fill("Bob");
      await alice.getByRole("button", { name: "Create & get links", exact: true }).click();
      await expect(alice.getByText("You're all set")).toBeVisible();

      // Extract Bob's link
      const bobLink = await alice.locator('[data-testid="partner-link"]').inputValue();

      // Alice clicks "Start filling out" → should see anatomy picker (self-pick, her anatomy is null)
      await alice.getByRole("button", { name: "Start filling out", exact: true }).click();
      await expect(alice.getByText("One quick thing")).toBeVisible();
      await expect(alice.getByText("Pick your body type")).toBeVisible();

      // Alice picks anatomy
      await alice.getByRole("radio", { name: "Vulva", exact: true }).click();
      expectProfileOnWire(await continueAndCaptureProfile(alice), encrypted, { name: "Alice", anatomy: "afab" });

      // Alice should land on pending screen — waiting for Bob to pick anatomy
      await expect(alice.getByText("Almost there")).toBeVisible();
      await expect(alice.getByText("Waiting for everyone to finish setting up")).toBeVisible();
      await expect(alice.getByText("Setting up...")).toBeVisible();

      // Bob opens his link
      await bob.goto(bobLink);

      // Bob should see anatomy picker (self-pick, his anatomy is null)
      await expect(bob.getByText("One quick thing")).toBeVisible({ timeout: 2_000 });
      await bob.getByRole("radio", { name: "Penis", exact: true }).click();
      expectProfileOnWire(await continueAndCaptureProfile(bob), encrypted, { name: "Bob", anatomy: "amab" });

      // Bob should advance past pending (Alice already picked) → intro
      await expect(bob.getByText("Here's how it works")).toBeVisible();

      // SSE push delivers the group-ready broadcast → guard redirects to /intro
      await expect(alice.getByText("Here's how it works")).toBeVisible({ timeout: REALTIME_TIMEOUT });

      // Both go through intro → narrow via Summary UI → answer → complete
      await alice.getByRole("button", { name: "Let's go", exact: true }).click();
      await narrowToCategory(alice, "Group & External");
      await answerAllQuestions(alice, "yes");
      await alice.getByRole("button", { name: "I'm done", exact: true }).click();
      await expect(alice.getByText("Waiting for everyone")).toBeVisible();

      await bob.getByRole("button", { name: "Let's go", exact: true }).click();
      await narrowToCategory(bob, "Group & External");
      await answerAllQuestions(bob, "yes");
      await bob.getByRole("button", { name: "I'm done", exact: true }).click();

      // Both complete → Bob sees results. In the encrypted run this also
      // proves Alice's re-wrapped name still decrypts for her partner.
      await expect(bob.getByText("Your matches")).toBeVisible();
      await expect(bob.getByText("You & Alice")).toBeVisible();
    });
  }
});
