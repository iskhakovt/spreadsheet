import { expect, test } from "./fixtures.js";
import { answerAllQuestions, createGroupAndSetup, goThroughIntro, narrowToCategory } from "./helpers.js";

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

      // Alice: full journey — start, intro, narrow via Summary UI, answer, done
      await alice.getByText("Start filling out").click();
      await goThroughIntro(alice);
      await narrowToCategory(alice, "Group & External");
      await answerAllQuestions(alice, "yes");
      await alice.getByRole("button", { name: "I'm done" }).click();
      await expect(alice.getByText("Waiting for everyone")).toBeVisible();
      // Ensure Alice sees herself as "Done" before Bob starts
      await expect(alice.getByText("Done")).toBeVisible();

      // Bob: open link → intro → narrow via Summary → answer → done
      const bobCtx = await browser.newContext();
      const bob = await bobCtx.newPage();
      await bob.goto(partnerLink);
      await goThroughIntro(bob);
      await narrowToCategory(bob, "Group & External");
      await answerAllQuestions(bob, "yes");
      await bob.getByRole("button", { name: "I'm done" }).click();

      // Both complete → Bob goes straight to results
      await expect(bob.getByText("Your results")).toBeVisible({ timeout: 5000 });
      await expect(bob.getByText("Alice & Bob")).toBeVisible({ timeout: 5000 });
      await expect(bob.getByText("Match").first()).toBeVisible();

      // WS push delivers Bob's completion to Alice → guard redirects to /results
      await expect(alice.getByText("Your results")).toBeVisible({ timeout: 5000 });
      await expect(alice.getByText("Alice & Bob")).toBeVisible({ timeout: 5000 });

      await aliceCtx.close();
      await bobCtx.close();
    });
  });
}
