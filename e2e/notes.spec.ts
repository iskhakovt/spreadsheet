import { expect, test } from "./fixtures.js";
import { answerAllQuestions, createGroupAndSetup, goThroughIntro, narrowToCategory, WS_TIMEOUT } from "./helpers.js";

// Notes are sensitive content; they ride inside the same opaque envelope
// as the rating, so the encryption path matters for round-trip + replay.
// The project guideline asks for both modes to be exercised.
for (const encrypted of [false, true] as const) {
  test.describe(`free-text notes (${encrypted ? "encrypted" : "plaintext"})`, () => {
    test("note round-trips from authoring through to /results", async ({ alice, bob }) => {
      const NOTE_TEXT = "open to anything around fantasy talk";

      const { partnerLink } = await createGroupAndSetup(alice, { encrypted });
      await alice.getByRole("button", { name: "Start filling out", exact: true }).click();
      await goThroughIntro(alice);
      await narrowToCategory(alice, "Foundations");

      // First question — eye-contact (no notePrompt). Use the hairline
      // "+ Add a note" affordance to opt into Layout B; this exercises both
      // the link → expand transition and the inline note entry path.
      await alice.getByRole("button", { name: "Start", exact: true }).click();
      await alice.getByRole("button", { name: /add a note/i }).click();
      const textarea = alice.getByRole("textbox");
      await expect(textarea).toBeVisible();
      await alice.getByRole("radio", { name: "Yes", exact: true }).click();
      await textarea.fill(NOTE_TEXT);
      await alice.getByTestId("note-next").click();

      // Helper handles remaining questions; on notePrompt questions it taps
      // the same primary Next to advance without writing a note.
      await answerAllQuestions(alice, "yes");
      await alice.getByRole("button", { name: "I'm done", exact: true }).click();
      await expect(alice.getByText("Waiting for everyone")).toBeVisible();

      await bob.goto(partnerLink);
      await goThroughIntro(bob);
      await narrowToCategory(bob, "Foundations");
      await answerAllQuestions(bob, "yes");
      await bob.getByRole("button", { name: "I'm done", exact: true }).click();

      await expect(bob.getByText("Your matches")).toBeVisible({ timeout: WS_TIMEOUT });

      // Alice's note shows up under the eye-contact match row on Bob's view,
      // attributed to Alice (Bob is the viewer, so partner names render verbatim).
      const notesBlock = bob.locator('[data-testid="match-notes"]', { hasText: NOTE_TEXT });
      await expect(notesBlock).toBeVisible();
      await expect(notesBlock.getByText("Alice", { exact: true })).toBeVisible();
    });

    test("note typed via '+ Add a note' persists across Back navigation", async ({ alice }) => {
      const NOTE_TEXT = "really matters when we travel";

      await createGroupAndSetup(alice, { encrypted });
      await alice.getByRole("button", { name: "Start filling out", exact: true }).click();
      await goThroughIntro(alice);
      await narrowToCategory(alice, "Foundations");
      await alice.getByRole("button", { name: "Start", exact: true }).click();

      // Bare card — no textarea, only the hairline link.
      await expect(alice.getByRole("textbox")).not.toBeVisible();

      await alice.getByRole("button", { name: /add a note/i }).click();
      const textarea = alice.getByRole("textbox");
      await expect(textarea).toBeVisible();

      await alice.getByRole("radio", { name: "Yes", exact: true }).click();
      await textarea.fill(NOTE_TEXT);
      await alice.getByTestId("note-next").click();

      // Go back: the previous question (now eye-contact) has a saved note,
      // so it lands directly in Layout B with the textarea pre-filled — no
      // "+ Add a note" link needed.
      await alice.getByRole("button", { name: "Previous question" }).click();
      await expect(alice.getByRole("textbox")).toHaveValue(NOTE_TEXT);
    });
  });
}
