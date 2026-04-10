import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emitGroupUpdate,
  emitJournalUpdate,
  groupEventName,
  groupEvents,
  journalEventName,
  journalEvents,
} from "./events.js";

describe("events (status)", () => {
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

describe("events (journal)", () => {
  afterEach(() => {
    journalEvents.removeAllListeners();
  });

  it("emits journal:<id> with the entries payload", () => {
    const handler = vi.fn();
    journalEvents.on("journal:abc", handler);
    const entries = [{ id: 1, personId: "p1", operation: "p:1:blob" }];
    emitJournalUpdate("abc", entries);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(entries);
  });

  it("is a no-op when entries is empty", () => {
    const handler = vi.fn();
    journalEvents.on("journal:abc", handler);
    emitJournalUpdate("abc", []);
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not fire listeners for other groups", () => {
    const handler = vi.fn();
    journalEvents.on("journal:abc", handler);
    emitJournalUpdate("def", [{ id: 1, personId: "p1", operation: "x" }]);
    expect(handler).not.toHaveBeenCalled();
  });

  it("delivers to all listeners on the same group", () => {
    const a = vi.fn();
    const b = vi.fn();
    journalEvents.on("journal:g1", a);
    journalEvents.on("journal:g1", b);
    emitJournalUpdate("g1", [{ id: 1, personId: "p1", operation: "x" }]);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("supports many concurrent listeners without warnings (max=0)", () => {
    expect(journalEvents.getMaxListeners()).toBe(0);
    const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    for (let i = 0; i < 50; i++) {
      journalEvents.on("journal:g2", () => {});
    }
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("journalEventName builds the correct key, separate from groupEvents", () => {
    expect(journalEventName("xyz")).toBe("journal:xyz");
    expect(journalEventName("xyz")).not.toBe(groupEventName("xyz"));
  });

  it("groupEvents and journalEvents are independent buses", () => {
    const groupHandler = vi.fn();
    const journalHandler = vi.fn();
    groupEvents.on("group:g1", groupHandler);
    journalEvents.on("journal:g1", journalHandler);

    emitGroupUpdate("g1");
    expect(groupHandler).toHaveBeenCalledTimes(1);
    expect(journalHandler).not.toHaveBeenCalled();

    emitJournalUpdate("g1", [{ id: 1, personId: "p1", operation: "x" }]);
    expect(journalHandler).toHaveBeenCalledTimes(1);
    expect(groupHandler).toHaveBeenCalledTimes(1); // not called again
  });
});
