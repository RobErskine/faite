// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { civilDateToLocalDate, daysBetweenLocalDates, DateNav, pageAlignedJump } from "./date-nav";

vi.mock("@/lib/store/mutate", () => ({ mutateSettings: vi.fn() }));

describe("civilDateToLocalDate", () => {
  it("builds a local midnight Date matching the civil date's parts", () => {
    const date = civilDateToLocalDate("2026-08-03");
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(7); // 0-indexed
    expect(date.getDate()).toBe(3);
    expect(date.getHours()).toBe(0);
  });
});

describe("daysBetweenLocalDates", () => {
  it("counts whole days between two local dates", () => {
    const from = civilDateToLocalDate("2026-08-03");
    const to = civilDateToLocalDate("2026-08-10");
    expect(daysBetweenLocalDates(from, to)).toBe(7);
  });

  it("is 0 for the same day", () => {
    const day = civilDateToLocalDate("2026-08-03");
    expect(daysBetweenLocalDates(day, day)).toBe(0);
  });

  it("is negative when `to` precedes `from`", () => {
    const from = civilDateToLocalDate("2026-08-10");
    const to = civilDateToLocalDate("2026-08-03");
    expect(daysBetweenLocalDates(from, to)).toBe(-7);
  });

  it("stays exact across a DST transition", () => {
    // US DST starts 2026-03-08 and ends 2026-11-01 — the same boundaries
    // scheduling.test.ts uses for its civil-date arithmetic.
    expect(
      daysBetweenLocalDates(
        civilDateToLocalDate("2026-03-07"),
        civilDateToLocalDate("2026-03-09"),
      ),
    ).toBe(2);
    expect(
      daysBetweenLocalDates(
        civilDateToLocalDate("2026-10-31"),
        civilDateToLocalDate("2026-11-02"),
      ),
    ).toBe(2);
  });

  it("crosses a month and year boundary", () => {
    expect(
      daysBetweenLocalDates(
        civilDateToLocalDate("2026-12-31"),
        civilDateToLocalDate("2027-01-01"),
      ),
    ).toBe(1);
  });
});

describe("pageAlignedJump", () => {
  it.each([
    // [view (page), Week base=7, Month base=30, Quarter base=90]
    [1, 7, 30, 90],
    [3, 6, 30, 90],
    [5, 5, 30, 90],
    [7, 7, 28, 91],
  ])("view of %i days quantizes Week/Month/Quarter to %i/%i/%i", (page, week, month, quarter) => {
    expect(pageAlignedJump(7, page)).toBe(week);
    expect(pageAlignedJump(30, page)).toBe(month);
    expect(pageAlignedJump(90, page)).toBe(quarter);
  });

  it("never quantizes to less than one page", () => {
    expect(pageAlignedJump(7, 30)).toBe(30);
  });

  it("defends against a non-positive page", () => {
    expect(pageAlignedJump(7, 0)).toBe(7);
    expect(pageAlignedJump(7, -3)).toBe(7);
  });
});

const baseProps = {
  settings: undefined,
  today: "2026-08-10" as const,
  anchorIndex: 0,
  visibleCount: 7,
  canJumpBack: () => false,
  canJumpForward: () => false,
  onJump: () => {},
  onJumpToDate: () => {},
  onToday: () => {},
};

describe("DateNav activity trigger", () => {
  afterEach(cleanup);

  it("renders in the full (desktop) branch and calls onOpenActivity", () => {
    const onOpenActivity = vi.fn();
    render(<DateNav {...baseProps} onOpenActivity={onOpenActivity} />);
    fireEvent.click(screen.getByRole("button", { name: "Open activity feed" }));
    expect(onOpenActivity).toHaveBeenCalledOnce();
  });

  it("renders in the compact (phone) branch and calls onOpenActivity", () => {
    const onOpenActivity = vi.fn();
    render(<DateNav {...baseProps} compact onOpenActivity={onOpenActivity} />);
    fireEvent.click(screen.getByRole("button", { name: "Open activity feed" }));
    expect(onOpenActivity).toHaveBeenCalledOnce();
  });
});

describe("DateNav jump buttons — page-aligned steps", () => {
  afterEach(cleanup);

  it("steps Month by 28 (not the raw 30) in the default 7-day view", () => {
    const onJump = vi.fn();
    render(
      <DateNav
        {...baseProps}
        visibleCount={7}
        canJumpForward={() => true}
        onJump={onJump}
        onOpenActivity={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(onJump).toHaveBeenCalledWith(28);
  });

  it("steps Month by the raw 30 in a 3-day view", () => {
    const onJump = vi.fn();
    render(
      <DateNav
        {...baseProps}
        visibleCount={3}
        canJumpForward={() => true}
        onJump={onJump}
        onOpenActivity={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(onJump).toHaveBeenCalledWith(30);
  });
});
