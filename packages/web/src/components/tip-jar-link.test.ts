/** @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { TipJarLink } from "./tip-jar-link.js";

afterEach(cleanup);

describe("TipJarLink", () => {
  it("links to the same-origin /api/out proxy with placement label", () => {
    render(createElement(TipJarLink, { placement: "landing" }));
    const link = screen.getByRole("link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/api/out?dest=tip&placement=landing");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
    expect(link.rel).toContain("noreferrer");
  });

  it("passes through the results placement", () => {
    render(createElement(TipJarLink, { placement: "results" }));
    const link = screen.getByRole("link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/api/out?dest=tip&placement=results");
  });
});
