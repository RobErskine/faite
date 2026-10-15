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
  visibleThrough: 6,
  canJumpBack: () => false,
  canJumpForward: () => false,
  onJump: () => {},
  onJumpToDate: () => {},
  onToday: () => {},
  onOpenHistory: () => {},
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

describe("DateNav history trigger (EI-322)", () => {
  afterEach(cleanup);

  for (const compact of [false, true]) {
    it(`renders in the ${compact ? "compact (phone)" : "full (desktop)"} branch, before the range`, () => {
      const onOpenHistory = vi.fn();
      render(
        <DateNav {...baseProps} compact={compact} onOpenActivity={() => {}} onOpenHistory={onOpenHistory} />,
      );
      const trigger = screen.getByRole("button", { name: "Open history" });
      // Earlier is to the left of now: the button precedes the range label.
      const heading = screen.getByRole("heading", { level: 1 });
      expect(trigger.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      fireEvent.click(trigger);
      expect(onOpenHistory).toHaveBeenCalledOnce();
    });
  }
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

/**
 * EI-374. On phone, Overflow is page −1 of the pager, so `anchorIndex` is −1
 * there — and `today + anchorIndex` titled the page with yesterday's date.
 */
describe("DateNav on the phone's Overflow page", () => {
  afterEach(cleanup);

  it("titles the page Overflow, not yesterday", () => {
    render(<DateNav {...baseProps} compact anchorIndex={-1} visibleCount={1} visibleThrough={0} onOpenActivity={() => {}} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Overflow");
  });

  it("offers Today as the way back", () => {
    const onToday = vi.fn();
    render(
      <DateNav {...baseProps} compact anchorIndex={-1} visibleCount={1} visibleThrough={0} onToday={onToday} onOpenActivity={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(onToday).toHaveBeenCalledOnce();
  });

  it("still titles today's page with today's date", () => {
    render(<DateNav {...baseProps} compact anchorIndex={0} visibleCount={1} visibleThrough={0} onOpenActivity={() => {}} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Aug 10");
    expect(screen.queryByRole("button", { name: "Today" })).toBeNull();
  });
});

describe("DateNav's Overflow peek — the phone pager's page indicator (EI-383)", () => {
  afterEach(cleanup);

  const peekProps = { ...baseProps, compact: true, visibleCount: 1, visibleThrough: 0, onOpenActivity: () => {} };

  it("shows '‹ Overflow 8' on today's page, named for what it does", () => {
    render(<DateNav {...peekProps} anchorIndex={0} overflowPeek={{ count: 8, onShow: () => {} }} />);
    const peek = screen.getByRole("button", { name: "Show Overflow, 8 to-dos" });
    expect(peek.textContent).toBe("Overflow8");
    // Leftmost, before History and the range: Overflow is the page to the left.
    const history = screen.getByRole("button", { name: "Open history" });
    expect(peek.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("takes you there", () => {
    const onShow = vi.fn();
    render(<DateNav {...peekProps} anchorIndex={0} overflowPeek={{ count: 8, onShow }} />);
    fireEvent.click(screen.getByRole("button", { name: /show overflow/i }));
    expect(onShow).toHaveBeenCalledOnce();
  });

  it("counts in the singular, and drops the count for an empty Overflow", () => {
    render(<DateNav {...peekProps} anchorIndex={0} overflowPeek={{ count: 1, onShow: () => {} }} />);
    expect(screen.getByRole("button", { name: "Show Overflow, 1 to-do" })).toBeTruthy();
    cleanup();
    render(<DateNav {...peekProps} anchorIndex={0} overflowPeek={{ count: 0, onShow: () => {} }} />);
    const empty = screen.getByRole("button", { name: "Show Overflow" });
    expect(empty.textContent).toBe("Overflow");
  });

  it("only on today's page — later days have Today, the Overflow page has its heading", () => {
    for (const anchorIndex of [-1, 1]) {
      render(<DateNav {...peekProps} anchorIndex={anchorIndex} overflowPeek={{ count: 8, onShow: () => {} }} />);
      expect(screen.queryByRole("button", { name: /show overflow/i })).toBeNull();
      cleanup();
    }
  });

  it("never in the desktop bar, where Overflow is a pinned rail you can see", () => {
    render(
      <DateNav {...baseProps} onOpenActivity={() => {}} overflowPeek={{ count: 8, onShow: () => {} }} />,
    );
    expect(screen.queryByRole("button", { name: /show overflow/i })).toBeNull();
  });

  it("draws in muted ink — no urgent red, no new color", () => {
    render(<DateNav {...peekProps} anchorIndex={0} overflowPeek={{ count: 8, onShow: () => {} }} />);
    const peek = screen.getByRole("button", { name: /show overflow/i });
    expect(peek.className).toContain("text-muted-foreground");
    expect(peek.innerHTML).not.toMatch(/urgent|spectrum/);
  });
});

/**
 * EI-384. The title ends at the last day actually on screen
 * (`visibleThrough`), not at `anchor + visibleCount - 1`: with a wide Today
 * the first page shows six days while the page size (what Week steps by)
 * is still seven.
 */
describe("DateNav range title", () => {
  afterEach(cleanup);

  it("ends at visibleThrough, independent of the page size", () => {
    render(<DateNav {...baseProps} visibleCount={7} visibleThrough={5} onOpenActivity={() => {}} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Aug 10 – Aug 15");
  });

  it("starts at the anchor on a later page", () => {
    render(
      <DateNav {...baseProps} anchorIndex={7} visibleCount={7} visibleThrough={13} onOpenActivity={() => {}} />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Aug 17 – Aug 23");
  });
});
