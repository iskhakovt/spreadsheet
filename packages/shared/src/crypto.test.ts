import { describe, expect, it } from "vitest";
import { decodeOpaque, encodeOpaque } from "./crypto.js";

describe("encodeOpaque", () => {
  it("produces p:1: prefix for plaintext", () => {
    const result = encodeOpaque(false, '{"key":"test"}');
    expect(result).toBe('p:1:{"key":"test"}');
  });

  it("produces e:1: prefix for encrypted", () => {
    const result = encodeOpaque(true, "base64data");
    expect(result).toBe("e:1:base64data");
  });
});

describe("decodeOpaque", () => {
  it("round-trips with encodeOpaque (plaintext)", () => {
    const original = '{"key":"oral-give:give","data":{"rating":"yes"}}';
    const encoded = encodeOpaque(false, original);
    const decoded = decodeOpaque(encoded);
    expect(decoded.mode).toBe("p");
    expect(decoded.version).toBe("1");
    expect(decoded.payload).toBe(original);
  });

  it("round-trips with encodeOpaque (encrypted)", () => {
    const original = "dGhpcyBpcyBlbmNyeXB0ZWQ";
    const encoded = encodeOpaque(true, original);
    const decoded = decodeOpaque(encoded);
    expect(decoded.mode).toBe("e");
    expect(decoded.version).toBe("1");
    expect(decoded.payload).toBe(original);
  });

  it("preserves payload containing colons", () => {
    const payload = '{"key":"a:b:c","data":"x:y"}';
    const encoded = encodeOpaque(false, payload);
    const decoded = decodeOpaque(encoded);
    expect(decoded.payload).toBe(payload);
  });

  it("throws on missing prefix", () => {
    expect(() => decodeOpaque("nocolon")).toThrow("no prefix");
  });

  it("throws on missing version", () => {
    expect(() => decodeOpaque("p:noversion")).toThrow("no version");
  });

  it("throws on invalid mode", () => {
    expect(() => decodeOpaque("x:1:payload")).toThrow("Invalid opaque mode");
  });
});
