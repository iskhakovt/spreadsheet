import { expect, test } from "./fixtures.js";
import { answerQuestionsCycling, createGroupAndSetup, goThroughIntro, narrowToCategory, scopedGet } from "./helpers.js";

const ALL_RATINGS = ["yes", "if-partner-wants", "maybe", "fantasy", "no"] as const;

/** Every `e:1:` string anywhere in a JSON value (tRPC batch bodies nest them). */
function encryptedStrings(value: unknown): string[] {
  if (typeof value === "string") return value.startsWith("e:1:") ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(encryptedStrings);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(encryptedStrings);
  return [];
}

test.describe("encrypted length padding", () => {
  // AES-GCM ciphertext is as long as its plaintext, and the five ratings
  // serialize to five different lengths. Without padding the server reads
  // each answer off the length of its op. This watches the wire from the
  // browser's side: every encrypted value the app sends (names, anatomy,
  // progress, answer ops) must be one length, whatever it encrypts.
  test("every encrypted value the browser sends is the same length, whatever the rating", async ({ page }) => {
    const sent: string[] = [];
    const pushedOps: string[] = [];
    // Observation only: requests go through untouched.
    page.on("request", (req) => {
      if (req.method() !== "POST" || !req.url().includes("/api/trpc/")) return;
      const body: unknown = JSON.parse(req.postData() ?? "null");
      sent.push(...encryptedStrings(body));
      if (req.url().includes("sync.push")) {
        for (const input of Object.values(body ?? {})) {
          pushedOps.push(...encryptedStrings((input as { operations?: unknown }).operations));
        }
      }
    });

    await createGroupAndSetup(page, { encrypted: true });
    await page.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(page);
    await narrowToCategory(page, "Group & External");
    await answerQuestionsCycling(page, ALL_RATINGS);

    // Wait for the debounced push to drain so every answer is on the wire.
    await expect.poll(() => scopedGet(page, "pendingOps"), { timeout: 10_000 }).toBe("[]");

    expect(pushedOps.length).toBeGreaterThanOrEqual(ALL_RATINGS.length);
    expect(sent.length).toBeGreaterThan(pushedOps.length); // names + progress too
    expect([...new Set(sent.map((s) => s.length))]).toHaveLength(1);
  });
});
