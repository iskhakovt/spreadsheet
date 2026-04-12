import { expect, test } from "./fixtures.js";
import { createGroupAndSetup } from "./helpers.js";

test.describe("invite claim flow", () => {
  for (const encrypted of [false, true]) {
    test.describe(`(${encrypted ? "encrypted" : "plaintext"})`, () => {
      test("partner claim redirects from /join/ to /p/", async ({ alice, bob }) => {
        const { partnerLink } = await createGroupAndSetup(alice, { encrypted });

        // Partner link should point to /join/
        expect(partnerLink).toMatch(/\/join\//);
        if (encrypted) {
          expect(partnerLink).toContain("#key=");
        }

        // Bob opens the invite link — claim + redirect should land on /p/
        await bob.goto(partnerLink);
        await expect(bob).toHaveURL(/\/p\/[^/]+/);

        // The URL token should differ from the invite token (auth token, not invite)
        const inviteToken = partnerLink.match(/\/join\/([^/#?]+)/)![1];
        const authToken = bob.url().match(/\/p\/([^/#?]+)/)![1];
        expect(authToken).not.toBe(inviteToken);

        // Encrypted groups preserve the key fragment through the redirect
        if (encrypted) {
          expect(bob.url()).toContain("#key=");
        }

        // Bob should see the intro (normal post-claim flow)
        await expect(bob.getByText("Here's how it works")).toBeVisible();
      });

      test("already-claimed invite shows error screen", async ({ alice, bob, carol }) => {
        const { partnerLink } = await createGroupAndSetup(alice, { encrypted });

        // Bob claims the invite link first
        await bob.goto(partnerLink);
        await expect(bob).toHaveURL(/\/p\//);
        await expect(bob.getByText("Here's how it works")).toBeVisible();

        // Carol tries the same invite link in a different browser — should see error
        await carol.goto(partnerLink);
        await expect(carol.getByText("Link already activated")).toBeVisible();
        await expect(
          carol.getByText("This invite link has already been opened in another browser"),
        ).toBeVisible();
      });
    });
  }

  test("re-visiting /join/ after claim uses cached auth token", async ({ alice, bob }) => {
    const { partnerLink } = await createGroupAndSetup(alice);

    // Bob claims the invite
    await bob.goto(partnerLink);
    await expect(bob).toHaveURL(/\/p\//);
    const firstUrl = bob.url();

    // Bob navigates to the invite link again (same browser context = same localStorage)
    await bob.goto(partnerLink);
    await expect(bob).toHaveURL(/\/p\//);

    // Should land on the same auth token URL (cached, no re-claim)
    const authToken1 = firstUrl.match(/\/p\/([^/#?]+)/)![1];
    const authToken2 = bob.url().match(/\/p\/([^/#?]+)/)![1];
    expect(authToken2).toBe(authToken1);
  });

  test("admin Start filling out redirects to /p/ with auth token", async ({ alice }) => {
    await createGroupAndSetup(alice);

    // After setup, admin clicks "Start filling out" — should redirect to /p/:authToken
    await alice.getByText("Start filling out").click();
    await expect(alice).toHaveURL(/\/p\//);

    // Admin should see the intro
    await expect(alice.getByText("Here's how it works")).toBeVisible();
  });
});
