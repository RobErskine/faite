// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { HelpSheet } from "./help-sheet";
import type { Hotkey } from "@/lib/keyboard";

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

const HOTKEYS: Hotkey[] = [
  {
    id: "command-palette",
    combo: "mod+k",
    label: "Open the command palette",
    group: "Navigation",
    run: () => {},
  },
  {
    id: "undo",
    combo: "mod+z",
    label: "Undo the last action",
    group: "Board",
    run: () => {},
  },
];

describe("HelpSheet", () => {
  it("renders nothing when closed", () => {
    render(<HelpSheet open={false} onOpenChange={() => {}} hotkeys={HOTKEYS} />);
    expect(screen.queryByText("Keyboard shortcuts")).toBeNull();
  });

  it("lists every registry hotkey under Global when open", () => {
    render(<HelpSheet open onOpenChange={() => {}} hotkeys={HOTKEYS} />);
    expect(screen.getByText("Keyboard shortcuts")).toBeTruthy();
    expect(screen.getByText("Open the command palette")).toBeTruthy();
    expect(screen.getByText("Undo the last action")).toBeTruthy();
  });

  it("renders a representative local shortcut under its own scope heading", () => {
    render(<HelpSheet open onOpenChange={() => {}} hotkeys={HOTKEYS} />);
    expect(screen.getByText("Overdrive")).toBeTruthy();
    expect(screen.getByText("Mark the current card done")).toBeTruthy();
  });

  it("renders combos through formatCombo, not a raw combo string", () => {
    render(<HelpSheet open onOpenChange={() => {}} hotkeys={HOTKEYS} />);
    // "mod+k" must never appear literally — it should render as a platform glyph.
    expect(screen.queryByText("mod+k")).toBeNull();
  });
});
