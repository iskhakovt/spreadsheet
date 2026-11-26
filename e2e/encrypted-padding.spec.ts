import type { Request } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { answerQuestionsCycling, createGroupAndSetup, goThroughIntro, narrowToCategory, scopedGet } from "./helpers.js";

const ALL_RATINGS = ["yes", "if-partner-wants", "maybe", "fantasy", "no"] as const;

interface Call {
  procedure: string;
  input: Record<string, unknown>;
}

/**
 * Split a tRPC `httpBatchLink` POST into one call per procedure. The URL path
 * lists the batched procedures (`/api/trpc/a,b?batch=1`) and the body keys
 * each input by its index in that list (`{"0": inputA, "1": inputB}`).
 */
function trpcCalls(req: Request): Call[] {
  const url = new URL(req.url());
  if (req.method() !== "POST" || !url.pathname.startsWith("/api/trpc/")) return [];
  const procedures = url.pathname.slice("/api/trpc/".length).split(",");
  const body = JSON.parse(req.postData() ?? "{}") as Record<string, Record<string, unknown>>;
  return procedures.map((procedure, i) => ({ procedure, input: body[String(i)] ?? {} }));
}

test.describe("encrypted length padding", () => {
  // AES-GCM ciphertext is as long as its plaintext, and the five ratings
  // serialize to five different lengths. Without padding the server reads
  // each answer off the length of its op. This watches the wire from the
  // browser's side: names, answer ops and progress must all be encrypted
  // and one length, whatever they encrypt.
  test("names, answer ops and progress are encrypted to one length, whatever the rating", async ({ page }) => {
    const calls: Call[] = [];
    // Observation only: requests go through untouched.
    page.on("request", (req) => calls.push(...trpcCalls(req)));
    const inputsOf = (procedure: string) => calls.filter((c) => c.procedure === procedure).map((c) => c.input);

    await createGroupAndSetup(page, { encrypted: true });
    await page.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(page);
    await narrowToCategory(page, "Group & External");
    await answerQuestionsCycling(page, ALL_RATINGS);

    // Wait for the debounced push to drain so every answer is on the wire.
    await expect.poll(() => scopedGet(page, "pendingOps"), { timeout: 10_000 }).toBe("[]");

    type Profile = { name: string; anatomy: string | null };
    const [setup] = inputsOf("groups.setupAdmin") as (Profile & { partners: Profile[] })[];
    expect(setup, "groups.setupAdmin was sent").toBeDefined();
    const profiles = [setup, ...setup.partners];
    const names = profiles.map((p) => p.name);
    // All-questions mode leaves anatomy unset; any that is set must be padded too.
    const anatomies = profiles.flatMap((p) => (p.anatomy === null ? [] : [p.anatomy]));

    const pushes = inputsOf("sync.push") as { operations: string[]; progress?: string }[];
    const ops = pushes.flatMap((p) => p.operations);
    const progress = pushes.flatMap((p) => (p.progress === undefined ? [] : [p.progress]));

    // Each field is present before we compare lengths, so a field that
    // silently went missing (or plaintext) can't pass by omission.
    expect(names).toHaveLength(2);
    expect(ops.length).toBeGreaterThanOrEqual(ALL_RATINGS.length);
    expect(progress.length).toBeGreaterThan(0);

    const encrypted = [...names, ...anatomies, ...ops, ...progress];
    for (const value of encrypted) expect(value).toMatch(/^e:1:/);
    expect([...new Set(encrypted.map((v) => v.length))]).toHaveLength(1);
  });
});
