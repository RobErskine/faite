// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HistorySheet } from "./history-sheet";
import type { DayNote, List, TodoEvent, Todo } from "@/lib/schema";

/**
 * The sheet reads the log through two thin Dexie live-queries — mocked, so
 * each test controls exactly which events and to-dos the sheet sees. The
 * mock honors the `[start, end)` range, so a test also proves the sheet asks
 * for the right day.
 */
let eventsFixture: TodoEvent[] = [];
let todosFixture = new Map<string, Todo>();
vi.mock("@/lib/store/hooks", () => ({
  useEventsBetween: (start: string | null, end: string | null) =>
    start && end ? eventsFixture.filter((e) => e.at >= start && e.at < end) : [],
  useTodosById: (ids: readonly string[]) =>
    new Map([...todosFixture].filter(([id]) => ids.includes(id))),
}));

/** BlockNote needs layout APIs happy-dom lacks — same stub as `day-sheet.test.tsx`. */
vi.mock("@/components/ui/markdown-field", () => ({
  MarkdownField: ({ value, ariaLabel }: { value: string; ariaLabel: string }) => (
    <textarea aria-label={ariaLabel} defaultValue={value} />
  ),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  eventsFixture = [];
  todosFixture = new Map();
});
afterEach(cleanup);

const TODAY = "2026-09-11";
const DAY = "2026-09-09";

function event(todoId: string, kind: string, at: string, payload: object | null = null): TodoEvent {
  return {
    id: `${todoId}-${kind}-${at}`,
    ownerId: "u",
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    todoId,
    kind,
    at,
    payload: payload ? JSON.stringify({ v: 1, ...payload }) : null,
  };
}

function todo(id: string, title: string, deletedAt: string | null = null): Todo {
  return { id, title, deletedAt, listId: null } as Todo;
}

const GROCERIES = { id: "groceries", name: "Groceries", color: "#30a46c", tabId: null } as List;

function Harness({
  day = DAY,
  onSelectDay = () => {},
  onOpenTodo = () => {},
  dayNotes = new Map<string, DayNote>(),
  listsById = new Map<string, List>(),
}: {
  day?: string;
  onSelectDay?: (day: string) => void;
  onOpenTodo?: (id: string) => void;
  dayNotes?: ReadonlyMap<string, DayNote>;
  listsById?: ReadonlyMap<string, List>;
}) {
  return (
    <HistorySheet
      day={day}
      today={TODAY}
      timezone="UTC"
      dayNotes={dayNotes}
      listsById={listsById}
      backlog={undefined}
      tabsById={new Map()}
      onSelectDay={onSelectDay}
      onClose={() => {}}
      onSaveNote={() => {}}
      onOpenTodo={onOpenTodo}
    />
  );
}

describe("HistorySheet", () => {
  it("shows what got done, what got decided, and what was added on the day", () => {
    todosFixture = new Map([
      ["a", todo("a", "Write the report")],
      ["b", todo("b", "Call the bank")],
      ["c", todo("c", "Plan the trip")],
    ]);
    eventsFixture = [
      event("a", "done", `${DAY}T10:00:00.000Z`),
      event("b", "scheduled", `${DAY}T11:00:00.000Z`, { from: DAY, to: "2026-09-12" }),
      event("c", "created", `${DAY}T12:00:00.000Z`),
      // The day before: must not appear.
      event("c", "done", "2026-09-08T12:00:00.000Z"),
    ];
    render(<Harness />);

    const done = screen.getByRole("list", { name: /^Done on/ });
    expect(within(done).getByText("Write the report")).toBeTruthy();
    const decisions = screen.getByRole("list", { name: /^Decisions on/ });
    expect(within(decisions).getByText("Call the bank")).toBeTruthy();
    expect(within(decisions).getByText("Sep 9 → Sep 12")).toBeTruthy();
    const added = screen.getByRole("list", { name: /^Added on/ });
    expect(within(added).getByText("Plan the trip")).toBeTruthy();
    expect(screen.queryAllByText("Plan the trip")).toHaveLength(1);
  });

  it("never puts a count in a heading (docs/DESIGN.md §4)", () => {
    todosFixture = new Map([["a", todo("a", "Write the report")]]);
    eventsFixture = [event("a", "done", `${DAY}T10:00:00.000Z`)];
    render(<Harness />);
    for (const heading of screen.getAllByRole("heading", { level: 3 })) {
      expect(heading.textContent).not.toMatch(/\d+\s*(done|to-dos?)|\(\d+\)/i);
    }
  });

  it("opens a to-do from its row, but not a deleted one", () => {
    const onOpenTodo = vi.fn();
    todosFixture = new Map([
      ["a", todo("a", "Write the report")],
      ["gone", todo("gone", "Old idea", "2026-09-10T00:00:00.000Z")],
    ]);
    eventsFixture = [
      event("a", "done", `${DAY}T10:00:00.000Z`),
      event("gone", "done", `${DAY}T11:00:00.000Z`),
    ];
    render(<Harness onOpenTodo={onOpenTodo} />);

    fireEvent.click(screen.getByRole("button", { name: "Write the report" }));
    expect(onOpenTodo).toHaveBeenCalledWith("a");
    expect(screen.queryByRole("button", { name: "Old idea" })).toBeNull();
    expect(screen.getByText("Old idea")).toBeTruthy();
  });

  it("marks a decision made in Overdrive", () => {
    todosFixture = new Map([["a", todo("a", "Write the report")]]);
    eventsFixture = [event("a", "dropped", `${DAY}T10:00:00.000Z`, { via: "overdrive" })];
    render(<Harness />);
    expect(screen.getByText("In Overdrive")).toBeTruthy();
  });

  it("says so plainly when nothing happened", () => {
    render(<Harness />);
    expect(screen.getByText("Nothing finished or decided on this day.")).toBeTruthy();
  });

  it("adds 'yet' on today, where the day is not over (EI-323)", () => {
    render(<Harness day={TODAY} />);
    expect(screen.getByText("Nothing finished or decided on this day yet.")).toBeTruthy();
  });

  it("draws Today as a real button, with a border (EI-323)", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Today" }).className).toMatch(/\bborder\b/);
  });

  it("says where the log begins for a day before it", () => {
    render(<Harness day="2026-07-20" />);
    expect(screen.getByText("History starts Aug 1, 2026.")).toBeTruthy();
  });

  it("steps one day back, and cannot step past today", () => {
    const onSelectDay = vi.fn();
    const { unmount } = render(<Harness onSelectDay={onSelectDay} />);
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    expect(onSelectDay).toHaveBeenCalledWith("2026-09-08");
    unmount();

    render(<Harness day={TODAY} />);
    expect(screen.getByRole("button", { name: "Next day" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Today" })).toBeNull();
  });

  it("puts a dot on a calendar day where something was finished, and names it", () => {
    todosFixture = new Map([["a", todo("a", "Write the report")]]);
    eventsFixture = [event("a", "done", "2026-09-03T10:00:00.000Z")];
    render(<Harness />);
    expect(
      screen.getByRole("button", { name: "Thursday, September 3, something finished" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Friday, September 4" })).toBeTruthy();
  });

  it("tints a day by the list that got the most done, and names it (EI-323)", () => {
    todosFixture = new Map([["a", todo("a", "Buy milk")]]);
    eventsFixture = [event("a", "done", "2026-09-03T10:00:00.000Z", { listId: "groceries" })];
    render(<Harness listsById={new Map([["groceries", GROCERIES]])} />);

    const button = screen.getByRole("button", {
      name: "Thursday, September 3, something finished, mostly Groceries",
    });
    // The tint sits on the day cell, at the one fixed strength (`tint()`, 12%).
    expect((button.closest("td") as HTMLElement).style.backgroundColor).not.toBe("");
  });

  it("does not tint a day of Won't do", () => {
    todosFixture = new Map([["a", todo("a", "Buy milk")]]);
    eventsFixture = [event("a", "dropped", "2026-09-03T10:00:00.000Z", { listId: "groceries" })];
    render(<Harness listsById={new Map([["groceries", GROCERIES]])} />);
    expect(screen.queryByRole("button", { name: /mostly Groceries/ })).toBeNull();
  });

  it("opens a card on a day with completions: each list's count, most first, in its tint (EI-324)", async () => {
    const GARDEN = { id: "garden", name: "Garden", color: "#e5484d", tabId: null } as List;
    const INBOX = { id: "inbox", name: "Inbox", color: null, tabId: null } as List;
    eventsFixture = [
      event("a", "done", "2026-09-03T10:00:00.000Z", { listId: "garden" }),
      event("b", "done", "2026-09-03T11:00:00.000Z", { listId: "groceries" }),
      event("c", "done", "2026-09-03T12:00:00.000Z", { listId: "groceries" }),
      event("d", "done", "2026-09-03T13:00:00.000Z", { listId: "inbox" }),
      // Won't do is not counted.
      event("e", "dropped", "2026-09-03T14:00:00.000Z", { listId: "garden" }),
    ];
    render(
      <Harness
        listsById={
          new Map([
            ["groceries", GROCERIES],
            ["garden", GARDEN],
            ["inbox", INBOX],
          ])
        }
      />,
    );

    const day = screen.getByRole("button", { name: /^Thursday, September 3,/ });
    fireEvent.mouseEnter(day.parentElement!);
    const card = await screen.findByRole("list", { name: "Completed on Thursday, Sep 3, 2026" });
    const rows = within(card).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual(["2Groceries", "1Inbox", "1Garden"]);
    // The row's tint is the calendar's: set for a colored list, absent without one.
    expect(rows[0].style.backgroundColor).not.toBe("");
    expect(rows[1].style.backgroundColor).toBe("");
    // Counts per list, never the day's total.
    expect(card.parentElement!.textContent).not.toMatch(/\b4\b/);
  });

  it("gives no card to a day with nothing completed", () => {
    eventsFixture = [
      event("a", "dropped", "2026-09-03T10:00:00.000Z", { listId: "groceries" }),
      event("b", "done", "2026-09-04T10:00:00.000Z", { listId: "groceries" }),
    ];
    render(<Harness listsById={new Map([["groceries", GROCERIES]])} />);
    const trigger = (name: RegExp) =>
      screen.getByRole("button", { name }).closest("[data-slot=hover-card-trigger]");
    expect(trigger(/^Thursday, September 3/)).toBeNull();
    expect(trigger(/^Friday, September 4/)).not.toBeNull();
  });

  it("shows one month, a rolling quarter, or a rolling year (EI-323)", () => {
    render(<Harness />);
    expect(screen.getAllByRole("grid")).toHaveLength(1);

    fireEvent.click(screen.getByRole("tab", { name: "Quarter" }));
    expect(screen.getAllByRole("grid")).toHaveLength(3);
    // Rolling: the quarter ENDS at the day's month, Jul–Sep, not a calendar quarter.
    expect(screen.getByText("July 2026")).toBeTruthy();
    expect(screen.getByText("September 2026")).toBeTruthy();
    expect(screen.queryByText("October 2026")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Year" }));
    expect(screen.getAllByRole("grid")).toHaveLength(12);
    expect(screen.getByText("October 2025")).toBeTruthy();
  });

  it("keeps the quarter in place when the chosen day is already on screen", () => {
    const { rerender } = render(<Harness />);
    fireEvent.click(screen.getByRole("tab", { name: "Quarter" }));
    rerender(<Harness day="2026-07-20" />);
    expect(screen.getByText("September 2026")).toBeTruthy();
    expect(screen.queryByText("May 2026")).toBeNull();
  });

  it("shows the day's note", () => {
    const note = { id: `daynote:${DAY}`, date: DAY, body: "Good day." } as DayNote;
    render(<Harness dayNotes={new Map([[DAY, note]])} />);
    expect((screen.getByRole("textbox", { name: /^Notes for/ }) as HTMLTextAreaElement).value).toBe(
      "Good day.",
    );
  });
});
