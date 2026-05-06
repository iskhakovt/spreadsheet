import { fnv1a } from "@spreadsheet/shared";
import type { Context } from "hono";
import { setCookie } from "hono/cookie";

const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

/**
 * SPA-shell HTML producer. Two flavours:
 *
 *   default — landing & free routes: og:image = /og-image.png, standard copy
 *   invite  — /p/:token: og:image = /og-invite.png, "Your turn" copy
 *
 * Returning `null` means "no shell available" (e.g. dev with no built bundle
 * and no Vite to ask). The route handlers map that to a 404.
 *
 * Two implementations live downstream:
 *
 *   prod — pre-renders both variants from dist/index.html at startup (cached
 *          strings; no per-request work).
 *   dev  — reads packages/web/index.html, runs renderIndex for the variant,
 *          then funnels the result through Vite's transformIndexHtml so the
 *          SPA bundle, HMR client, and module rewrites all wire up correctly.
 */
export interface ShellRenderer {
  default(): Promise<string | null>;
  invite(): Promise<string | null>;
}

/**
 * Builds the SPA route handlers. Factored out of index.ts so the bootstrap
 * behaviour can be unit-tested without booting the server.
 *
 *   /p/:token and /p/:token/*  →  set s_{fnv1a(token)} cookie, serve
 *                                 invite-flavoured HTML (different og:image/
 *                                 og:title for messenger crawlers).
 *   everywhere else             →  serve default HTML (the SPA shell)
 *
 * The cookie is set on this HTTP response so the client never has to send the
 * token in a request header. Multi-person devices accumulate named cookies
 * (`s_${hashA}`, `s_${hashB}`, …) and each tab disambiguates via its own
 * sessionStorage value.
 *
 * Token validation is deferred — any token in the URL becomes a cookie. If
 * the token is junk, the next authenticated request fails, same outcome as a
 * 404 here. Validating up-front would require checking both persons.token AND
 * groups.adminToken (admin's pre-setup token doesn't have a person row yet),
 * and the deferred-failure path is simpler with identical security properties.
 *
 * Why HTML-on-/p/$token instead of a 302 redirect: messenger crawlers
 * (iMessage, Slack, WhatsApp) don't reliably follow redirects and don't
 * preserve cookies; serving the invite-flavoured HTML directly at the
 * shared URL keeps og:image/og:title working for link-unfurling.
 */
export function makeSpaRoutes(shell: ShellRenderer) {
  return {
    async serveBootstrap(c: Context) {
      const html = await shell.invite();
      if (!html) return c.text("Not found", 404);
      const token = c.req.param("token");
      if (!token) return c.text("Not found", 404);

      const hash = fnv1a(token);
      setCookie(c, `s_${hash}`, token, {
        httpOnly: true,
        sameSite: "Strict",
        path: "/",
        // x-forwarded-proto is set by the reverse proxy (which strips any
        // client-supplied value). Direct hits to the app port aren't exposed
        // in production, so trusting this header here is fine.
        secure: c.req.header("x-forwarded-proto") === "https",
        maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
      });
      c.header("Cache-Control", "no-cache");
      return c.html(html);
    },

    async serveDefault(c: Context) {
      const html = await shell.default();
      if (!html) return c.text("Not found", 404);
      c.header("Cache-Control", "no-cache");
      return c.html(html);
    },
  };
}

export { SESSION_COOKIE_MAX_AGE_SECONDS };
