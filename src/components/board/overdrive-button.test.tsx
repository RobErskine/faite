// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OVERDRIVE_MIN_TODOS } from "@/lib/overdrive";
import {
  DayOverdriveButton,
  OverdriveButton,
  QUICK_SORT_PHONE_HEADER,
  QuickSortButton,
} from "./overdrive-button";

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

  it("shows its accessible name as a tooltip on hover — the ⚡ is not left unlabeled (EI-383)", async () => {
    // In the app's own `TooltipProvider` (delay 0), as `app/layout.tsx` mounts it.
    render(
      <TooltipProvider>
        <DayOverdriveButton count={6} minTodos={5} label="Wednesday, Oct 14" onOpen={vi.fn()} />
      </TooltipProvider>,
    );
    const button = screen.getByRole("button", { name: "Overdrive Wednesday, Oct 14 — 6 to-dos" });
    fireEvent.mouseEnter(button);
    expect(await screen.findByText("Overdrive Wednesday, Oct 14 — 6 to-dos")).toBeTruthy();
  });

  it("and on keyboard focus", async () => {
    render(
      <DayOverdriveButton count={6} minTodos={5} label="Wednesday, Oct 14" onOpen={vi.fn()} />,
    );
    fireEvent.focus(screen.getByRole("button"));
    expect(await screen.findByText("Overdrive Wednesday, Oct 14 — 6 to-dos")).toBeTruthy();
  });
});

describe("QuickSortButton", () => {
  it("counts in the singular for one to-do (EI-377)", () => {
    render(<QuickSortButton count={1} onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Quick sort Backlog — 1 to-do" })).toBeTruthy();
  });

  it("and in the plural for more", () => {
    render(<QuickSortButton count={2} onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Quick sort Backlog — 2 to-dos" })).toBeTruthy();
  });

  it("shows the same words as a tooltip (EI-383)", async () => {
    render(
      <TooltipProvider>
        <QuickSortButton count={2} onOpen={vi.fn()} />
      </TooltipProvider>,
    );
    fireEvent.mouseEnter(screen.getByRole("button"));
    expect(await screen.findByText("Quick sort Backlog — 2 to-dos")).toBeTruthy();
  });
});

/**
 * EI-388. The ⚡ was 34×34 on a phone. Under a coarse pointer an `::after`
 * makes it 44×44: 5px top and bottom, 8px left, and only 2px right, because
 * the box already ends 2px short of the column's right edge. Classes, since
 * happy-dom has no layout.
 */
describe("header icon touch target (EI-388)", () => {
  it.each([
    ["DayOverdriveButton", <DayOverdriveButton key="d" count={6} label="Wednesday, Oct 14" onOpen={vi.fn()} />],
    ["QuickSortButton", <QuickSortButton key="q" count={2} onOpen={vi.fn()} />],
  ])("%s extends to 44px on touch without moving", (_name, element) => {
    render(<TooltipProvider>{element}</TooltipProvider>);
    const cls = screen.getByRole("button").className.split(/\s+/);
    expect(cls).toContain("relative");
    expect(cls).toContain("pointer-coarse:after:absolute");
    expect(cls).toContain("pointer-coarse:after:content-['']");
    expect(cls).toContain("pointer-coarse:after:-inset-y-[5px]");
    expect(cls).toContain("pointer-coarse:after:-left-2");
    expect(cls).toContain("pointer-coarse:after:-right-0.5");
    // The padding pair that makes the 34px box is unchanged.
    expect(cls).toContain("pointer-coarse:p-2.5");
    expect(cls).toContain("pointer-coarse:-m-2.5");
  });
});

/**
 * EI-392. In the phone Backlog header Quick sort measured 42 tall: the header
 * is 42px and the extender ran 2px under the first card's title. The phone's
 * class trims the coarse margin so the header grows to 44, then fits the
 * extender inside it: 6 up, 4 down, 10 left. The base classes must survive
 * the merge — only the axes it restates may change.
 */
describe("Quick sort in the phone Backlog header (EI-392)", () => {
  it("merges over the base without dropping it", () => {
    render(
      <TooltipProvider>
        <QuickSortButton count={2} onOpen={vi.fn()} className={QUICK_SORT_PHONE_HEADER} />
      </TooltipProvider>,
    );
    const cls = screen.getByRole("button").className.split(/\s+/);
    expect(cls).toContain("pointer-coarse:-my-1");
    expect(cls).toContain("pointer-coarse:-m-2.5");
    expect(cls).toContain("pointer-coarse:p-2.5");
    expect(cls).toContain("pointer-coarse:after:-top-1.5");
    expect(cls).toContain("pointer-coarse:after:-bottom-1");
    expect(cls).toContain("pointer-coarse:after:-left-2.5");
    expect(cls).not.toContain("pointer-coarse:after:-left-2");
    expect(cls).toContain("pointer-coarse:after:-right-0.5");
  });
});
