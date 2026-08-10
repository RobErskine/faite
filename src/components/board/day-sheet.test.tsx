// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DaySheet } from "./day-sheet";
import type { DayNote, List, Todo } from "@/lib/schema";
import type { PlacementContext } from "@/lib/scheduling";

/**
 * BlockNote is ProseMirror, which needs layout APIs happy-dom does not have —
 * so the notes field is stubbed to a plain textarea here. What that leaves
 * untested (seeding, and the churn guard that stops an unedited body being
 * written back) is on the manual checklist in the plan, because it can only be
 * observed in a real browser anyway.
 */
vi.mock("@/components/ui/markdown-field", () => ({
  MarkdownField: ({
    value,
    ariaLabel,
    onCommit,
  }: {
    value: string;
    ariaLabel: string;
    onCommit: (next: string) => void;
  }) => (
    <textarea
      aria-label={ariaLabel}
      defaultValue={value}
      onBlur={(e) => onCommit(e.target.value)}
    />
  ),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

const DAY = "2026-08-10";

const ctx: PlacementContext = {
  today: DAY,
  visibleWindow: [DAY],
  workdaysOnly: false,
  workdays: [1, 2, 3, 4, 5],
  overflowAfterDays: 3,
};

const todo = (overrides: Partial<Todo> & { id: string }): Todo => ({
  ownerId: "local-user",
  createdAt: `${DAY}T09:00:00.000Z`,
  updatedAt: `${DAY}T09:00:00.000Z`,
  deletedAt: null,
  title: overrides.id,
  description: null,
  status: "open",
  priority: null,
  scheduledDate: DAY,
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
  ...overrides,
});

const list = (id: string, color: string | null): List => ({
  id,
  ownerId: "local-user",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  name: id,
  isBacklog: false,
  archivedAt: null,
  archivedWithTabId: null,
  position: "a0",
  tabId: null,
  color,
  emoji: null,
  iconUrl: null,
});

const note = (body: string): DayNote => ({
  id: `daynote:${DAY}`,
  ownerId: "local-user",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  date: DAY,
  body,
});

const RED = list("Errands", "#e5484d");

interface HarnessProps {
  day?: string | null;
  todos?: Todo[];
  note?: DayNote;
  onSaveNote?: (day: string, body: string) => void;
  onOpenTodo?: (todo: Todo) => void;
}

function Harness({ day = DAY, todos = [], ...rest }: HarnessProps) {
  return (
    <TooltipProvider>
      {/*
        NO DndContext, deliberately. The real board mounts this sheet outside its
        own context so the timeline's TodoCards cannot hijack dnd-kit's id maps,
        and this asserts that arrangement actually renders — `useSortable` has to
        be inert outside a provider rather than throwing.
      */}
      <DaySheet
        day={day}
        note={rest.note}
        todos={todos}
        timezone="UTC"
        labels={[]}
        listsById={new Map([[RED.id, RED]])}
        backlog={undefined}
        ctx={ctx}
        onClose={vi.fn()}
        onSaveNote={rest.onSaveNote ?? vi.fn()}
        onToggleTodo={vi.fn()}
        onOpenTodo={rest.onOpenTodo ?? vi.fn()}
      />
    </TooltipProvider>
  );
}

const entryLabels = () =>
  Array.from(document.querySelectorAll("ol > li > p")).map((el) =>
    el.textContent?.replace(/\s+/g, " ").trim(),
  );

describe("mounting", () => {
  it("renders outside a DndContext without throwing", () => {
    expect(() =>
      render(<Harness todos={[todo({ id: "a" })]} />),
    ).not.toThrow();
    expect(screen.getByText("a")).toBeTruthy();
  });

  it("renders nothing when no day is open", () => {
    render(<Harness day={null} />);
    expect(screen.queryByText("Timeline")).toBeNull();
  });

  it("shows the weekday and date in the header", () => {
    render(<Harness />);
    expect(screen.getByText("Monday")).toBeTruthy();
    expect(screen.getByText("Aug 10, 2026")).toBeTruthy();
  });
});

describe("notes", () => {
  it("seeds the field from the day's note", () => {
    render(<Harness note={note("# Standup\n\nShipped it.")} />);
    expect(
      screen.getByLabelText("Notes for Monday, Aug 10, 2026"),
    ).toHaveProperty("value", "# Standup\n\nShipped it.");
  });

  it("commits the day and the body on blur", () => {
    const onSaveNote = vi.fn();
    render(<Harness onSaveNote={onSaveNote} />);
    const field = screen.getByLabelText("Notes for Monday, Aug 10, 2026");
    fireEvent.blur(field, { target: { value: "rained all day" } });
    expect(onSaveNote).toHaveBeenCalledWith(DAY, "rained all day");
  });
});

describe("timeline", () => {
  it("reads as normal when the day is empty", () => {
    render(<Harness />);
    expect(screen.getByText("Nothing happened on this day yet.")).toBeTruthy();
  });

  it("labels created, completed, and won't-do entries", () => {
    render(
      <Harness
        todos={[
          todo({ id: "made", createdAt: `${DAY}T08:00:00.000Z` }),
          todo({
            id: "finished",
            createdAt: "2026-08-01T00:00:00.000Z",
            status: "done",
            completedAt: `${DAY}T09:00:00.000Z`,
          }),
          todo({
            id: "abandoned",
            createdAt: "2026-08-01T00:00:00.000Z",
            status: "dropped",
            completedAt: `${DAY}T10:00:00.000Z`,
          }),
        ]}
      />,
    );
    // No spaces around the separator: the row is a flex `gap-1`, so the spacing
    // is layout rather than text.
    expect(entryLabels()).toEqual([
      "Created·8:00 AM",
      "Completed·9:00 AM",
      "Won't do·10:00 AM",
    ]);
  });

  it("renders two entries for a todo created and finished the same day", () => {
    render(
      <Harness
        todos={[
          todo({
            id: "sameday",
            createdAt: `${DAY}T08:00:00.000Z`,
            status: "done",
            completedAt: `${DAY}T17:00:00.000Z`,
          }),
        ]}
      />,
    );
    expect(entryLabels()).toEqual(["Created·8:00 AM", "Completed·5:00 PM"]);
    expect(screen.getAllByText("sameday")).toHaveLength(2);
  });

  it("paints the list wash BEHIND the card, never on it", () => {
    render(<Harness todos={[todo({ id: "a", listId: RED.id })]} />);
    const card = screen.getByText("a").closest("[data-nav-stop]")!;
    const wrapper = card.parentElement!;
    // An inline background on the row itself would beat `hover:bg-accent/50`.
    expect(wrapper.getAttribute("style")).toContain("background-color");
    expect(card.getAttribute("style") ?? "").not.toContain("background-color");
  });

  it("leaves the wash off when the list has no colour", () => {
    render(<Harness todos={[todo({ id: "a", listId: "unknown" })]} />);
    const wrapper = screen.getByText("a").closest("[data-nav-stop]")!.parentElement!;
    expect(wrapper.style.backgroundColor).toBe("");
  });

  it("opens a todo from the timeline", () => {
    const onOpenTodo = vi.fn();
    render(<Harness todos={[todo({ id: "a" })]} onOpenTodo={onOpenTodo} />);
    fireEvent.click(screen.getByText("a"));
    expect(onOpenTodo).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("offers no drag affordance on a timeline card", () => {
    render(<Harness todos={[todo({ id: "a" })]} />);
    expect(screen.queryByLabelText(/^Drag to reschedule/)).toBeNull();
  });

  it("shows a move onto this day, dated with WHEN the move happened", () => {
    // Created and scheduled elsewhere a while ago; moved onto DAY yesterday.
    render(
      <Harness
        todos={[
          todo({
            id: "a",
            createdAt: "2026-08-01T00:00:00.000Z",
            scheduledDate: DAY,
            scheduledAt: "2026-08-09T15:00:00.000Z",
          }),
        ]}
      />,
    );
    expect(entryLabels()).toEqual(["Assigned here·Aug 9 · 3:00 PM"]);
  });
});
