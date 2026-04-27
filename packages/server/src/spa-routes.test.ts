import { fnv1a } from "@spreadsheet/shared";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { makeSpaRoutes, SESSION_COOKIE_MAX_AGE_SECONDS } from "./spa-routes.js";

const HTML_INVITE = '<html data-variant="invite"></html>';
const HTML_DEFAULT = '<html data-variant="default"></html>';

function makeApp(opts: { invite?: string | null; def?: string | null } = {}) {
  const { serveBootstrap, serveDefault } = makeSpaRoutes(
    opts.invite === undefined ? HTML_INVITE : opts.invite,
    opts.def === undefined ? HTML_DEFAULT : opts.def,
  );
  const app = new Hono();
  app.get("/p/:token", serveBootstrap);
  app.get("/p/:token/*", serveBootstrap);
  app.get("/", serveDefault);
  app.get("/*", serveDefault);
  return app;
}

describe("/p/:token bootstrap", () => {
  it("sets per-person httpOnly cookie keyed by fnv1a(token), serves invite HTML", async () => {
    const app = makeApp();
    const token = "abc123";
    const res = await app.request(`/p/${token}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(HTML_INVITE);
    const hash = fnv1a(token);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`s_${hash}=${token}`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`);
  });

  it("uses only the first path segment as the token, ignoring suffix", async () => {
    const app = makeApp();
    const res = await app.request("/p/abc/results");
    const hash = fnv1a("abc");
    expect(res.headers.get("set-cookie") ?? "").toContain(`s_${hash}=abc;`);
  });

  it("works for deeply nested paths", async () => {
    const app = makeApp();
    const res = await app.request("/p/deep-token/long/nested/path");
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toContain(`s_${fnv1a("deep-token")}=deep-token`);
  });

  it("sets a cookie even for tokens that don't match a person row (admin pre-setup case)", async () => {
    // Token validation is intentionally deferred to subsequent authenticated
    // requests. Pre-setup admin tokens live in groups.adminToken, not
    // persons.token, but they still need to be cookie-bootstrapped.
    const app = makeApp();
    const res = await app.request("/p/some-pre-setup-token");
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toContain("s_");
  });

  it("sets Secure when behind an HTTPS proxy", async () => {
    const app = makeApp();
    const res = await app.request("/p/abc", { headers: { "x-forwarded-proto": "https" } });
    expect((res.headers.get("set-cookie") ?? "").toLowerCase()).toContain("secure");
  });

  it("does not set Secure on plain HTTP", async () => {
    const app = makeApp();
    const res = await app.request("/p/abc");
    expect((res.headers.get("set-cookie") ?? "").toLowerCase()).not.toContain("secure");
  });

  it("returns 404 when invite HTML is unavailable (dev with no built bundle)", async () => {
    const app = makeApp({ invite: null });
    const res = await app.request("/p/abc");
    expect(res.status).toBe(404);
  });
});

describe("default SPA route", () => {
  it("serves the default HTML on /", async () => {
    const app = makeApp();
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(HTML_DEFAULT);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("serves the default HTML on arbitrary non-/p paths (SPA fallback)", async () => {
    const app = makeApp();
    for (const path of ["/setup", "/results", "/group", "/summary"]) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(HTML_DEFAULT);
    }
  });

  it("does not set any session cookie on non-bootstrap routes", async () => {
    const app = makeApp();
    for (const path of ["/", "/setup", "/results"]) {
      const res = await app.request(path);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  it("returns 404 when default HTML is unavailable", async () => {
    const app = makeApp({ def: null });
    const res = await app.request("/");
    expect(res.status).toBe(404);
  });
});
