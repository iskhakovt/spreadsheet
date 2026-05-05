import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type MetaOverrides, renderIndex } from "../index-html.js";
import type { ShellRenderer } from "../spa-routes.js";

/**
 * Structural slice of Vite's `ViteDevServer` — just the one method this
 * module calls. Avoids pulling `vite` into @spreadsheet/server's deps just
 * for a type that's only consumed at dev-time.
 */
interface ViteHtmlTransformer {
  transformIndexHtml(url: string, html: string): Promise<string>;
}

const INVITE_META: MetaOverrides = {
  ogImage: "/og-invite.png",
  ogTitle: "You’ve been invited · Spreadsheet",
  ogImageAlt: "Spreadsheet — your turn",
};

const DEFAULT_META: MetaOverrides = {
  ogImage: "/og-image.png",
  ogTitle: "Spreadsheet",
  ogImageAlt: "Spreadsheet — find the overlap",
};

/**
 * SPA-shell renderer for dev. Reads packages/web/index.html, swaps the meta
 * tags for the requested variant, then runs the result through Vite's
 * `transformIndexHtml` so the dev bundle entry, HMR client, and module
 * rewrites all wire up correctly. Re-reads on every request so editing
 * index.html doesn't require a restart.
 */
export function createDevShell(opts: { viteServer: ViteHtmlTransformer; webRoot: string }): ShellRenderer {
  const indexPath = resolve(opts.webRoot, "index.html");

  async function render(meta: MetaOverrides): Promise<string> {
    const raw = await readFile(indexPath, "utf-8");
    const flavoured = renderIndex(raw, meta);
    return opts.viteServer.transformIndexHtml("/", flavoured);
  }

  return {
    invite: () => render(INVITE_META),
    default: () => render(DEFAULT_META),
  };
}
