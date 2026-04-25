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
    const isHttps = c.req.header("x-forwarded-proto") === "https";
    setCookie(c, `s_${hash}`, token, {
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
      secure: isHttps,
    });
    return c.json({ hash });
  });

  return app;
}
