import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { compression } from "vite-plugin-compression2";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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
        description: "Discover what you're both into",
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
