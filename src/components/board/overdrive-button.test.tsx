// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OVERDRIVE_MIN_TODOS } from "@/lib/overdrive";
import { OverdriveButton } from "./overdrive-button";

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
