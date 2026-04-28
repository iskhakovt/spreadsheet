import { expect, test } from "./fixtures.js";
import { createGroupAndSetup, dismissNotePromptIfPresent, goThroughIntro, narrowToCategory } from "./helpers.js";

test.describe("dependency gating", () => {
  test("answering no to sex-generally hides sex-domain Foundations content", async ({ page }) => {
    // Foundations contains pre-sex T1 items, then the `sex-generally` gate,
    // then everything sex-domain. Answering "no" to the gate should hide the
    // gated subtree (dirty-talk, slow-sex, period-sex, …) but leave the few
    // ungated T2 items (discuss-with-friends, discuss-with-therapist) visible.

    await createGroupAndSetup(page);
    await page.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(page);
    await narrowToCategory(page, "Foundations");
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Walk forward, answering "Yes" to everything until we reach the gate.
    const gateText = /Sexual acts.*welcome between us/;
    for (let i = 0; i < 50; i++) {
      if (
        await page
          .getByText(gateText)
          .first()
          .isVisible({ timeout: 100 })
          .catch(() => false)
      ) {
        break;
      }
      await page.getByRole("radio", { name: "Yes", exact: true }).click();
      await dismissNotePromptIfPresent(page);
    }

    await expect(page.getByText(gateText).first()).toBeVisible();

    // Answer "No" to the gate. The flow should skip every gated child.
    await page.getByRole("radio", { name: "No", exact: true }).click();
    await dismissNotePromptIfPresent(page);

    // Continue forward, capturing every question heading until we hit the
    // end-of-questions screen. Cap iterations to keep the test bounded if
    // something goes wrong.
    const seen: string[] = [];
    for (let i = 0; i < 30; i++) {
      const done = page.getByText("All done!").or(page.getByText("That's the last one"));
      if (await done.isVisible({ timeout: 200 }).catch(() => false)) break;

      const heading = await page.locator("h1, h2").first().textContent();
      if (heading) seen.push(heading);

      const yes = page.getByRole("radio", { name: "Yes", exact: true });
      if (await yes.isVisible({ timeout: 200 }).catch(() => false)) {
        await yes.click();
        await dismissNotePromptIfPresent(page);
      } else {
        break;
      }
    }

    const transcript = seen.join("\n---\n");

    // Sex-domain items must NOT appear after the gate is "no".
    expect(transcript).not.toMatch(/Dirty talk/);
    expect(transcript).not.toMatch(/Slow,? deliberate sex/);
    expect(transcript).not.toMatch(/Period sex/);
    expect(transcript).not.toMatch(/Phone sex/);
    expect(transcript).not.toMatch(/Quickies/);

    // Pre-sex T2 items remain visible.
    expect(transcript).toMatch(/Talking about our intimacy with close friends/);
  });

  test("answering yes to sex-generally keeps sex-domain content visible", async ({ page }) => {
    // Inverse of the above: same path, but answer "yes" to the gate. The
    // gated children should appear right after.

    await createGroupAndSetup(page);
    await page.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(page);
    await narrowToCategory(page, "Foundations");
    await page.getByRole("button", { name: "Start", exact: true }).click();

    const gateText = /Sexual acts.*welcome between us/;
    for (let i = 0; i < 50; i++) {
      if (
        await page
          .getByText(gateText)
          .first()
          .isVisible({ timeout: 100 })
          .catch(() => false)
      ) {
        break;
      }
      await page.getByRole("radio", { name: "Yes", exact: true }).click();
      await dismissNotePromptIfPresent(page);
    }

    await expect(page.getByText(gateText).first()).toBeVisible();
    await page.getByRole("radio", { name: "Yes", exact: true }).click();
    await dismissNotePromptIfPresent(page);

    // Walk forward and confirm a gated item appears.
    let foundDirtyTalk = false;
    for (let i = 0; i < 30; i++) {
      if (
        await page
          .getByText(/Talking dirty|Hearing dirty talk|^Dirty talk$/)
          .first()
          .isVisible({ timeout: 200 })
          .catch(() => false)
      ) {
        foundDirtyTalk = true;
        break;
      }
      const yes = page.getByRole("radio", { name: "Yes", exact: true });
      if (!(await yes.isVisible({ timeout: 200 }).catch(() => false))) break;
      await yes.click();
      await dismissNotePromptIfPresent(page);
    }

    expect(foundDirtyTalk).toBe(true);
  });
});
