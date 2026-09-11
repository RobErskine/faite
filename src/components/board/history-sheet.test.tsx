// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HistorySheet } from "./history-sheet";
import type { DayNote, TodoEvent, Todo } from "@/lib/schema";

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

function Harness({
  day = DAY,
  onSelectDay = () => {},
  onOpenTodo = () => {},
  dayNotes = new Map<string, DayNote>(),
}: {
  day?: string;
  onSelectDay?: (day: string) => void;
  onOpenTodo?: (id: string) => void;
  dayNotes?: ReadonlyMap<string, DayNote>;
}) {
  return (
    <HistorySheet
      day={day}
      today={TODAY}
      timezone="UTC"
      dayNotes={dayNotes}
      listsById={new Map()}
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

  it("shows the day's note", () => {
    const note = { id: `daynote:${DAY}`, date: DAY, body: "Good day." } as DayNote;
    render(<Harness dayNotes={new Map([[DAY, note]])} />);
    expect((screen.getByRole("textbox", { name: /^Notes for/ }) as HTMLTextAreaElement).value).toBe(
      "Good day.",
    );
  });
});
