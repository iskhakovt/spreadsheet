import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptJson, encryptJson, generateGroupKey, importGroupKey } from "./crypto.js";

describe("generateGroupKey", () => {
  it("returns a non-empty base64url string", async () => {
    const key = await generateGroupKey();
    expect(key.length).toBeGreaterThan(20);
    // base64url: no +, /, or = characters
    expect(key).not.toMatch(/[+/=]/);
  });

  it("generates different keys each time", async () => {
    const a = await generateGroupKey();
    const b = await generateGroupKey();
    expect(a).not.toBe(b);
  });
});

describe("encryptJson / decryptJson", () => {
  // Low-level AES-GCM primitives; the codec builds sealed values on top.
  it("round-trips, padding included", async () => {
    const key = await importGroupKey(await generateGroupKey());
    const json = JSON.stringify({ name: "Alice" });
    const opened = await decryptJson(await encryptJson(json, key), key);
    expect(opened.trimEnd()).toBe(json);
    expect(JSON.parse(opened)).toEqual({ name: "Alice" });
  });

  it("fails with the wrong key (GCM authenticates the ciphertext)", async () => {
    const a = await importGroupKey(await generateGroupKey());
    const b = await importGroupKey(await generateGroupKey());
    await expect(decryptJson(await encryptJson('"x"', a), b)).rejects.toThrow();
  });

  it("encodes plaintext padded past 128 KiB without overflowing the argument limit", async () => {
    // 70 KB pads to a 128 KiB bucket. Spreading that into a single
    // String.fromCharCode call throws RangeError in V8.
    const key = await importGroupKey(await generateGroupKey());
    const json = JSON.stringify("x".repeat(70_000));
    expect((await decryptJson(await encryptJson(json, key), key)).trimEnd()).toBe(json);
  });
});

describe("getGroupKeyFromUrl scope isolation", () => {
  // Minimal window + sessionStorage stubs so getGroupKeyFromUrl exercises
  // its caching + scoping logic end-to-end. In the node test env neither
  // exists by default, and the `typeof window === "undefined"` short-circuit
  // in the function would otherwise skip the real code path.
  //
  // `sessionStorage` is stubbed at the `describe` scope (not reset per-test)
  // so the fallback-read path in `getGroupKeyFromUrl` can see a key written
  // during the same tab, which is what the real-world flow does: the user
  // opens an encrypted group, the key gets cached in sessionStorage scoped
  // by their token, they then navigate to a second group in the same tab.
  let sessionStoreMap: Map<string, string>;
  let locationStub: { hash: string; pathname: string };

  beforeEach(() => {
    sessionStoreMap = new Map<string, string>();
    locationStub = { hash: "", pathname: "/" };
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => sessionStoreMap.get(k) ?? null,
      setItem: (k: string, v: string) => void sessionStoreMap.set(k, v),
      removeItem: (k: string) => void sessionStoreMap.delete(k),
      clear: () => sessionStoreMap.clear(),
    });
    vi.stubGlobal("window", { location: locationStub });
    // Reset module state so each test gets fresh `cachedGroupKey` /
    // `cachedScope` + a fresh Zustand sessionStore.
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function loadModules() {
    const { getGroupKeyFromUrl } = await import("./crypto.js");
    const { adoptSession } = await import("./session.js");
    return { getGroupKeyFromUrl, adoptSession };
  }

  it("caches the URL hash key under the current scope", async () => {
    const { getGroupKeyFromUrl, adoptSession } = await loadModules();
    locationStub.hash = "#key=firstGroupKey";
    adoptSession("TOKEN_A");
    expect(getGroupKeyFromUrl()).toBe("firstGroupKey");
  });

  it("does not leak a previously-cached key across tokens in the same tab", async () => {
    const { getGroupKeyFromUrl, adoptSession } = await loadModules();

    // Visit encrypted group A — key is in URL hash
    locationStub.hash = "#key=GROUP_A_KEY";
    adoptSession("TOKEN_A");
    expect(getGroupKeyFromUrl()).toBe("GROUP_A_KEY");

    // Navigate to an unencrypted group B in the same tab — no hash,
    // and the new token must not see group A's key. This is the
    // regression test for the `e:1:` leak we observed in prod:
    // before the scoping fix, `getGroupKeyFromUrl` for TOKEN_B
    // would return GROUP_A_KEY from the module-level + sessionStorage
    // cache, and TOKEN_B's answers would be encrypted with A's key.
    locationStub.hash = "";
    adoptSession("TOKEN_B");
    expect(getGroupKeyFromUrl()).toBeNull();

    // Going back to token A should still surface A's key because it
    // was stored scoped under A's hash in sessionStorage.
    adoptSession("TOKEN_A");
    expect(getGroupKeyFromUrl()).toBe("GROUP_A_KEY");
  });

  it("keeps separate keys for two encrypted groups visited in the same tab", async () => {
    const { getGroupKeyFromUrl, adoptSession } = await loadModules();

    locationStub.hash = "#key=KEY_A";
    adoptSession("TOKEN_A");
    expect(getGroupKeyFromUrl()).toBe("KEY_A");

    locationStub.hash = "#key=KEY_B";
    adoptSession("TOKEN_B");
    expect(getGroupKeyFromUrl()).toBe("KEY_B");

    // Switch back — each scope remembers its own key via sessionStorage
    locationStub.hash = "";
    adoptSession("TOKEN_A");
    expect(getGroupKeyFromUrl()).toBe("KEY_A");
  });
});

describe("buildPersonLink", () => {
  let sessionStoreMap: Map<string, string>;
  let locationStub: { hash: string; pathname: string; origin: string };

  beforeEach(() => {
    sessionStoreMap = new Map<string, string>();
    locationStub = { hash: "", pathname: "/", origin: "https://example.com" };
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => sessionStoreMap.get(k) ?? null,
      setItem: (k: string, v: string) => void sessionStoreMap.set(k, v),
      removeItem: (k: string) => void sessionStoreMap.delete(k),
      clear: () => sessionStoreMap.clear(),
    });
    vi.stubGlobal("window", { location: locationStub });
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function loadModules() {
    const { buildPersonLink, getGroupKeyFromUrl } = await import("./crypto.js");
    const { adoptSession } = await import("./session.js");
    return { buildPersonLink, getGroupKeyFromUrl, adoptSession };
  }

  it("includes #key= fragment when group key is available", async () => {
    const { buildPersonLink, adoptSession } = await loadModules();
    locationStub.hash = "#key=MY_KEY";
    adoptSession("TOKEN_A");
    expect(buildPersonLink("SOME_TOKEN")).toBe("https://example.com/p/SOME_TOKEN#key=MY_KEY");
  });

  it("omits fragment when no group key", async () => {
    const { buildPersonLink, adoptSession } = await loadModules();
    locationStub.hash = "";
    adoptSession("TOKEN_A");
    expect(buildPersonLink("SOME_TOKEN")).toBe("https://example.com/p/SOME_TOKEN");
  });

  it("works for a different token than the current session", async () => {
    const { buildPersonLink, adoptSession } = await loadModules();
    locationStub.hash = "#key=SHARED_KEY";
    adoptSession("ADMIN_TOKEN");
    // Build a link for a partner using the admin's key
    expect(buildPersonLink("PARTNER_TOKEN")).toBe("https://example.com/p/PARTNER_TOKEN#key=SHARED_KEY");
  });
});
