import { beforeEach, describe, expect, it, vi } from "vitest";

// `pagePersonHash` is module memory per document; a fresh module import
// stands in for a fresh page load.
async function freshPage() {
  vi.resetModules();
  return import("./session.js");
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("isPersonSwitch (one page = one person)", () => {
  it("is false before the page belongs to anyone", async () => {
    const { isPersonSwitch } = await freshPage();
    expect(isPersonSwitch("token-a")).toBe(false);
  });

  it("is false for the person the page belongs to, true for anyone else", async () => {
    const { adoptSession, isPersonSwitch } = await freshPage();
    adoptSession("token-a");
    expect(isPersonSwitch("token-a")).toBe(false);
    expect(isPersonSwitch("token-b")).toBe(true);
  });

  it("keeps the first person even if a later adoptSession switches the store", async () => {
    // Only the layout route calls adoptSession in production, and it checks
    // isPersonSwitch first; this pins that the page's person can't drift.
    const { adoptSession, isPersonSwitch } = await freshPage();
    adoptSession("token-a");
    adoptSession("token-b");
    expect(isPersonSwitch("token-b")).toBe(true);
    expect(isPersonSwitch("token-a")).toBe(false);
  });

  it("starts over on a new page, even with a different person's hash persisted for the tab", async () => {
    // A reload into person B must not see person A's persisted session hash
    // as "this page's person", or it would reload forever.
    const stored = new Map<string, string>();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (k: string) => stored.get(k) ?? null,
        setItem: (k: string, v: string) => void stored.set(k, v),
      },
    });
    const first = await freshPage();
    first.adoptSession("token-a");
    expect(stored.size).toBe(1);

    const reloaded = await freshPage();
    expect(reloaded.isPersonSwitch("token-b")).toBe(false);
    reloaded.adoptSession("token-b");
    expect(reloaded.isPersonSwitch("token-b")).toBe(false);
    expect(reloaded.isPersonSwitch("token-a")).toBe(true);
  });
});
