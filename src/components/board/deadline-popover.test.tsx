// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeadlinePopover } from "./deadline-popover";

afterEach(cleanup);

/** A Thursday, so "Tomorrow" is Sep 11. */
const TODAY = "2026-09-10";

describe("DeadlinePopover", () => {
  it("keeps the id and the empty label", () => {
    render(<DeadlinePopover id="todo-deadline" value={null} today={TODAY} onChange={vi.fn()} />);
    const trigger = document.getElementById("todo-deadline")!;
    expect(trigger.textContent).toContain("No deadline");
    expect(screen.queryByRole("button", { name: "Clear date" })).toBeNull();
  });

  it("offers the Quick dates group above the calendar, and no time or repeat", () => {
    render(<DeadlinePopover id="todo-deadline" value={null} today={TODAY} onChange={vi.fn()} />);
    fireEvent.click(document.getElementById("todo-deadline")!);
    expect(screen.getByRole("group", { name: "Quick dates" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Time" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Repeat" })).toBeNull();
  });

  it("saves a quick pick and closes", () => {
    const onChange = vi.fn();
    render(<DeadlinePopover id="todo-deadline" value={null} today={TODAY} onChange={onChange} />);
    fireEvent.click(document.getElementById("todo-deadline")!);
    const rows = within(screen.getByRole("group", { name: "Quick dates" }));
    fireEvent.click(rows.getByRole("button", { name: /Tomorrow/ }));
    expect(onChange).toHaveBeenCalledWith("2026-09-11");
    expect(screen.queryByRole("group", { name: "Quick dates" })).toBeNull();
  });

  it("clears with null", () => {
    const onChange = vi.fn();
    render(<DeadlinePopover value="2026-09-20" today={TODAY} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear date" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
