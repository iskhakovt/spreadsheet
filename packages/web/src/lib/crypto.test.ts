import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeValue, encodeValue, generateGroupKey, unwrapSensitive, wrapSensitive } from "./crypto.js";

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

describe("encodeValue / decodeValue", () => {
  it("round-trips in plaintext mode (null key)", async () => {
    const original = { rating: "yes", timing: "now" };
    const encoded = await encodeValue(original, null);
    const decoded = await decodeValue(encoded, null);
    expect(decoded).toEqual(original);
  });

  it("plaintext produces p:1: prefix", async () => {
    const encoded = await encodeValue("hello", null);
    expect(encoded).toMatch(/^p:1:/);
  });

  it("round-trips in encrypted mode", async () => {
    const key = await generateGroupKey();
    const original = { key: "oral-give:give", data: { rating: "yes", timing: "now" } };
    const encoded = await encodeValue(original, key);
    const decoded = await decodeValue(encoded, key);
    expect(decoded).toEqual(original);
  });

  it("encrypted produces e:1: prefix", async () => {
    const key = await generateGroupKey();
    const encoded = await encodeValue("test", key);
    expect(encoded).toMatch(/^e:1:/);
  });

  it("same value encrypts differently each time (random IV)", async () => {
    const key = await generateGroupKey();
    const a = await encodeValue("same-value", key);
    const b = await encodeValue("same-value", key);
    expect(a).not.toBe(b);
    // But both decrypt to the same value
    expect(await decodeValue(a, key)).toBe("same-value");
    expect(await decodeValue(b, key)).toBe("same-value");
  });

  it("wrong key fails to decrypt", async () => {
    const key1 = await generateGroupKey();
    const key2 = await generateGroupKey();
    const encoded = await encodeValue("secret", key1);
    await expect(decodeValue(encoded, key2)).rejects.toThrow();
  });

  it("encrypted mode throws without key", async () => {
    const key = await generateGroupKey();
    const encoded = await encodeValue("test", key);
    await expect(decodeValue(encoded, null)).rejects.toThrow("Cannot decrypt without group key");
  });

  it("handles complex objects", async () => {
    const key = await generateGroupKey();
    const obj = { key: "cunnilingus:give", data: { rating: "if-partner-wants", timing: "later" } };
    const encoded = await encodeValue(obj, key);
    const decoded = await decodeValue(encoded, key);
    expect(decoded).toEqual(obj);
  });

  it("handles null data (delete operation)", async () => {
    const key = await generateGroupKey();
    const obj = { key: "oral-give:give", data: null };
    const encoded = await encodeValue(obj, key);
    const decoded = await decodeValue(encoded, key);
    expect(decoded).toEqual(obj);
  });
});

describe("wrapSensitive / unwrapSensitive", () => {
  it("unwrap returns raw strings as-is", async () => {
    expect(await unwrapSensitive("Alice")).toBe("Alice");
    expect(await unwrapSensitive("")).toBe("");
    expect(await unwrapSensitive("some random text")).toBe("some random text");
  });

  it("unwrap decodes plaintext opaque strings", async () => {
    const encoded = await encodeValue("Alice", null);
    expect(encoded).toMatch(/^p:1:/);
    expect(await unwrapSensitive(encoded)).toBe("Alice");
  });

  it("unwrap decodes encrypted opaque strings", async () => {
    const key = await generateGroupKey();
    const encoded = await encodeValue("Alice", key);
    expect(encoded).toMatch(/^e:1:/);
    expect(await unwrapSensitive(encoded, key)).toBe("Alice");
  });

  it("unwrap throws on encrypted value without key", async () => {
    const key = await generateGroupKey();
    const encoded = await encodeValue("secret", key);
    await expect(unwrapSensitive(encoded, null)).rejects.toThrow();
  });

  it("wrap returns raw string when no session key", async () => {
    // No key in URL or sessionStorage → wrapSensitive returns raw
    const result = await wrapSensitive("Alice");
    expect(result).toBe("Alice");
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
    const { setSession } = await import("./session.js");
    return { getGroupKeyFromUrl, setSession };
  }

  it("caches the URL hash key under the current scope", async () => {
    const { getGroupKeyFromUrl, setSession } = await loadModules();
    locationStub.hash = "#key=firstGroupKey";
    setSession("TOKEN_A");
    expect(getGroupKeyFromUrl()).toBe("firstGroupKey");
  });

  it("does not leak a previously-cached key across tokens in the same tab", async () => {
    const { getGroupKeyFromUrl, setSession } = await loadModules();

    // Visit encrypted group A — key is in URL hash
    locationStub.hash = "#key=GROUP_A_KEY";
    setSession("TOKEN_A");
    expect(getGroupKeyFromUrl()).toBe("GROUP_A_KEY");

    // Navigate to an unencrypted group B in the same tab — no hash,
    // and the new token must not see group A's key. This is the
    // regression test for the `e:1:` leak we observed in prod:
    // before the scoping fix, `getGroupKeyFromUrl` for TOKEN_B
    // would return GROUP_A_KEY from the module-level + sessionStorage
    // cache, and TOKEN_B's answers would be encrypted with A's key.
    locationStub.hash = "";
    setSession("TOKEN_B");
    expect(getGroupKeyFromUrl()).toBeNull();

    // Going back to token A should still surface A's key because it
    // was stored scoped under A's hash in sessionStorage.
    setSession("TOKEN_A");
    expect(getGroupKeyFromUrl()).toBe("GROUP_A_KEY");
  });

  it("keeps separate keys for two encrypted groups visited in the same tab", async () => {
    const { getGroupKeyFromUrl, setSession } = await loadModules();

    locationStub.hash = "#key=KEY_A";
    setSession("TOKEN_A");
    expect(getGroupKeyFromUrl()).toBe("KEY_A");

    locationStub.hash = "#key=KEY_B";
    setSession("TOKEN_B");
    expect(getGroupKeyFromUrl()).toBe("KEY_B");

    // Switch back — each scope remembers its own key via sessionStorage
    locationStub.hash = "";
    setSession("TOKEN_A");
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
    const { setSession } = await import("./session.js");
    return { buildPersonLink, getGroupKeyFromUrl, setSession };
  }

  it("includes #key= fragment when group key is available", async () => {
    const { buildPersonLink, setSession } = await loadModules();
    locationStub.hash = "#key=MY_KEY";
    setSession("TOKEN_A");
    expect(buildPersonLink("SOME_TOKEN")).toBe("https://example.com/p/SOME_TOKEN#key=MY_KEY");
  });

  it("omits fragment when no group key", async () => {
    const { buildPersonLink, setSession } = await loadModules();
    locationStub.hash = "";
    setSession("TOKEN_A");
    expect(buildPersonLink("SOME_TOKEN")).toBe("https://example.com/p/SOME_TOKEN");
  });

  it("works for a different token than the current session", async () => {
    const { buildPersonLink, setSession } = await loadModules();
    locationStub.hash = "#key=SHARED_KEY";
    setSession("ADMIN_TOKEN");
    // Build a link for a partner using the admin's key
    expect(buildPersonLink("PARTNER_TOKEN")).toBe("https://example.com/p/PARTNER_TOKEN#key=SHARED_KEY");
  });
});
