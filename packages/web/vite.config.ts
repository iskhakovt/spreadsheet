import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import devServer from "@hono/vite-dev-server";
import nodeAdapter from "@hono/vite-dev-server/node";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { compression } from "vite-plugin-compression2";
import { VitePWA } from "vite-plugin-pwa";
import svgr from "vite-plugin-svgr";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_DEV_ENTRY = resolve(HERE, "../server/src/dev/entry.ts");
const SERVER_DEV_STATE = resolve(HERE, "../server/src/dev/state.ts");
const SERVER_DEV_SHELL = resolve(HERE, "../server/src/dev/shell.ts");

// Rasterize the handcrafted og:image SVGs to PNG at build time.
// Messengers (Facebook, LinkedIn, iMessage, WhatsApp) require raster og:image.
// Sources live in src/assets/og; outputs land in public/ and are gitignored.
function rasterizeOG(): Plugin {
  const srcDir = resolve(HERE, "src/assets/og");
  const outDir = resolve(HERE, "public");
  // resvg-js / usvg 0.34 ignores the wght axis on variable fonts — every
  // weight renders at the file's default. Ship static instances at the
  // weights the SVGs request (Regular 400, Medium 500, Bold 700) so resvg's
  // weight matcher picks the right face. Generated from the upstream
  // Lexend variable font via fontTools.varLib.instancer with
  // updateFontNames=True; see Lexend.OFL.txt for the license.
  const fontFiles = ["Lexend-Regular.ttf", "Lexend-Medium.ttf", "Lexend-Bold.ttf"].map((f) => resolve(srcDir, f));
  const variants = ["og-image", "og-invite"] as const;

  let done = false;
  return {
    name: "rasterize-og",
    async buildStart() {
      if (done) return;
      const { Resvg } = await import("@resvg/resvg-js");
      for (const name of variants) {
        const template = await readFile(resolve(srcDir, `${name}.svg`), "utf8");
        const resvg = new Resvg(template, { font: { fontFiles } });
        const png = resvg.render().asPng();
        await writeFile(resolve(outDir, `${name}.png`), png);
      }
      done = true;
    },
  };
}

/**
 * Sidecar plugin that owns dev-time server lifecycle:
 *   - opens the Postgres pool, builds the GroupStore/SyncStore/QuestionStore trio
 *   - builds the Vite-aware SPA shell renderer
 *   - publishes state + shell on `globalThis` so the dev-entry (loaded by
 *     @hono/vite-dev-server below) picks up the same instances.
 *
 * Loads server modules via Vite's `ssrLoadModule` so they're TS-transformed and
 * cached against the same module graph the @hono/vite-dev-server plugin uses —
 * keeping class identities consistent across both sides.
 */
function spreadsheetDev(): Plugin {
  let cleanup: (() => Promise<void>) | null = null;
  return {
    name: "spreadsheet-dev",
    apply: "serve",
    // `'pre'` orders this plugin before unenforced user plugins per Vite's
    // documented resolution order (Vite docs: "User plugins with enforce:
    // 'pre' → … → User plugins without enforce value"). @hono/vite-dev-server
    // is unenforced, so it runs after this. In practice we'd survive without
    // it — @hono/vite-dev-server lazy-loads the dev entry on first request,
    // which is well after every plugin's configureServer has run — but the
    // `enforce: 'pre'` declares the dependency rather than relying on the
    // lifecycle accident.
    enforce: "pre",
    async configureServer(server) {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new Error("DATABASE_URL required for `pnpm dev` — see scripts/dev.ts");
      }

      const stateModule = (await server.ssrLoadModule(SERVER_DEV_STATE)) as typeof import("../server/src/dev/state.js");
      const shellModule = (await server.ssrLoadModule(SERVER_DEV_SHELL)) as typeof import("../server/src/dev/shell.js");

      const state = stateModule.createDevState({ databaseUrl });
      const shell = shellModule.createDevShell({ viteServer: server, webRoot: HERE });

      // Publish before any request arrives. @hono/vite-dev-server is
      // registered after this plugin, so its first ssrLoadModule(entry) call
      // (lazy-on-first-request) sees the populated globals.
      globalThis.__spreadsheetDevState = state;
      globalThis.__spreadsheetDevShell = shell;

      cleanup = async () => {
        await state.close();
      };
    },
    async closeBundle() {
      await cleanup?.();
      cleanup = null;
    },
  };
}

