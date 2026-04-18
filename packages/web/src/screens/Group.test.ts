import { describe, expect, it } from "vitest";
import { pickPrimaryCta } from "./Group.js";

describe("pickPrimaryCta", () => {
  it("returns 'start' before the group is ready, regardless of admin progress", () => {
    // Pre-ready the screen still serves the first-run invite flow —
    // any per-admin progress signal should be ignored.
    expect(pickPrimaryCta({ isReady: false, person: { isCompleted: false }, hasAnswers: false })).toBe("start");
    expect(pickPrimaryCta({ isReady: false, person: { isCompleted: true }, hasAnswers: true })).toBe("start");
  });

  it("returns 'view' when the admin has marked themselves complete", () => {
    expect(pickPrimaryCta({ isReady: true, person: { isCompleted: true }, hasAnswers: true })).toBe("view");
    expect(pickPrimaryCta({ isReady: true, person: { isCompleted: true }, hasAnswers: false })).toBe("view");
  });

  it("returns 'continue' for an in-progress admin (some answers, not done)", () => {
    expect(pickPrimaryCta({ isReady: true, person: { isCompleted: false }, hasAnswers: true })).toBe("continue");
  });

  it("returns 'start' for a ready admin who hasn't answered anything yet", () => {
    expect(pickPrimaryCta({ isReady: true, person: { isCompleted: false }, hasAnswers: false })).toBe("start");
  });
});
