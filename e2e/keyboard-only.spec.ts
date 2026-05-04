import { expect, test } from "./fixtures.js";
import { createGroupAndSetup, goThroughIntro, narrowToCategory } from "./helpers.js";

test.describe("keyboard-only completion", () => {
  test("answer an entire category with 1-5 keys + Enter — no mouse", async ({ page }) => {
    // Catches focus-trap regressions and verifies the window-scoped keyboard
    // listener on RatingGroup stays alive across re-mounts. Setup goes
    // through the UI mouse flow because that's not what we're testing;
    // the question loop below is keyboard-only.
    await createGroupAndSetup(page);
    await page.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(page);
    await narrowToCategory(page, "Aftercare");
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Cycle through ratings: 1=yes, 2=if-partner-wants, 3=maybe, 4=fantasy, 5=no.
    const ratingCycle = ["1", "2", "3", "4", "5"];
    let i = 0;
    const done = page.getByText("All done!").or(page.getByText("That's the last one"));
    for (let guard = 0; guard < 200; guard++) {
      if (await done.isVisible({ timeout: 100 }).catch(() => false)) break;

      // Capture the current heading so we can wait for navigation to
      // complete before pressing the next rating — without this the loop
      // races the commit-animation and the second keypress is dropped by
      // the `if (committing) return` guard in RatingGroup.
      const beforeHeading = await page
        .locator("h2")
        .first()
        .textContent()
        .catch(() => null);

      // notePrompt cards have a textarea; we'd hijack-commit a rating into
      // the textarea if we sent the keystroke while it was focused. Move
      // focus off any input to the body.
      await page.locator("body").focus();

      const ratingKey = ratingCycle[i % ratingCycle.length];
      i++;
      await page.keyboard.press(ratingKey);

      // notePrompt question may leave us on Layout B. Focus the primary
      // Next button and press Enter — this exercises the keyboard
      // activation path on <Button> too.
      const nextBtn = page.getByTestId("note-next");
      if (await nextBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        if (await nextBtn.isEnabled()) {
          await nextBtn.focus();
          await page.keyboard.press("Enter");
        }
      }

      // Wait for either heading to change (advance) or done to appear.
      await page
        .waitForFunction(
          ({ before }) => {
            const h = document.querySelector("h2")?.textContent ?? "";
            const d = document.body.innerText;
            return h !== before || d.includes("All done!") || d.includes("That's the last one");
          },
          { before: beforeHeading },
          { timeout: 3_000 },
        )
        .catch(() => undefined);
    }
    await expect(done).toBeVisible();
  });
});
