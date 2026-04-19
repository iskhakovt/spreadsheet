/** @vitest-environment happy-dom */
import type { Anatomy } from "@spreadsheet/shared";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnatomyPicker } from "./AnatomyPicker.js";

const LABELS: Record<Anatomy, string> = {
  amab: "AMAB label",
  afab: "AFAB label",
  both: "Both label",
  none: "None label",
};

afterEach(() => {
  cleanup();
});

describe("AnatomyPicker — show-more branch", () => {
  it("renders exactly the 2 default options when collapsed", () => {
    render(createElement(AnatomyPicker, { selected: "", onSelect: vi.fn(), labels: LABELS }));

    expect(screen.queryByRole("radio", { name: LABELS.amab })).not.toBeNull();
    expect(screen.queryByRole("radio", { name: LABELS.afab })).not.toBeNull();
    expect(screen.queryByRole("radio", { name: LABELS.both })).toBeNull();
    expect(screen.queryByRole("radio", { name: LABELS.none })).toBeNull();
  });

  it("expands to 4 options when 'Show more options' is clicked", () => {
    render(createElement(AnatomyPicker, { selected: "", onSelect: vi.fn(), labels: LABELS }));

    const toggle = screen.getByRole("button", { name: /show more options/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    act(() => {
      fireEvent.click(toggle);
    });

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toMatch(/show fewer options/i);
    expect(screen.queryByRole("radio", { name: LABELS.both })).not.toBeNull();
    expect(screen.queryByRole("radio", { name: LABELS.none })).not.toBeNull();
  });

  it("collapses back to 2 options when 'Show fewer options' is clicked", () => {
    render(createElement(AnatomyPicker, { selected: "", onSelect: vi.fn(), labels: LABELS }));

    const toggle = screen.getByRole("button", { name: /show more/i });
    act(() => {
      fireEvent.click(toggle);
    });
    act(() => {
      fireEvent.click(toggle);
    });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("radio", { name: LABELS.both })).toBeNull();
    expect(screen.queryByRole("radio", { name: LABELS.none })).toBeNull();
  });
});

describe("AnatomyPicker — selection", () => {
  it("calls onSelect with the clicked value", () => {
    const onSelect = vi.fn();
    render(createElement(AnatomyPicker, { selected: "", onSelect, labels: LABELS }));

    act(() => {
      fireEvent.click(screen.getByRole("radio", { name: LABELS.afab }));
    });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("afab");
  });

  it("marks the selected option with aria-checked=true, others false", () => {
    render(createElement(AnatomyPicker, { selected: "amab", onSelect: vi.fn(), labels: LABELS }));

    expect(screen.getByRole("radio", { name: LABELS.amab }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: LABELS.afab }).getAttribute("aria-checked")).toBe("false");
  });

  it("selecting an expanded-only option (both/none) works in the 4-option view", () => {
    const onSelect = vi.fn();
    render(createElement(AnatomyPicker, { selected: "", onSelect, labels: LABELS }));

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /show more/i }));
    });
    act(() => {
      fireEvent.click(screen.getByRole("radio", { name: LABELS.both }));
    });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("both");
  });

  it("collapsing while 'both' is selected hides the selected option — no radio shows aria-checked=true", () => {
    // Documents the current behavior: `selected` is owned by the parent,
    // so after collapse the checked value still exists in state but isn't
    // rendered. Freezing this contract so a future refactor doesn't
    // accidentally reshape it without anyone noticing.
    render(createElement(AnatomyPicker, { selected: "both", onSelect: vi.fn(), labels: LABELS }));

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    for (const r of radios) {
      expect(r.getAttribute("aria-checked")).toBe("false");
    }
  });
});
