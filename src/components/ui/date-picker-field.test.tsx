// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DatePickerField,
  civilDateToLocalDate,
  localDateToCivilDate,
} from "./date-picker-field";

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

/**
 * The bridge is the part that breaks silently. A `Date`-based off-by-one
 * shows up as "I set it to the 8th and it saved the 7th" for half the planet,
 * and only for some of the year, so it survives a casual click-through.
 *
 * These run under whatever zone the suite runs in (America/New_York locally
 * and in CI), but the round-trip property holds in every zone by
 * construction — local midnight out, local Y/M/D back.
 */
describe("civil date <-> local Date", () => {
  it("round-trips every day across a spring-forward transition", () => {
    // US DST begins 2026-03-08. The 8th is the 23-hour day.
    for (const date of ["2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09"]) {
      expect(localDateToCivilDate(civilDateToLocalDate(date))).toBe(date);
    }
  });

  it("round-trips every day across a fall-back transition", () => {
    // US DST ends 2026-11-01, the 25-hour day.
    for (const date of ["2026-10-31", "2026-11-01", "2026-11-02"]) {
      expect(localDateToCivilDate(civilDateToLocalDate(date))).toBe(date);
    }
  });

  it("round-trips a leap day and both year boundaries", () => {
    for (const date of ["2028-02-29", "2026-12-31", "2027-01-01"]) {
      expect(localDateToCivilDate(civilDateToLocalDate(date))).toBe(date);
    }
  });

  it("builds a LOCAL midnight, not a UTC one", () => {
    // `new Date("2026-08-07")` is UTC midnight — a different instant from
    // local midnight in every zone but UTC itself. Assert the PROPERTY (local
    // midnight, on the right day) rather than the inequality: CI runs in UTC,
    // where the two instants coincide and an inequality assertion fails on
    // correct code. That is what it did — this suite was written against
    // America/New_York and only ever run there.
    const local = civilDateToLocalDate("2026-08-07");
    expect(local.getHours()).toBe(0);
    expect(local.getMinutes()).toBe(0);
    expect(local.getFullYear()).toBe(2026);
    expect(local.getMonth()).toBe(7);
    expect(local.getDate()).toBe(7);
  });

  it("reads LOCAL parts on the way out, not UTC ones", () => {
    // The other half of the same trap: `.toISOString().slice(0, 10)` answers
    // in UTC. Which way it shifts depends on the sign of the offset — east of
    // Greenwich a local midnight is already the previous day, west of it a
    // local evening is already the next — and in UTC it does not shift at
    // all. So assert that the reader returns the LOCAL calendar day at both
    // ends of a day, which holds in every zone, instead of asserting a
    // specific disagreement that only exists in some.
    for (const hour of [0, 23]) {
      const at = new Date(2026, 7, 7, hour, 30, 0);
      expect(localDateToCivilDate(at)).toBe("2026-08-07");
    }
  });
});

describe("DatePickerField — resting trigger", () => {
  it("reads the placeholder with no value", () => {
    render(
      <DatePickerField value={null} onChange={vi.fn()} aria-label="Deadline" />,
    );
    expect(screen.getByRole("button", { name: "Deadline" }).textContent).toContain("No date");
  });

  it("reads the short date when a value is set", () => {
    render(
      <DatePickerField value="2026-08-07" onChange={vi.fn()} aria-label="Deadline" />,
    );
    expect(screen.getByRole("button", { name: "Deadline" }).textContent).toContain("Aug 7");
  });

  it("offers no clear button until there is something to clear", () => {
    const { rerender } = render(
      <DatePickerField value={null} onChange={vi.fn()} aria-label="Deadline" />,
    );
    expect(screen.queryByRole("button", { name: "Clear date" })).toBeNull();

    rerender(<DatePickerField value="2026-08-07" onChange={vi.fn()} aria-label="Deadline" />);
    expect(screen.getByRole("button", { name: "Clear date" })).toBeTruthy();
  });

  it("hides the clear button when clearable is off, value or not", () => {
    render(
      <DatePickerField
        value="2026-08-07"
        onChange={vi.fn()}
        clearable={false}
        aria-label="Deadline"
      />,
    );
    expect(screen.queryByRole("button", { name: "Clear date" })).toBeNull();
  });

  it("clears to null rather than to a date", () => {
    const onChange = vi.fn();
    render(
      <DatePickerField value="2026-08-07" onChange={onChange} aria-label="Deadline" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear date" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("takes an id a <label htmlFor> can address", () => {
    // `button` is a labelable element, which is what lets the sheet keep its
    // visible `<Label htmlFor="todo-deadline">` after the input became one.
    render(
      <DatePickerField id="todo-deadline" value={null} onChange={vi.fn()} aria-label="Deadline" />,
    );
    expect(screen.getByRole("button", { name: "Deadline" }).id).toBe("todo-deadline");
  });
});

describe("DatePickerField — picking a day", () => {
  it("emits the civil date of the day clicked", () => {
    const onChange = vi.fn();
    render(
      <DatePickerField value="2026-08-07" onChange={onChange} aria-label="Deadline" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Deadline" }));

    // react-day-picker renders each day as a gridcell button named by its
    // full date; "12" alone would also match "12" in another month's overflow.
    fireEvent.click(screen.getByRole("button", { name: /August 12(th)?, 2026/ }));
    expect(onChange).toHaveBeenCalledWith("2026-08-12");
  });

  it("opens on the selected month, not on today", () => {
    render(
      <DatePickerField value="2026-12-25" onChange={vi.fn()} aria-label="Deadline" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Deadline" }));
    expect(screen.getByRole("button", { name: /December 25(th)?, 2026/ })).toBeTruthy();
  });
});
