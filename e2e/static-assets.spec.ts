import { expect, test } from "./fixtures.js";

test.describe("static assets + meta-tag variants", () => {
  test("/og-image.png serves the rasterized landing card", async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/og-image.png`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/^image\/png\b/i);
  });

  test("/og-invite.png serves the rasterized invite card", async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/og-invite.png`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/^image\/png\b/i);
  });

  test("/robots.txt disallows /p/, /api/, and /questions", async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/robots.txt`);
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("Disallow: /p/");
    expect(body).toContain("Disallow: /api/");
    // /questions is the public browser — accessible by direct URL but
    // shouldn't be indexed. The HTML noindex meta only renders post-hydration
    // (no SSR), so robots.txt is the canonical block for non-JS crawlers.
    expect(body).toContain("Disallow: /questions");
  });

  test("/ HTML advertises the landing og:image", async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('property="og:image" content="/og-image.png"');
    expect(html).toContain('name="twitter:image" content="/og-image.png"');
    expect(html).not.toContain("/og-invite.png");
  });

  test("/p/:token HTML advertises the invite og:image + title", async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/p/fake-token-just-for-meta`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('property="og:image" content="/og-invite.png"');
    expect(html).toContain('name="twitter:image" content="/og-invite.png"');
    expect(html).toContain("You\u2019ve been invited");
    expect(html).not.toContain('property="og:image" content="/og-image.png"');
  });

  test("/env-config.js sets window.__ENV with no-store caching", async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/env-config.js`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/^application\/javascript\b/i);
    // no-store: a stale CDN/proxy copy would defeat the whole point of
    // runtime-flippable flags (TIP_JAR_URL, REQUIRE_ENCRYPTION).
    expect(res.headers()["cache-control"]).toBe("no-store");
    const body = await res.text();
    expect(body).toMatch(/^window\.__ENV=\{.*\};$/s);
    // Both runtime keys are always present (default values when env vars unset).
    expect(body).toContain("REQUIRE_ENCRYPTION");
    expect(body).toContain("TIP_JAR_URL");
  });

  test("/ HTML references /env-config.js via parser-blocking script tag", async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/`);
    const html = await res.text();
    // Must be a <script src="...">, not inline, so CSP can stay
    // `script-src 'self'` with no per-deploy hash. No async/defer so
    // window.__ENV is set synchronously before the main bundle parses.
    expect(html).toContain('<script src="/env-config.js"></script>');
    expect(html).not.toMatch(/<script[^>]*>\s*window\.__ENV/);
  });
});
