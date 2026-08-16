// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ColorPicker } from "./color-picker";

beforeAll(() => {
  // Base UI's Popover positioner reaches for this, same as every other
  // floating-ui-backed popup stubbed elsewhere in this suite.
  Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

const GRASS = "#46a758";
const BLUE = "#3e63dd";

describe("ColorPicker — resting trigger", () => {
  it("reads \"None\" with no value and no inherited color", () => {
    render(<ColorPicker value={null} onChange={vi.fn()} label="List color" />);
    expect(screen.getByRole("button", { name: "List color" }).textContent).toContain("None");
  });

  it("reads the preset's name when a value is set", () => {
    render(<ColorPicker value={GRASS} onChange={vi.fn()} label="List color" />);
    expect(screen.getByRole("button", { name: "List color" }).textContent).toContain("Grass");
  });

  it("reads the tab's preset name, suffixed, when unset but inherited", () => {
    render(
      <ColorPicker
        value={null}
        inheritedColor={GRASS}
        onChange={vi.fn()}
        label="List color"
      />,
    );
    expect(screen.getByRole("button", { name: "List color" }).textContent).toContain(
      "Grass (from tab)",
    );
  });

  it("prefers its own value over an inherited one", () => {
    render(
      <ColorPicker
        value={BLUE}
        inheritedColor={GRASS}
        onChange={vi.fn()}
        label="List color"
      />,
    );
    const text = screen.getByRole("button", { name: "List color" }).textContent ?? "";
    expect(text).toContain("Blue");
    expect(text).not.toContain("from tab");
  });

  it("reads \"Custom (from tab)\" when the inherited color matches no preset", () => {
    render(
      <ColorPicker
        value={null}
        inheritedColor="#123456"
        onChange={vi.fn()}
        label="List color"
      />,
    );
    expect(screen.getByRole("button", { name: "List color" }).textContent).toContain(
      "Custom (from tab)",
    );
  });
});

describe("ColorPicker — popover contents", () => {
  it("never marks the grid pressed for an inherited-only color, and keeps Clear disabled", () => {
    render(
      <ColorPicker
        value={null}
        inheritedColor={GRASS}
        onChange={vi.fn()}
        label="List color"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "List color" }));
    expect(
      screen.getByRole("button", { name: "Grass" }).getAttribute("aria-pressed"),
    ).toBe("false");
    expect(screen.getByRole("button", { name: "Clear color" })).toHaveProperty("disabled", true);
  });

  it("marks the grid pressed and enables Clear for a list's own stored color", () => {
    render(<ColorPicker value={GRASS} onChange={vi.fn()} label="List color" />);
    fireEvent.click(screen.getByRole("button", { name: "List color" }));
    expect(
      screen.getByRole("button", { name: "Grass" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByRole("button", { name: "Clear color" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("clearing an owned color reports null, landing back on the inherited display", () => {
    const onChange = vi.fn();
    render(
      <ColorPicker
        value={GRASS}
        inheritedColor={BLUE}
        onChange={onChange}
        label="List color"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "List color" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear color" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
