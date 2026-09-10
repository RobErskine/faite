// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DatePopover } from "./date-popover";
import type { RecurrenceInfo } from "./repeat-section";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { defaultRule } from "@/lib/recurrence";
import type { ReminderPreset, Todo } from "@/lib/schema";

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

/** A Thursday, so "This weekend" is two days out and "Next week" is four. */
const TODAY = "2026-09-10";

const todo = (overrides: Partial<Todo> = {}): Todo => ({
  id: "t1",
  ownerId: "local-user",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  title: "Call the vet",
  description: null,
  status: "open",
  priority: null,
  scheduledDate: null,
  scheduledAt: null,
  deadline: null,
  listId: null,
  projectId: null,
  labelIds: [],
  location: null,
  parentId: null,
  position: "a0",
  recurrenceRule: null,
  recurrenceParentId: null,
  completedAt: null,
  reminderTime: null,
  placeId: null,
  source: null,
  ...overrides,
});

const MORNING: ReminderPreset = {
  id: "p1",
  ownerId: "local-user",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  name: "In the morning",
  time: "08:00",
  position: "a0",
  color: null,
  emoji: "🌅",
  iconUrl: null,
};

const recurrence = (overrides: Partial<RecurrenceInfo> = {}): RecurrenceInfo => ({
  rule: { ...defaultRule("2026-09-07"), freq: "weekly", interval: 2, byDay: [1] },
  seriesStart: "2026-09-07",
  occurrenceDate: "2026-09-21",
  summary: "Every 2 weeks on Mon",
  nextDate: "2026-10-05",
  missedCount: null,
  onStop: vi.fn(),
  onChangeRule: vi.fn(),
  onRemoveSeries: vi.fn(),
  ...overrides,
});

function setup(props: Partial<Parameters<typeof DatePopover>[0]> = {}) {
  const onSave = vi.fn();
  render(
    <DatePopover
      id="todo-scheduled"
      todo={todo()}
      presets={[MORNING]}
      recurrence={null}
      today={TODAY}
      onSave={onSave}
      onOpenRepeat={vi.fn()}
      {...props}
    />,
  );
  return { onSave };
}

const trigger = () => document.getElementById("todo-scheduled")!;
const openPopover = () => fireEvent.click(trigger());

describe("DatePopover — the trigger says the whole schedule", () => {
  it("reads \"No date\" when nothing is set", () => {
    setup();
    expect(trigger().textContent).toContain("No date");
  });

  it("reads the short date when only a date is set", () => {
    setup({ todo: todo({ scheduledDate: "2026-09-14" }) });
    expect(trigger().textContent).toContain("Sep 14");
  });

  it("reads date and time together when a reminder is set", () => {
    setup({ todo: todo({ scheduledDate: "2026-09-14", reminderTime: "09:00" }) });
    const text = trigger().textContent ?? "";
    expect(text).toContain("Sep 14");
    expect(text).toContain("9:00");
  });

  it("marks a repeating to-do without spending the width on the rule", () => {
    // The rule is spelled out in the summary line under the field; at this
    // width it would truncate to nothing. The icon is the cue.
    setup({
      todo: todo({ scheduledDate: "2026-09-21" }),
      recurrence: recurrence(),
    });
    expect(trigger().textContent).toContain("Sep 21");
    expect(screen.getByRole("img", { name: "Repeats" })).toBeTruthy();
  });

  it("falls back to the rule when a series somehow has no date on this card", () => {
    setup({ todo: todo({ scheduledDate: null }), recurrence: recurrence() });
    expect(trigger().textContent).toContain("Every 2 weeks");
  });

  it("offers no clear button until there is a date to clear", () => {
    const { onSave } = setup({ todo: todo({ scheduledDate: "2026-09-14" }) });
    fireEvent.click(screen.getByRole("button", { name: "Clear date" }));
    // Clearing the date orphans the reminder, so both go.
    expect(onSave).toHaveBeenCalledWith("t1", { scheduledDate: null, reminderTime: null });
  });

  it("has no clear button with no date", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Clear date" })).toBeNull();
  });
});

