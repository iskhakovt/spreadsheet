import { expect, test } from "./fixtures.js";
import { answerAllQuestions, createGroupAndSetup, goThroughIntro, setCategories } from "./helpers.js";

for (const encrypted of [false, true]) {
  test.describe(`two-player completion flow (${encrypted ? "encrypted" : "plaintext"})`, () => {
    test("Alice and Bob both complete and see results", async ({ browser }) => {
      const aliceCtx = await browser.newContext();
      const alice = await aliceCtx.newPage();

      const { partnerLink } = await createGroupAndSetup(alice, { encrypted });

      if (encrypted) {
        expect(alice.url()).toContain("#key=");
        expect(partnerLink).toContain("#key=");
      }

      // Alice: set single category → intro → answer all → done
      await setCategories(alice, ["group"]);
      await alice.getByText("Start filling out").click();
      await goThroughIntro(alice);
      await answerAllQuestions(alice, "yes");
      await alice.getByRole("button", { name: "I'm done" }).click();
      await expect(alice.getByText("Waiting for everyone")).toBeVisible();
      // Ensure Alice sees herself as "Done" before Bob starts
      await expect(alice.getByText("Done")).toBeVisible();

      // Bob: open link → set same category → intro → answer all → done
      const bobCtx = await browser.newContext();
      const bob = await bobCtx.newPage();
      await bob.goto(partnerLink);
      await setCategories(bob, ["group"]);
      await goThroughIntro(bob);
      await answerAllQuestions(bob, "yes");
      await bob.getByRole("button", { name: "I'm done" }).click();

      // Both complete → Bob goes straight to results
      await expect(bob.getByText("Your results")).toBeVisible();
      await expect(bob.getByText("Alice & Bob")).toBeVisible();
      await expect(bob.getByText("Go for it").first()).toBeVisible();

      // Alice's 5s fast poll on /waiting picks up allComplete → guard redirects to /results
      await expect(alice.getByText("Your results")).toBeVisible({ timeout: 15000 });
      await expect(alice.getByText("Alice & Bob")).toBeVisible();

      await aliceCtx.close();
      await bobCtx.close();
    });
  });
}
