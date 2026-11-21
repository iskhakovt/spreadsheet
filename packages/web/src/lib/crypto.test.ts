import { type OperationPayload, Rating } from "@spreadsheet/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeValue,
  encodeValue,
  generateGroupKey,
  MissingKeyError,
  unwrapSensitive,
  wrapSensitive,
} from "./crypto.js";

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
    const original = { rating: "yes" };
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
    const original = { key: "oral-give:give", data: { rating: "yes" } };
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
    await expect(decodeValue(encoded, null)).rejects.toThrow(MissingKeyError);
  });

  it("handles complex objects", async () => {
    const key = await generateGroupKey();
    const obj = { key: "cunnilingus:give", data: { rating: "if-partner-wants" } };
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

describe("encrypted length padding", () => {
  // The server stores every `e:1:` string it receives. These pin the
  // observable contract (the opaque string's length must not reveal the
  // value), not the bucket arithmetic behind it.
  const lengthOf = async (value: unknown, key: string) => (await encodeValue(value, key)).length;
  const distinctLengths = async (values: unknown[], key: string) =>
    new Set(await Promise.all(values.map((v) => lengthOf(v, key))));
  const op = (key: string, data: OperationPayload["data"]): OperationPayload => ({ key, data });

  it("note-less ops share one length across every rating, key, role, and set/clear", async () => {
    const key = await generateGroupKey();
    const keys = ["kissing:mutual", "oral:give", "watching-partner-masturbate:receive"];
    const ops = keys.flatMap((k) => [op(k, null), ...Rating.options.map((rating) => op(k, { rating, note: null }))]);
    expect((await distinctLengths(ops, key)).size).toBe(1);
  });

  it("a short note doesn't change the length", async () => {
    const key = await generateGroupKey();
    const k = "watching-partner-masturbate:receive";
    const ops = [
      op(k, { rating: "if-partner-wants", note: null }),
      op(k, { rating: "no", note: "" }),
      op(k, { rating: "yes", note: "only on weekends, and only if we've talked about it first" }),
    ];
    expect((await distinctLengths(ops, key)).size).toBe(1);
  });

  it("long notes are bucketed: same bucket, same length; next bucket, longer", async () => {
    const key = await generateGroupKey();
    const withNote = (note: string) => op("kissing:mutual", { rating: "yes", note });
    const [a, b, c] = await Promise.all(
      [withNote("x".repeat(300)), withNote("x".repeat(380)), withNote("x".repeat(600))].map((v) => lengthOf(v, key)),
    );
    expect(a).toBe(b);
    expect(c).toBeGreaterThan(b);
  });

  it("buckets by UTF-8 bytes, so multibyte notes don't leak their exact length", async () => {
    // "é" is one UTF-16 code unit but two UTF-8 bytes. Bucketing by
    // `string.length` would overshoot the bucket by the extra bytes and
    // give these two notes different ciphertext lengths.
    const key = await generateGroupKey();
    const withNote = (note: string) => op("kissing:mutual", { rating: "yes", note });
    expect((await distinctLengths([withNote("é".repeat(150)), withNote("é".repeat(180))], key)).size).toBe(1);
  });

  it("names, anatomy, and progress don't leak their length either", async () => {
    const key = await generateGroupKey();
    const values = [
      "Al",
      "Alexandra-Josephine",
      "amab",
      "none",
      { answered: 3, total: 40 },
      { answered: 147, total: 312 },
    ];
    expect((await distinctLengths(values, key)).size).toBe(1);
  });

  it("padded values round-trip unchanged, multibyte notes included", async () => {
    const key = await generateGroupKey();
    const values = [
      op("kissing:mutual", { rating: "maybe", note: "Ça me plaît 🙂" }),
      op("kissing:mutual", { rating: "yes", note: "x".repeat(2000) }),
      op("kissing:mutual", null),
      "Alice",
    ];
    for (const value of values) {
      expect(await decodeValue(await encodeValue(value, key), key)).toEqual(value);
    }
  });

  it("decodes legacy unpadded e:1: values", async () => {
    // Pre-padding clients encrypted the bare JSON. Those journal entries
    // and profile fields stay on the server, so new code must keep reading them.
    const key = await generateGroupKey();
    const value = op("kissing:mutual", { rating: "fantasy", note: "legacy" });
    const legacy = await legacyEncrypt(value, key);
    expect(legacy.length).toBeLessThan(await lengthOf(value, key));
    expect(await decodeValue(legacy, key)).toEqual(value);
  });

  it("leaves plaintext mode unpadded (the server can read it anyway)", async () => {
    expect(await encodeValue("hello", null)).toBe('p:1:"hello"');
  });
});

/** Encrypt the way pre-padding clients did: bare JSON, no padding. */
async function legacyEncrypt(value: unknown, base64urlKey: string): Promise<string> {
  const fromB64url = (s: string) =>
    Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
  const toB64url = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const cryptoKey = await crypto.subtle.importKey("raw", fromB64url(base64urlKey), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, plaintext));
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv);
  combined.set(ciphertext, iv.length);
  return `e:1:${toB64url(combined)}`;
}

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