export default defineConfig({
  plugins: [
    // HTTPS in dev so the browser uses HTTP/2 to localhost (Vite serves
    // h2 when `server.https` is set; cleartext h2c isn't supported by any
    // browser, so HTTPS is the only path to /2 locally). Each developer
    // gets a self-signed cert in a per-checkout cache; the first browser
    // load shows a warning to accept once.
    //
    // Why we want HTTP/2 in dev specifically: subscriptions are SSE-per-
    // stream (see PR #139), three concurrent streams per tab. HTTP/1.1's
    // 6-per-origin connection cap starves at 3+ same-origin tabs (which
    // happens during cross-device-hydration testing and ad-hoc multi-tab
    // sync work). HTTP/2 lifts the cap to ~100 streams per connection.
    basicSsl(),
    spreadsheetDev(),
    devServer({
      adapter: nodeAdapter,
      entry: SERVER_DEV_ENTRY,
      // The plugin's built-in HMR client injector appends a second
      // `import("/@vite/client")` script onto every HTML response — but our
      // dev shell already runs `viteServer.transformIndexHtml(...)` which
      // injects the proper `<script type="module" src="/@vite/client">` tag
      // AND the React Refresh runtime hook. The plugin's append is a
      // duplicate (you can see two `[vite] connecting…` lines per load) and
      // skips React Refresh entirely. Off here, transformIndexHtml wins.
      injectClientScript: false,
      // Paths Vite owns in dev — bypass Hono and let Vite's static/module
      // middlewares handle them. Everything else (including SPA navigation
      // routes like /, /setup, /p/:token, plus the Hono-generated
      // /env-config.js) reaches createApp.
      //
      // The `(?!env-config\.js)` negative lookahead is the load-bearing bit:
      // /env-config.js has no file in public/ — it's generated on each
      // request by createApp's route. Without the exception, the bare-
      // extension pattern would match it, Vite would fall through to
      // serving index.html, the browser would interpret HTML as JS, and
      // window.__ENV would never exist.
      exclude: [
        /^\/@/,
        /^\/node_modules\//,
        /^\/src\//,
        /\?(import|worker|raw|url)(&|$)/,
        /^\/(?!env-config\.js$)[^/]+\.[^/]+$/,
      ],
    }),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routeFileIgnorePattern: "\\.(test|spec)\\.",
    }),
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", {}]],
      },
    }),
    svgr(),
    tailwindcss(),
    rasterizeOG(),
    compression({ algorithm: "gzip" }),
    compression({ algorithm: "brotliCompress" }),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html}"],
        // env-config.js is generated by the server at runtime — never bundle
        // it. Precaching would freeze build-time defaults forever after the
        // SW installs. (Nothing under that name actually lands in dist/, but
        // an explicit ignore guards against a future accidental stub.)
        globIgnores: ["env-config.js"],
        // /p/:token is a server-handled bootstrap route — it sets the session
        // cookie on the response. If the SW navigation fallback intercepts
        // and serves cached index.html, the cookie never gets set. Force /p/*
        // to always hit the network.
        // /api/* must also bypass the fallback. tRPC calls are fetch/XHR and
        // never trigger navigation interception, but top-level navigations to
        // /api/out (the outbound click proxy, opened via <a target="_blank">)
        // do — without this, the SW serves index.html and the SPA renders its
        // 404 instead of the redirect ever reaching the server.
        // /health is a server liveness endpoint hit by orchestrators and by
        // humans visiting the URL directly; the SW would otherwise serve the
        // SPA shell and the JSON body never reaches the caller.
        // The file-extension regex is the canonical Workbox pattern for
        // skipping any URL whose final path segment looks like name.ext —
        // covers /og-image.png, /og-invite.png, /favicon.svg, /logo.svg,
        // /icon-{192,512}.png, /apple-touch-icon.png, /robots.txt,
        // /manifest.webmanifest, and /env-config.js. Safe because tokens are
        // base64url (no dots) and no SPA route has a file extension.
        navigateFallbackDenylist: [/^\/p\//, /^\/api\//, /^\/health$/, /\/[^/?]+\.[^/]+$/],
      },
      manifest: {
        name: "Spreadsheet",
        short_name: "Spreadsheet",
        description: "A yes/no/maybe list for couples and groups. Find the overlap.",
        theme_color: "#d08058",
        background_color: "#fdf9f5",
        display: "standalone",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
    }),
  ],
});
