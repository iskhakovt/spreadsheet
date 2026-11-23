import { describe, expect, it } from "vitest";
import { resolveRoute, shouldRedirectTo } from "./resolve-route.js";

const person = { name: "Alice", anatomy: "afab" as const, isAdmin: false, isCompleted: false };
const group = { isReady: true, isAdminReady: true, questionMode: "filtered" as const };

describe("resolveRoute", () => {
  it("sends a person with no name (or one that didn't open) to /setup before anything else", () => {
    expect(resolveRoute({ ...person, name: "" }, group, true, true)).toBe("/setup");
    expect(resolveRoute({ ...person, name: "", isCompleted: true }, group, false, true)).toBe("/setup");
  });

  it("sends a missing anatomy in a filtered group to /anatomy, even after completing", () => {
    expect(resolveRoute({ ...person, anatomy: null }, group, false, true)).toBe("/anatomy");
    expect(resolveRoute({ ...person, anatomy: null, isCompleted: true }, group, false, true)).toBe("/anatomy");
    expect(resolveRoute({ ...person, anatomy: null, isCompleted: true }, group, true, true)).toBe("/anatomy");
  });

  it("doesn't ask for anatomy in all-questions mode, or before the admin is ready", () => {
    expect(resolveRoute({ ...person, anatomy: null }, { ...group, questionMode: "all" }, false, true)).toBe(
      "/questions",
    );
    expect(resolveRoute({ ...person, anatomy: null }, { ...group, isAdminReady: false }, false, true)).toBe("/pending");
  });

  it("keeps the usual order otherwise", () => {
    expect(resolveRoute(person, group, true, true)).toBe("/results");
    expect(resolveRoute({ ...person, isCompleted: true }, group, false, true)).toBe("/waiting");
    expect(resolveRoute({ ...person, isAdmin: true }, { ...group, isAdminReady: false }, false, true)).toBe("/group");
    expect(resolveRoute(person, { ...group, isReady: false }, false, true)).toBe("/pending");
    expect(resolveRoute(person, group, false, false)).toBe("/intro");
    expect(resolveRoute(person, group, false, true)).toBe("/questions");
  });
});

describe("shouldRedirectTo", () => {
  it("leaves people on free routes they chose", () => {
    expect(shouldRedirectTo("/questions", "/waiting")).toBe(false);
    expect(shouldRedirectTo("/summary", "/results")).toBe(false);
  });

  it("pulls people off free routes when a profile field needs recovering", () => {
    expect(shouldRedirectTo("/questions", "/setup")).toBe(true);
    expect(shouldRedirectTo("/summary", "/anatomy")).toBe(true);
  });

  it("redirects from other routes, and never to where you already are", () => {
    expect(shouldRedirectTo("/intro", "/questions")).toBe(true);
    expect(shouldRedirectTo("/setup", "/setup")).toBe(false);
    expect(shouldRedirectTo("/intro", null)).toBe(false);
  });
});
