import { describe, expect, it } from "vitest";
import { isAllowedOrigin } from "./ws-security.js";

describe("isAllowedOrigin", () => {
  it("allows when origin is absent (non-browser client)", () => {
    expect(isAllowedOrigin(undefined, "example.com")).toBe(true);
  });

  it("allows when origin host matches the server host", () => {
    expect(isAllowedOrigin("https://example.com", "example.com")).toBe(true);
  });

  it("allows when origin includes port and it matches", () => {
    expect(isAllowedOrigin("http://localhost:8080", "localhost:8080")).toBe(true);
  });

  it("rejects when origin host differs from server host", () => {
    expect(isAllowedOrigin("https://evil.com", "example.com")).toBe(false);
  });

  it("rejects when origin is a subdomain of the server host", () => {
    expect(isAllowedOrigin("https://sub.example.com", "example.com")).toBe(false);
  });

  it("allows when origin host differs only by case", () => {
    expect(isAllowedOrigin("https://Example.com", "example.com")).toBe(true);
  });

  it("rejects a malformed origin", () => {
    expect(isAllowedOrigin("not-a-url", "example.com")).toBe(false);
  });
});
