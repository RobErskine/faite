// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OVERDRIVE_MIN_TODOS } from "@/lib/overdrive";
import { DayOverdriveButton, OverdriveButton } from "./overdrive-button";

afterEach(cleanup);

/**
 * `minTodos` (EI-103) is a thin prop threaded from
 * `settings.overdriveMinTodos` (`desktop-board.tsx`/`phone-board.tsx`); see
 * docs/OVERDRIVE.md §1. This file is the one place the threshold's own
 * gating logic (`count < minTodos`) gets a direct unit test, rather than
 * only the incidental coverage `board-column.test.tsx`'s "footer" block
 * gives it via a stub.
 */
describe("OverdriveButton", () => {
  it("renders nothing below the default threshold", () => {
    render(<OverdriveButton count={OVERDRIVE_MIN_TODOS - 1} onOpen={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders at the default threshold", () => {
    render(<OverdriveButton count={OVERDRIVE_MIN_TODOS} onOpen={vi.fn()} />);
    expect(screen.getByRole("button")).toBeTruthy();
  });

  it("honours an explicit minTodos below the default", () => {
    render(<OverdriveButton count={2} minTodos={2} onOpen={vi.fn()} />);
    expect(screen.getByRole("button")).toBeTruthy();
  });

  it("honours an explicit minTodos above the default — still hidden just under it", () => {
    render(<OverdriveButton count={9} minTodos={10} onOpen={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("calls onOpen when clicked", () => {
    const onOpen = vi.fn();
    render(<OverdriveButton count={10} minTodos={5} onOpen={onOpen} />);
    screen.getByRole("button").click();
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

/**
 * `DayOverdriveButton` (EI-253) — a day column's own entry point, passed as
 * `BoardColumn`'s `actions` slot. Shares `OverdriveButton`'s threshold rule
 * (`count < minTodos`) but nothing else about its rendering, so it gets its
 * own suite rather than a shared one.
 */
describe("DayOverdriveButton", () => {
  it("renders nothing below the default threshold", () => {
    render(
      <DayOverdriveButton
        count={OVERDRIVE_MIN_TODOS - 1}
        label="Monday, Aug 11"
        onOpen={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders at the default threshold", () => {
    render(
      <DayOverdriveButton count={OVERDRIVE_MIN_TODOS} label="Monday, Aug 11" onOpen={vi.fn()} />,
    );
    expect(screen.getByRole("button")).toBeTruthy();
  });

  it("honours an explicit minTodos", () => {
    render(<DayOverdriveButton count={2} minTodos={2} label="Tuesday, Aug 12" onOpen={vi.fn()} />);
    expect(screen.getByRole("button")).toBeTruthy();
  });

  it("calls onOpen when clicked", () => {
    const onOpen = vi.fn();
    render(
      <DayOverdriveButton count={10} minTodos={5} label="Wednesday, Aug 13" onOpen={onOpen} />,
    );
    screen.getByRole("button").click();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("accessible name carries both the day label and the count", () => {
    render(
      <DayOverdriveButton count={7} minTodos={5} label="Wednesday, Aug 13" onOpen={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /wednesday, aug 13.*7/i })).toBeTruthy();
  });
});
