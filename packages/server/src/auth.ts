import { fnv1a } from "@spreadsheet/shared";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { GroupStore } from "./store/groups.js";

export function createAuthApp(groups: GroupStore): Hono {
  const app = new Hono();

  app.post("/auth/exchange", async (c) => {
    let body: { token?: unknown };
    try {
      body = await c.req.json<{ token?: unknown }>();
    } catch {
      return c.json({ error: "missing_token" }, 400);
    }
    const token = typeof body.token === "string" ? body.token : null;
    if (!token) return c.json({ error: "missing_token" }, 400);

    const person = await groups.getPersonByToken(token);
    if (!person) return c.json({ error: "not_found" }, 404);

    const hash = fnv1a(token);
    // x-forwarded-proto is set by the reverse proxy (and stripped from
    // client-supplied values by the proxy). Trusting it here is fine because
    // the deployment guarantees direct hits to the app port aren't exposed.
    // If anything ever gates security on this header (e.g. "require HTTPS"),
    // revisit — Secure is forgiving in the harmful direction, route gates
    // are not.
    const isHttps = c.req.header("x-forwarded-proto") === "https";
    setCookie(c, `s_${hash}`, token, {
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
      secure: isHttps,
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
    return c.json({ ok: true });
  });

  return app;
}
