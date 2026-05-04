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
    // runtime-flippable flags (REQUIRE_ENCRYPTION).
    expect(res.headers()["cache-control"]).toBe("no-store");
    const body = await res.text();
    expect(body).toMatch(/^window\.__ENV=\{.*\};$/s);
    expect(body).toContain("REQUIRE_ENCRYPTION");
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

  test("loading / actually populates window.__ENV in the browser", async ({ page }) => {
    // Belt-and-suspenders for the parser-blocking script tag: HTTP text
    // assertions don't catch a regression where the file is served but
    // the browser refuses to execute it (CSP, MIME sniffing, etc.).
    await page.goto("/");
    const env = await page.evaluate(() => window.__ENV);
    expect(env).toBeDefined();
    expect(env).toHaveProperty("REQUIRE_ENCRYPTION");
  });

  test("CSP allows data: URIs in img-src for inline SVG backgrounds", async ({ request, baseURL }) => {
    // The body grain overlay in index.css uses an inline data:image/svg+xml
    // fractalNoise SVG as background-image, which browsers gate under img-src.
    // Tightening this back to `img-src 'self'` would silently break the texture
    // (no JS error, just a missing overlay).
    const res = await request.get(`${baseURL}/`);
    const csp = res.headers()["content-security-policy"];
    expect(csp).toBeDefined();
    expect(csp).toMatch(/img-src[^;]*\bdata:/);
  });

  test("landing page loads with no CSP violations", async ({ page }) => {
    // Catches any future CSP regression on the landing page — not just the
    // grain overlay. Browsers report CSP violations as console errors with
    // a recognizable prefix.
    const violations: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && /Content Security Policy/i.test(msg.text())) {
        violations.push(msg.text());
      }
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(violations).toEqual([]);
  });

  test("service worker precache manifest excludes /env-config.js", async ({ request, baseURL }) => {
    // If the SW ever precached env-config.js, flag flips would be
    // invisible to anyone whose SW already installed — they'd keep
    // serving the build-time stub forever. globIgnores in vite.config
    // is what prevents this; assert the result.
    const res = await request.get(`${baseURL}/sw.js`);
    expect(res.status()).toBe(200);
    expect(await res.text()).not.toContain("env-config");
  });
});
