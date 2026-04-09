import { beforeAll, describe, expect, it } from "vitest";

// Set secret before importing stoken module
beforeAll(() => {
  process.env.STOKEN_SECRET = "test-secret-for-stoken";
});

describe("stoken", () => {
  it("round-trips encode + decode", async () => {
    const { encodeStoken, decodeStoken } = await import("./stoken.js");
    const id = 42;
    const stoken = encodeStoken(id);
    const decoded = decodeStoken(stoken);
    expect(decoded).toBe(id);
  });

  it("produces different stokens for different ids", async () => {
    const { encodeStoken } = await import("./stoken.js");
    const a = encodeStoken(1);
    const b = encodeStoken(2);
    expect(a).not.toBe(b);
  });

  it("rejects tampered stoken", async () => {
    const { encodeStoken, decodeStoken } = await import("./stoken.js");
    const stoken = encodeStoken(10);
    // Flip a character in the middle
    const tampered = stoken.slice(0, 5) + "X" + stoken.slice(6);
    expect(() => decodeStoken(tampered)).toThrow();
  });

  it("rejects non-base64url input", async () => {
    const { decodeStoken } = await import("./stoken.js");
    expect(() => decodeStoken("not-valid!!!")).toThrow();
  });

  it("handles id 0", async () => {
    const { encodeStoken, decodeStoken } = await import("./stoken.js");
    const stoken = encodeStoken(0);
    expect(decodeStoken(stoken)).toBe(0);
  });

  it("handles large ids", async () => {
    const { encodeStoken, decodeStoken } = await import("./stoken.js");
    const id = 999999999;
    const stoken = encodeStoken(id);
    expect(decodeStoken(stoken)).toBe(id);
  });
});
