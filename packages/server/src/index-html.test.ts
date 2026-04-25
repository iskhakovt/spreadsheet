import { describe, expect, it } from "vitest";
import { renderIndex } from "./index-html.js";

const RAW = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Spreadsheet</title>
    <meta name="description" content="A yes/no/maybe list for couples and groups. Find the overlap." />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="Spreadsheet" />
    <meta property="og:image" content="/og-image.png" />
    <meta property="og:image:alt" content="Spreadsheet — find the overlap" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Spreadsheet" />
    <meta name="twitter:image" content="/og-image.png" />
    <script type="module" src="/assets/index-hash.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>`;

const INVITE = {
  ogImage: "/og-invite.png",
  ogTitle: "You’ve been invited · Spreadsheet",
  ogImageAlt: "Spreadsheet — your turn",
};

describe("renderIndex", () => {
  it("rewrites og:image and twitter:image in one call", () => {
    const out = renderIndex(RAW, INVITE);
    expect(out).toContain('<meta property="og:image" content="/og-invite.png"');
    expect(out).toContain('<meta name="twitter:image" content="/og-invite.png"');
    expect(out).not.toContain('content="/og-image.png"');
  });

  it("rewrites og:title and twitter:title in one call", () => {
    const out = renderIndex(RAW, INVITE);
    expect(out).toContain('<meta property="og:title" content="You’ve been invited · Spreadsheet"');
    expect(out).toContain('<meta name="twitter:title" content="You’ve been invited · Spreadsheet"');
  });

  it("rewrites og:image:alt", () => {
    const out = renderIndex(RAW, INVITE);
    expect(out).toContain('<meta property="og:image:alt" content="Spreadsheet — your turn"');
    expect(out).not.toContain("Spreadsheet — find the overlap");
  });

  it("preserves unrelated tags and body content", () => {
    const out = renderIndex(RAW, INVITE);
    expect(out).toContain('<meta charset="UTF-8"');
    expect(out).toContain('<meta property="og:type" content="website"');
    expect(out).toContain('<meta name="description"');
    expect(out).toContain('<script type="module" src="/assets/index-hash.js">');
    expect(out).toContain('<div id="root">');
    expect(out).toContain("<title>Spreadsheet</title>");
  });

  it("does not mutate the input string", () => {
    const before = RAW;
    renderIndex(RAW, INVITE);
    expect(RAW).toBe(before);
  });

  it("produces identical output when called with the same overrides", () => {
    expect(renderIndex(RAW, INVITE)).toBe(renderIndex(RAW, INVITE));
  });

  it("is tolerant when a meta tag is missing (no-op for that field)", () => {
    const stripped = RAW.replace(/<meta property="og:image:alt"[^>]*\/>\s*/, "");
    const out = renderIndex(stripped, INVITE);
    expect(out).toContain('content="/og-invite.png"');
    expect(out).not.toContain("og:image:alt");
  });
});
