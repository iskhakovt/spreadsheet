/** @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TipJarLink } from "./tip-jar-link.js";

afterEach(() => {
  cleanup();
  delete window.__ENV;
});

beforeEach(() => {
  delete window.__ENV;
});

describe("TipJarLink — URL safety", () => {
  it("renders nothing when TIP_JAR_URL is unset", () => {
    render(createElement(TipJarLink));
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders nothing when TIP_JAR_URL is null", () => {
    window.__ENV = { TIP_JAR_URL: null };
    render(createElement(TipJarLink));
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders an http(s) URL", () => {
    window.__ENV = { TIP_JAR_URL: "https://buymeacoffee.com/example" };
    render(createElement(TipJarLink));
    const link = screen.getByRole("link") as HTMLAnchorElement;
    expect(link.href).toBe("https://buymeacoffee.com/example");
    expect(link.rel).toContain("noopener");
    expect(link.rel).toContain("noreferrer");
    expect(link.target).toBe("_blank");
  });

  it("rejects javascript: URLs (XSS guard)", () => {
    window.__ENV = { TIP_JAR_URL: "javascript:alert(1)" };
    render(createElement(TipJarLink));
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("rejects data: URLs", () => {
    window.__ENV = { TIP_JAR_URL: "data:text/html,<script>alert(1)</script>" };
    render(createElement(TipJarLink));
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("rejects file: URLs and other non-web schemes", () => {
    window.__ENV = { TIP_JAR_URL: "file:///etc/passwd" };
    render(createElement(TipJarLink));
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("rejects malformed URLs (URL constructor throws)", () => {
    window.__ENV = { TIP_JAR_URL: "not a url at all" };
    render(createElement(TipJarLink));
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("rejects empty string (treated as unset)", () => {
    window.__ENV = { TIP_JAR_URL: "" };
    render(createElement(TipJarLink));
    expect(screen.queryByRole("link")).toBeNull();
  });
});
