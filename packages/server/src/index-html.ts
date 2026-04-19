import { parse as parseHtml } from "node-html-parser";

export interface MetaOverrides {
  ogImage: string;
  ogTitle: string;
  ogImageAlt: string;
}

/**
 * Mutate a built `index.html` to swap per-variant meta tags (og:image, og:title,
 * og:image:alt — plus their Twitter Card twins). Used to serve invite URLs
 * (`/p/:token`) with invite-framed preview cards instead of the landing defaults.
 */
export function renderIndex(raw: string, o: MetaOverrides): string {
  const doc = parseHtml(raw);
  for (const sel of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
    doc.querySelector(sel)?.setAttribute("content", o.ogImage);
  }
  for (const sel of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) {
    doc.querySelector(sel)?.setAttribute("content", o.ogTitle);
  }
  for (const sel of ['meta[property="og:image:alt"]', 'meta[name="twitter:image:alt"]']) {
    doc.querySelector(sel)?.setAttribute("content", o.ogImageAlt);
  }
  return doc.toString();
}
