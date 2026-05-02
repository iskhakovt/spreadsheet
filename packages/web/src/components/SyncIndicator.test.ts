/** @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncIndicator } from "./SyncIndicator.js";

afterEach(() => {
  cleanup();
});

function visibility() {
  return (screen.getByRole("button", { hidden: true }) as HTMLButtonElement).style.visibility;
}

describe("SyncIndicator — visibility gating", () => {
  it("is hidden when nothing is pending and no sync is in flight", () => {
    render(createElement(SyncIndicator, { syncing: false, show: false, pendingCount: 0, onSync: vi.fn() }));
    expect(visibility()).toBe("hidden");
  });

  it("stays hidden during a fast sync before the 5s indicator delay fires", () => {
    render(createElement(SyncIndicator, { syncing: true, show: false, pendingCount: 1, onSync: vi.fn() }));
    expect(visibility()).toBe("hidden");
  });

  it("stays hidden when ops are pending but the 5s delay has not elapsed", () => {
    render(createElement(SyncIndicator, { syncing: false, show: false, pendingCount: 1, onSync: vi.fn() }));
    expect(visibility()).toBe("hidden");
  });

  it("becomes visible once show=true and ops are pending", () => {
    render(createElement(SyncIndicator, { syncing: false, show: true, pendingCount: 2, onSync: vi.fn() }));
    expect(visibility()).toBe("visible");
  });

  it("stays visible while a sync is in flight after show=true", () => {
    render(createElement(SyncIndicator, { syncing: true, show: true, pendingCount: 2, onSync: vi.fn() }));
    expect(visibility()).toBe("visible");
  });

  it("hides again once the queue drains, even if show is still true", () => {
    render(createElement(SyncIndicator, { syncing: false, show: true, pendingCount: 0, onSync: vi.fn() }));
    expect(visibility()).toBe("hidden");
  });
});
