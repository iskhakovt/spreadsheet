import { fnv1a } from "@spreadsheet/shared";
import { describe, expect, it } from "vitest";
import { createAuthApp } from "./auth.js";
import type { GroupStore } from "./store/groups.js";
import { strictMock } from "./test/mocks.js";

const person = {
  id: "p1",
  groupId: "g1",
  name: "Alice",
  anatomy: null,
  token: "tkn",
  isAdmin: false,
  isCompleted: false,
  progress: null,
  createdAt: new Date(),
};

function makeApp(getPersonByToken?: GroupStore["getPersonByToken"]) {
  const groups = strictMock<GroupStore>();
  if (getPersonByToken) groups.getPersonByToken.mockImplementation(getPersonByToken);
  return createAuthApp(groups);
}

describe("POST /auth/exchange", () => {
  it("returns 400 when body is not valid JSON", async () => {
    const app = makeApp();
    const res = await app.request("/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing_token" });
  });

  it("returns 400 when token is missing", async () => {
    const app = makeApp();
    const res = await app.request("/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing_token" });
  });

  it("returns 400 when token is not a string", async () => {
    const app = makeApp();
    const res = await app.request("/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: 42 }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing_token" });
  });

  it("returns 404 when token is not found", async () => {
    const app = makeApp(async () => null);
    const res = await app.request("/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "unknown" }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("returns 200 and sets httpOnly cookie on valid token", async () => {
    const token = "valid-token-abc";
    const app = makeApp(async () => person);
    const res = await app.request("/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const hash = fnv1a(token);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`s_${hash}=${token}`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Max-Age=${60 * 60 * 24 * 30}`);
  });

  it("sets Secure flag when x-forwarded-proto is https", async () => {
    const app = makeApp(async () => person);
    const res = await app.request("/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-proto": "https" },
      body: JSON.stringify({ token: "valid-token" }),
    });
    expect(res.headers.get("set-cookie")?.toLowerCase()).toContain("secure");
  });

  it("does not set Secure flag over http", async () => {
    const app = makeApp(async () => person);
    const res = await app.request("/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "valid-token" }),
    });
    const cookie = res.headers.get("set-cookie")?.toLowerCase() ?? "";
    expect(cookie).not.toContain("secure");
  });
});
