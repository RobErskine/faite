// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { civilDateToLocalDate, daysBetweenLocalDates, DateNav } from "./date-nav";

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
