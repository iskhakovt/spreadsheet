import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { compression } from "vite-plugin-compression2";
import { VitePWA } from "vite-plugin-pwa";
import svgr from "vite-plugin-svgr";

// Rasterize the handcrafted og:image SVGs to PNG at build time.
// Messengers (Facebook, LinkedIn, iMessage, WhatsApp) require raster og:image.
// Sources live in src/assets/og; outputs land in public/ and are gitignored.
function rasterizeOG(): Plugin {
  const here = dirname(fileURLToPath(import.meta.url));
  const srcDir = resolve(here, "src/assets/og");
  const outDir = resolve(here, "public");
  const fontFile = resolve(srcDir, "Lexend.ttf");
  const bgFile = resolve(srcDir, "og-bg.svg");
  const variants = ["og-image", "og-invite"] as const;

  let done = false;
  return {
    name: "rasterize-og",
    async buildStart() {
      if (done) return;
      const { Resvg } = await import("@resvg/resvg-js");
      const bg = await readFile(bgFile, "utf8");
      // resvg-js has no filesystem context, so <image href="./og-bg.svg"/> can't
      // be resolved; inline the bg's inner SVG before rasterizing.
      const bgInner = bg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
      for (const name of variants) {
        const template = await readFile(resolve(srcDir, `${name}.svg`), "utf8");
        const composed = template.replace(/<image[^/]*href="\.\/og-bg\.svg"[^/]*\/>/, bgInner);
        const png = new Resvg(composed, { font: { fontFiles: [fontFile] } }).render().asPng();
        await writeFile(resolve(outDir, `${name}.png`), png);
      }
      done = true;
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    svgr(),
    tailwindcss(),
    rasterizeOG(),
    compression({ algorithm: "gzip" }),
    compression({ algorithm: "brotliCompress" }),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html}"],
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
  server: {
    proxy: {
      // tRPC subscriptions over WebSocket — must come before /api so the more
      // specific path matches first.
      "/api/trpc-ws": {
        target: "ws://localhost:8080",
        ws: true,
      },
      "/api": {
        target: "http://localhost:8080",
        configure: (proxy) => {
          // Return 503 instead of spamming console when backend is restarting
          proxy.on("error", (_err, _req, res) => {
            if ("writeHead" in res) {
              res.writeHead(503, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Backend unavailable" }));
            }
          });
        },
      },
    },
  },
});
