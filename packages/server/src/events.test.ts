import { afterEach, describe, expect, it, vi } from "vitest";
import { emitGroupUpdate, groupEventName, groupEvents } from "./events.js";

describe("events", () => {
  afterEach(() => {
    groupEvents.removeAllListeners();
  });

  it("emits group:<id> when emitGroupUpdate is called", () => {
    const handler = vi.fn();
    groupEvents.on("group:abc", handler);
    emitGroupUpdate("abc");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not fire listeners for other groups", () => {
    const handler = vi.fn();
    groupEvents.on("group:abc", handler);
    emitGroupUpdate("def");
    expect(handler).not.toHaveBeenCalled();
  });

  it("delivers to all listeners on the same group", () => {
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    groupEvents.on("group:g1", a);
    groupEvents.on("group:g1", b);
    groupEvents.on("group:g1", c);
    emitGroupUpdate("g1");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledTimes(1);
  });

  it("supports many concurrent listeners without warnings (max=0)", () => {
    expect(groupEvents.getMaxListeners()).toBe(0);
    // Attach 50 listeners — would warn at default 10
    const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    for (let i = 0; i < 50; i++) {
      groupEvents.on("group:g2", () => {});
    }
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("groupEventName builds the correct key", () => {
    expect(groupEventName("xyz")).toBe("group:xyz");
  });
});