describe("DatePopover — the four ways in", () => {
  it("commits a typed date on Enter", () => {
    const { onSave } = setup();
    openPopover();
    fireEvent.change(screen.getByLabelText("Type a date"), { target: { value: "next fri" } });
    fireEvent.keyDown(screen.getByLabelText("Type a date"), { key: "Enter" });
    // 2026-09-10 is a Thursday; "next fri" is the Friday after the coming one.
    expect(onSave).toHaveBeenCalledWith("t1", { scheduledDate: "2026-09-18" });
  });

  it("says so rather than silently ignoring an unparseable phrase", () => {
    setup();
    openPopover();
    fireEvent.change(screen.getByLabelText("Type a date"), { target: { value: "banana" } });
    expect(screen.getByText("Not a date we recognize.")).toBeTruthy();
  });

  it("keeps the named rows visible while typing", () => {
    // Typing narrows nothing here, so hiding them would only cost the user
    // their way back.
    setup();
    openPopover();
    fireEvent.change(screen.getByLabelText("Type a date"), { target: { value: "nope" } });
    expect(screen.getByRole("button", { name: /Tomorrow/ })).toBeTruthy();
  });

  it("shows the four named rows with where each one lands", () => {
    setup();
    openPopover();
    // Scoped to the group: the calendar below has a "Today" cell of its own.
    const rows = within(screen.getByRole("group", { name: "Quick dates" }));
    // Thursday Sep 10 -> weekend is Sat Sep 12, next week is Mon Sep 14.
    expect(rows.getByRole("button", { name: /^Today/ }).textContent).toContain("Thu");
    expect(rows.getByRole("button", { name: /^Tomorrow/ }).textContent).toContain("Fri");
    expect(rows.getByRole("button", { name: /^This weekend/ }).textContent).toContain("Sat");
    expect(rows.getByRole("button", { name: /^Next week/ }).textContent).toContain("Mon");
  });

  it("commits the named row's own resolved date", () => {
    const { onSave } = setup();
    openPopover();
    fireEvent.click(screen.getByRole("button", { name: /^This weekend/ }));
    expect(onSave).toHaveBeenCalledWith("t1", { scheduledDate: "2026-09-12" });
  });

  it("commits a day clicked on the calendar", () => {
    const { onSave } = setup({ todo: todo({ scheduledDate: "2026-09-14" }) });
    openPopover();
    fireEvent.click(screen.getByRole("button", { name: /September 23(rd)?, 2026/ }));
    expect(onSave).toHaveBeenCalledWith("t1", { scheduledDate: "2026-09-23" });
  });
});

describe("DatePopover — Time and Repeat", () => {
  it("keeps both disabled until there is a date to hang them on", () => {
    // A reminder resolves against `scheduledDate`, and a series needs a day
    // to anchor to — `createSeriesFromTodo` throws without one.
    setup();
    openPopover();
    expect(screen.getByRole("button", { name: /Time/ })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /Repeat/ })).toHaveProperty("disabled", true);
  });

  it("swaps to the reminder panel rather than opening a nested popup", () => {
    setup({ todo: todo({ scheduledDate: "2026-09-14" }) });
    openPopover();
    fireEvent.click(screen.getByRole("button", { name: /Time/ }));
    expect(document.getElementById("todo-reminder-input")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to date" })).toBeTruthy();
  });

  it("goes back to the date panel", () => {
    setup({ todo: todo({ scheduledDate: "2026-09-14" }) });
    openPopover();
    fireEvent.click(screen.getByRole("button", { name: /Time/ }));
    fireEvent.click(screen.getByRole("button", { name: "Back to date" }));
    expect(screen.getByLabelText("Type a date")).toBeTruthy();
  });

  it("asks the sheet to open the repeat dialog rather than nesting one", () => {
    const onOpenRepeat = vi.fn();
    setup({ todo: todo({ scheduledDate: "2026-09-14" }), onOpenRepeat });
    openPopover();
    fireEvent.click(screen.getByRole("button", { name: /Repeat/ }));
    expect(onOpenRepeat).toHaveBeenCalled();
    // And it closed itself on the way out, so the dialog is not opening
    // behind a popover that still has focus.
    expect(screen.queryByLabelText("Type a date")).toBeNull();
  });
});

describe("DatePopover — Escape closes exactly one layer at a time", () => {
  /**
   * The failure this guards against is silent: an unmounted `ComboboxEmpty`
   * makes the reminder combobox decline Escape, and the sheet three levels up
   * takes it instead — the whole sheet vanishes when the user meant to close
   * a dropdown. `docs/PICKERS.md` §2.
   */
  function setupNested() {
    const onOpenChange = vi.fn();
    render(
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent>
          <SheetTitle className="sr-only">Edit to-do</SheetTitle>
          <DatePopover
            id="todo-scheduled"
            todo={todo({ scheduledDate: "2026-09-14" })}
            presets={[MORNING]}
            recurrence={null}
            today={TODAY}
            onSave={vi.fn()}
            onOpenRepeat={vi.fn()}
          />
        </SheetContent>
      </Sheet>,
    );
    return { onOpenChange };
  }

  it("closes the combobox, then the popover, then the sheet — one key each", () => {
    const { onOpenChange } = setupNested();

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: /Time/ }));
    const reminder = document.getElementById("todo-reminder-input")!;
    fireEvent.input(reminder, { target: { value: "mor" }, inputType: "insertText" });

    // 1 — the combobox popup.
    fireEvent.keyDown(reminder, { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(document.getElementById("todo-reminder-input")).toBeTruthy();

    // 2 — the popover.
    fireEvent.keyDown(document.getElementById("todo-reminder-input")!, { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(document.getElementById("todo-reminder-input")).toBeNull();

    // 3 — and only now the sheet.
    fireEvent.keyDown(trigger(), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange.mock.calls[0][0]).toBe(false);
  });
});
