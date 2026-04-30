import { expect, test } from "./fixtures.js";
import { createGroupAndSetup, goThroughIntro, narrowToCategory, scopedGet } from "./helpers.js";

// Encrypted ops carry the note inside opaque ciphertext, so dedup runs
// without reading the cleartext key — exercising both modes verifies the
// in-memory key→position index handles e:1: ops as well as p:1:. The local
// `answers` store is plaintext JSON in both modes (only the wire op is
// encrypted), so we use it as the readiness signal regardless of mode.
for (const encrypted of [false, true] as const) {
  test.describe(`pending-op dedup (${encrypted ? "encrypted" : "plaintext"})`, () => {
    test("debounced note keystrokes collapse to a single queued op", async ({ alice }) => {
      await createGroupAndSetup(alice, { encrypted });
      await alice.getByRole("button", { name: "Start filling out", exact: true }).click();
      await goThroughIntro(alice);
      await narrowToCategory(alice, "Foundations");
      await alice.getByRole("button", { name: "Start", exact: true }).click();

      // Drain setup ops (profile + ready) so the queue we measure carries
      // only this question's writes.
      const queueLen = async () => {
        const raw = await scopedGet(alice, "pendingOps");
        return raw ? (JSON.parse(raw) as string[]).length : 0;
      };
      await expect.poll(queueLen, { timeout: 10_000 }).toBe(0);

      // Open the textarea (eye-contact has no notePrompt) and rate. The
      // rating commit is the first op for this question's key; subsequent
      // note debounces hit the same key and must replace it.
      await alice.getByRole("button", { name: /add a note/i }).click();
      const textarea = alice.getByRole("textbox");
      await expect(textarea).toBeVisible();
      await alice.getByRole("radio", { name: "Yes", exact: true }).click();

      // Block until the rating op has settled — without this, the note
      // debounce effect runs against a stale `existingAnswer` and skips.
      await expect.poll(queueLen, { timeout: 5_000 }).toBe(1);

      // Read local answer state for the question key. Plaintext in both
      // modes (encryption only wraps the wire op), so it's a reliable
      // proxy for "the debounced commit fired and persisted".
      const QKEY = "eye-contact:mutual";
      const noteInStore = async () => {
        const raw = await scopedGet(alice, "answers");
        const answers = raw ? (JSON.parse(raw) as Record<string, { note: string | null }>) : {};
        return answers[QKEY]?.note ?? null;
      };

      // Type in chunks; each fill replaces the textarea value. Polling for
      // the local answer to update confirms the debounced commit fired,
      // independent of dedup math. Without dedup, each chunk would also
      // append a fresh op to the queue — the final length assertion is
      // what catches that.
      const chunks = ["really ", "matters ", "when ", "we ", "travel"];
      let cumulative = "";
      for (const chunk of chunks) {
        cumulative += chunk;
        await textarea.fill(cumulative);
        await expect.poll(noteInStore, { timeout: 3_000 }).toBe(cumulative.trim());
      }

      // The dedup guarantee: 5 same-key debounced commits + the original
      // rating commit collapse to a single queue entry. Without dedup we'd
      // see 6 here.
      const raw = await scopedGet(alice, "pendingOps");
      const ops = raw ? (JSON.parse(raw) as string[]) : [];
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatch(encrypted ? /^e:1:/ : /^p:1:/);
      if (!encrypted) {
        expect(ops[0]).toContain(cumulative.trim());
      }
    });
  });
}
