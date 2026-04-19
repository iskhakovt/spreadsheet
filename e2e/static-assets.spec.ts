import { expect, test } from "./fixtures.js";

test.describe("static assets + meta-tag variants", () => {
  test("/og-image.png serves the rasterized landing card", async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/og-image.png`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
  });

  test("/og-invite.png serves the rasterized invite card", async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/og-invite.png`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/png");
  });

  test("/robots.txt disallows /p/ and /api/", async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/robots.txt`);
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("Disallow: /p/");
    expect(body).toContain("Disallow: /api/");
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
});
