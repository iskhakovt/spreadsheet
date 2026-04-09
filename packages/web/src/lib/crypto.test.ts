import { describe, expect, it } from "vitest";
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
