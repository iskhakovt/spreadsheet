import { expect, test } from "./fixtures.js";
import { answerAllQuestions, createGroupAndSetup, goThroughIntro, narrowToCategory, WS_TIMEOUT } from "./helpers.js";

// Encrypted is the production default (REQUIRE_ENCRYPTION=true), and the
// crypto path is a strict superset of plaintext (key in URL fragment +
// AES-GCM + sessionStorage caching). Other tests don't need to repeat the
// encrypted/plaintext matrix — encryption-key.spec.ts owns the dedicated
// fallback coverage.
test.describe("two-player completion flow", () => {
  test("Alice and Bob both complete and see results", async ({ alice, bob }) => {
    const { partnerLink } = await createGroupAndSetup(alice, { encrypted: true });

    expect(alice.url()).toContain("#key=");
    expect(partnerLink).toContain("#key=");

    // Alice: full journey — start, intro, narrow via Summary UI, answer, done
    await alice.getByRole("button", { name: "Start filling out", exact: true }).click();
    await goThroughIntro(alice);
    await narrowToCategory(alice, "Group & External");
    await answerAllQuestions(alice, "yes");
    await alice.getByRole("button", { name: "I'm done", exact: true }).click();
    await expect(alice.getByText("Waiting for everyone")).toBeVisible();

    // Bob: open link → intro → narrow via Summary → answer → done
    await bob.goto(partnerLink);
    await goThroughIntro(bob);
    await narrowToCategory(bob, "Group & External");
    await answerAllQuestions(bob, "yes");
    await bob.getByRole("button", { name: "I'm done", exact: true }).click();

    // Both complete → Bob goes straight to results
    await expect(bob.getByText("Your matches")).toBeVisible({ timeout: WS_TIMEOUT });
    await expect(bob.getByText("You & Alice")).toBeVisible({ timeout: WS_TIMEOUT });
    // Target by data-match-type — plain getByText("Match") would substring-match
    // the "Your matches" header and "Total matches" summary strip label.
    await expect(bob.locator('[data-testid="match-row"][data-match-type="match"]').first()).toBeVisible();

    // SSE push delivers Bob's completion to Alice → guard redirects to /results
    await expect(alice.getByText("Your matches")).toBeVisible({ timeout: WS_TIMEOUT });
    await expect(alice.getByText("You & Bob")).toBeVisible({ timeout: WS_TIMEOUT });
  });
});
