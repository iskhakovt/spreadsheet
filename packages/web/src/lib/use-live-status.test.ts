import { describe, expect, it } from "vitest";
import type { LiveGroupStatus } from "./decrypt-status.js";
import { statusEventBelongs } from "./use-live-status.js";

const slot = (personId: string) => ({ person: { id: personId } }) as LiveGroupStatus;

describe("statusEventBelongs", () => {
  it("accepts an event about the person the slot holds", () => {
    expect(statusEventBelongs(slot("alice"), { person: { id: "alice" } })).toBe(true);
  });

  it("rejects another person's event, e.g. the previous session's stream after a token switch", () => {
    expect(statusEventBelongs(slot("bob"), { person: { id: "alice" } })).toBe(false);
  });

  it("rejects events into an empty slot and events without a person", () => {
    expect(statusEventBelongs(undefined, { person: { id: "alice" } })).toBe(false);
    expect(statusEventBelongs(null, { person: { id: "alice" } })).toBe(false);
    expect(statusEventBelongs(slot("alice"), { person: null })).toBe(false);
  });
});
