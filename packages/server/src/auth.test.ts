import { fnv1a } from "@spreadsheet/shared";
import { describe, expect, it, vi } from "vitest";
import { createAuthApp } from "./auth.js";

const person = { id: "p1", groupId: "g1", name: "Alice", anatomy: null, isAdmin: false, isCompleted: false };

function makeApp(getPersonByToken: (token: string) => Promise<typeof person | null>) {
  return createAuthApp({ getPersonByToken } as never);
}

describe("POST /auth/exchange", () => {
  it("returns 400 when body is not valid JSON", async () => {
    const app = makeApp(vi.fn());
    const res = await app.request("/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing_token" });
  });

  it("returns 400 when token is missing", async () => {
    const app = makeApp(vi.fn());
    const res = await app.request("/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing_token" });
  });

  it("returns 400 when token is not a string", async () => {
    const app = makeApp(vi.fn());
    const res = await app.request("/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: 42 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when token is not found", async () => {
    const app = makeApp(vi.fn().mockResolvedValue(null));
    const res = await app.request("/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "unknown" }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns 200 with hash and sets httpOnly cookie on valid token", async () => {
    const token = "valid-token-abc";
    const app = makeApp(vi.fn().mockResolvedValue(person));
    const res = await app.request("/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(res.status).toBe(200);
    const hash = fnv1a(token);
    expect(await res.json()).toEqual({ hash });

    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`s_${hash}=${token}`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=strict");
    expect(cookie).toContain("Path=/");
  });

  it("sets Secure flag when x-forwarded-proto is https", async () => {
    const app = makeApp(vi.fn().mockResolvedValue(person));
    const res = await app.request("/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-proto": "https" },
      body: JSON.stringify({ token: "valid-token" }),
    });
    expect(res.headers.get("set-cookie")?.toLowerCase()).toContain("secure");
  });

  it("does not set Secure flag over http", async () => {
    const app = makeApp(vi.fn().mockResolvedValue(person));
    const res = await app.request("/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "valid-token" }),
    });
    const cookie = res.headers.get("set-cookie")?.toLowerCase() ?? "";
    expect(cookie).not.toContain("secure");
  });
});
