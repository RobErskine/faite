// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TodoSheet, type RecurrenceInfo } from "./todo-sheet";
import { defaultRule } from "@/lib/recurrence";
import type { Label as LabelRecord, List, Tab, Todo, TodoEvent } from "@/lib/schema";
import type { PlacementContext } from "@/lib/scheduling";

/**
 * Same reason `day-sheet.test.tsx` stubs this: BlockNote is ProseMirror, which
 * needs layout APIs happy-dom does not have.
 */
vi.mock("@/components/ui/markdown-field", () => ({
  MarkdownField: ({ value, ariaLabel }: { value: string; ariaLabel: string }) => (
    <textarea aria-label={ariaLabel} defaultValue={value} readOnly />
  ),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

const TODO: Todo = {
  id: "t1",
  ownerId: "local-user",
  createdAt: "2026-08-10T09:00:00.000Z",
  updatedAt: "2026-08-10T09:00:00.000Z",
  deletedAt: null,
  title: "Reply to the design feedback",
  description: null,
  status: "open",
  priority: null,
  scheduledDate: "2026-08-11",
  scheduledAt: "2026-08-10T13:35:00.000Z",
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
};

interface HarnessProps {
  backToDay?: string;
  onBackToDay?: () => void;
  onSetStatus?: (id: string, status: Todo["status"]) => void;
  onDelete?: (id: string) => void;
  onSave?: (id: string, patch: Partial<Todo>) => void;
  onToggleLabel?: (todoId: string, labelId: string) => void;
  onAddSubtask?: (parentId: string, title: string) => void;
  todo?: Todo;
  todos?: Todo[];
  lists?: List[];
  labels?: LabelRecord[];
  events?: TodoEvent[];
  ctx?: PlacementContext;
  listsById?: ReadonlyMap<string, List>;
  tabsById?: ReadonlyMap<string, Tab>;
}

function Harness({
  backToDay,
  onBackToDay,
  onSetStatus = vi.fn(),
  onDelete = vi.fn(),
  onSave = vi.fn(),
  onToggleLabel = vi.fn(),
  onAddSubtask = vi.fn(),
  todo = TODO,
  todos = [],
  lists = [],
  labels = [],
  events,
  ctx,
  listsById,
  tabsById,
}: HarnessProps) {
  return (
    <TodoSheet
      todo={todo}
      today="2026-08-11"
      lists={lists}
      todos={todos}
      tabs={[]}
      labels={labels}
      places={[]}
      events={events}
      ctx={ctx}
      listsById={listsById}
      tabsById={tabsById}
      onClose={vi.fn()}
      onSave={onSave}
      onSetStatus={onSetStatus}
      onToggleLabel={onToggleLabel}
      onDelete={onDelete}
      onAddSubtask={onAddSubtask}
      backToDay={backToDay}
      onBackToDay={onBackToDay}
    />
  );
}

const sheetContent = () => document.querySelector<HTMLElement>('[data-slot="sheet-content"]')!;

const RECURRENCE: RecurrenceInfo = {
  rule: defaultRule("2026-08-07"),
  seriesStart: "2026-08-07",
  occurrenceDate: "2026-08-11",
  summary: "Every week on Fri",
  nextDate: "2026-08-18",
  missedCount: null,
  onStop: vi.fn(),
  onChangeRule: vi.fn(),
  onRemoveSeries: vi.fn(),
};

describe("repeat section (a materialized occurrence)", () => {
  it("renders the schedule, Change…, and the actions menu without crashing", () => {
    render(
      <TodoSheet
        todo={{ ...TODO, recurrenceParentId: "template-1" }}
        today="2026-08-11"
        lists={[]}
        tabs={[]}
        labels={[]}
        places={[]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onSetStatus={vi.fn()}
        onToggleLabel={vi.fn()}
        onDelete={vi.fn()}
        recurrence={RECURRENCE}
      />,
    );
    expect(screen.getByText("Every week on Fri")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change…" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "More repeat actions" })).toBeTruthy();
  });
});

describe("location field", () => {
  it("renders the autocomplete input, with and without saved places, without crashing", () => {
    const place = {
      id: "place-1",
      ownerId: "local-user",
      createdAt: "",
      updatedAt: "",
      deletedAt: null,
      name: "Home",
      address: "1 Main St",
      googlePlaceId: null,
      lat: null,
      lng: null,
    };
    render(
      <TodoSheet
        todo={TODO}
        today="2026-08-11"
        lists={[]}
        tabs={[]}
        labels={[]}
        places={[place]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onSetStatus={vi.fn()}
        onToggleLabel={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Location")).toBeTruthy();
  });
});

describe("title quick-update", () => {
  it("shows a live chip while typing a trailing token, before committing", () => {
    render(<Harness />);
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Buy milk p2" } });
    expect(screen.getByText("P2")).toBeTruthy();
  });

  it("strips a trailing priority token and applies it as a field on blur", () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Reply to the design feedback p2" } });
    fireEvent.blur(title);
    // No `title` key: stripping "p2" recovers the ORIGINAL title exactly, so
    // there is nothing to write there — only the field the token implied.
    expect(onSave).toHaveBeenCalledWith(TODO.id, { priority: 2 });
  });

  it("still writes the stripped title when it differs from the original", () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Buy milk p2" } });
    fireEvent.blur(title);
    expect(onSave).toHaveBeenCalledWith(TODO.id, { title: "Buy milk", priority: 2 });
  });

  it("does not clobber fields the title has no token for", () => {
    // TODO already has scheduledDate set; a priority-only edit must not
    // touch it, or every quick-update would silently unschedule the todo.
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Reply to the design feedback p3" } });
    fireEvent.blur(title);
    const patch = onSave.mock.calls[0][1];
    expect(patch).not.toHaveProperty("scheduledDate");
    expect(patch).not.toHaveProperty("deadline");
    expect(patch).not.toHaveProperty("reminderTime");
  });

  it("a plain edit with no token saves the title only", () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Reply to the design feedback tonight" } });
    fireEvent.blur(title);
    expect(onSave).toHaveBeenCalledWith(TODO.id, {
      title: "Reply to the design feedback tonight",
    });
  });

  it("an edit with no change at all does not call onSave", () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    const title = screen.getByLabelText("Title");
    fireEvent.blur(title);
    expect(onSave).not.toHaveBeenCalled();
  });
});

/**
 * EI-110 follow-up: a completed trailing token now folds out of the visible
 * title (and, unlike quick-add's creation flow, writes immediately) the
 * moment its own trailing space lands — this sheet already has dedicated,
 * always-visible fields for priority/date/deadline/reminder, so there's
 * nowhere for a "pending chip" to persist the way it does in a brand-new
 * quick-add row. See `foldTitleMatch` in todo-sheet.tsx.
 */
describe("title quick-update — live fold on a trailing space", () => {
  it("applies a trailing priority token immediately once its space lands, without waiting for blur", () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Reply to the design feedback p2 " } });
    expect(onSave).toHaveBeenCalledWith(TODO.id, { priority: 2 });
  });

  it("strips the folded token from the visible title and its chip", () => {
    render(<Harness />);
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Buy milk p2 " } });
    expect(title).toHaveProperty("value", "Buy milk ");
    expect(screen.queryByText("P2")).toBeNull();
  });

  it("does not fold a still-in-progress word with no trailing space yet", () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Buy milk p2" } });
    expect(onSave).not.toHaveBeenCalled();
    expect(title).toHaveProperty("value", "Buy milk p2");
  });

  it("blur afterward only writes the remaining title text — the priority already committed", () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Buy milk p2 " } });
    onSave.mockClear();
    fireEvent.blur(title);
    expect(onSave).toHaveBeenCalledWith(TODO.id, { title: "Buy milk" });
  });
});

const LIST: List = {
  id: "l2",
  ownerId: "local-user",
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
  deletedAt: null,
  name: "Grocery List",
  isBacklog: false,
  archivedAt: null,
  archivedWithTabId: null,
  position: "a0",
  tabId: null,
  defaultReminderPresetId: null,
  color: null,
  emoji: null,
  iconUrl: null,
};

const mkLabel = (id: string, name: string): LabelRecord => ({
  id,
  ownerId: "local-user",
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
  deletedAt: null,
  name,
  position: "a0",
  color: null,
  emoji: null,
  iconUrl: null,
});

const URGENT = mkLabel("lb1", "Urgent");
const ERRAND = mkLabel("lb2", "Errand");

/**
 * `@` and `#` mentions in the title, resolving as an immediate field write —
 * see `todo-sheet.tsx`'s `applyMention`. Mirrors the `@list`/`#label` mention
 * coverage in `command-palette.test.tsx`, but this sheet resolves through
 * `onSave`/`onToggleLabel` directly rather than staging a chip.
 */
describe("title mentions — @list and #label", () => {
  it("picking a list mention calls onSave with just { listId }, not a scheduledDate clear", () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} lists={[LIST]} />);
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Reply to the design feedback @groc" } });

    fireEvent.mouseDown(screen.getByRole("option", { name: "Grocery List" }));

    expect(onSave).toHaveBeenCalledWith(TODO.id, { listId: "l2" });
  });

  it("picking a label mention calls onToggleLabel and strips the token from the title", () => {
    const onToggleLabel = vi.fn();
    render(<Harness onToggleLabel={onToggleLabel} labels={[URGENT]} />);
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Reply to the design feedback #urg" } });

    fireEvent.mouseDown(screen.getByRole("option", { name: "Urgent" }));

    expect(onToggleLabel).toHaveBeenCalledWith(TODO.id, "lb1");
    expect(screen.getByLabelText("Title")).toHaveProperty(
      "value",
      "Reply to the design feedback",
    );
  });

  it("excludes an already-applied label from the # popover", () => {
    render(
      <Harness labels={[URGENT, ERRAND]} todo={{ ...TODO, labelIds: ["lb1"] }} />,
    );
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Reply to the design feedback #" } });

    expect(screen.queryByRole("option", { name: "Urgent" })).toBeNull();
    expect(screen.getByRole("option", { name: "Errand" })).toBeTruthy();
  });

  it("a # query with no match offers to create the label, and picking it toggles the new one on", async () => {
    const onToggleLabel = vi.fn();
    render(<Harness onToggleLabel={onToggleLabel} labels={[]} />);
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Reply to the design feedback #new-one" } });

    fireEvent.mouseDown(screen.getByRole("option", { name: 'Create label "new-one"' }));

    await vi.waitFor(() => expect(onToggleLabel).toHaveBeenCalledTimes(1));
    expect(onToggleLabel.mock.calls[0][0]).toBe(TODO.id);
    expect(typeof onToggleLabel.mock.calls[0][1]).toBe("string");
  });
});

describe("footer", () => {
  it("renders Mark done, Won't do, and Delete as a 3-up row", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Mark done" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Won't do" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
  });
});

describe("keyboard shortcuts", () => {
  it("⌘Enter marks the todo done", () => {
    const onSetStatus = vi.fn();
    render(<Harness onSetStatus={onSetStatus} />);
    fireEvent.keyDown(sheetContent(), { key: "Enter", metaKey: true });
    expect(onSetStatus).toHaveBeenCalledWith("t1", "done");
  });

  it("⌘Backspace marks the todo dropped (Won't do)", () => {
    const onSetStatus = vi.fn();
    render(<Harness onSetStatus={onSetStatus} />);
    fireEvent.keyDown(sheetContent(), { key: "Backspace", metaKey: true });
    expect(onSetStatus).toHaveBeenCalledWith("t1", "dropped");
  });

  it("⇧⌘Backspace deletes", () => {
    const onDelete = vi.fn();
    render(<Harness onDelete={onDelete} />);
    fireEvent.keyDown(sheetContent(), { key: "Backspace", metaKey: true, shiftKey: true });
    expect(onDelete).toHaveBeenCalledWith("t1");
  });

  it("does not fire ⌘Backspace while focus is in a text field — it means delete-to-line-start there", () => {
    const onSetStatus = vi.fn();
    render(<Harness onSetStatus={onSetStatus} />);
    const title = screen.getByLabelText("Title");
    fireEvent.keyDown(title, { key: "Backspace", metaKey: true });
    expect(onSetStatus).not.toHaveBeenCalled();
  });

  it("requires exactly one of Ctrl/Meta — Ctrl+Meta together is a different chord", () => {
    const onSetStatus = vi.fn();
    render(<Harness onSetStatus={onSetStatus} />);
    fireEvent.keyDown(sheetContent(), { key: "Enter", metaKey: true, ctrlKey: true });
    expect(onSetStatus).not.toHaveBeenCalled();
  });
});

describe("back-to-day affordance", () => {
  it("is absent when the sheet was not opened from a day's timeline", () => {
    render(<Harness />);
    expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
  });

  it("reads 'Back to <day>' and fires onBackToDay when opened from a day", () => {
    const onBackToDay = vi.fn();
    render(<Harness backToDay="2026-08-11" onBackToDay={onBackToDay} />);
    const button = screen.getByRole("button", { name: "Back to Aug 11" });
    fireEvent.click(button);
    expect(onBackToDay).toHaveBeenCalledTimes(1);
  });

  it("is absent if backToDay is set but no handler is wired (defensive)", () => {
    render(<Harness backToDay="2026-08-11" />);
    expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
  });
});

describe("Sub-tasks (EI-55)", () => {
  const child = (id: string, title: string, status: Todo["status"] = "open"): Todo => ({
    ...TODO,
    id,
    title,
    status,
    parentId: TODO.id,
  });

  it("renders no count and an empty list when there are no sub-tasks yet", () => {
    render(<Harness />);
    expect(screen.getByText("Sub-tasks")).toBeTruthy();
    expect(screen.queryByLabelText(/Mark .* done/)).toBeNull();
  });

  it("lists existing sub-tasks with a done/total count, ignoring todos that are not children", () => {
    render(
      <Harness
        todos={[
          child("s1", "Book flights"),
          child("s2", "Pack bags", "done"),
          { ...TODO, id: "unrelated", title: "Not a child", parentId: null },
        ]}
      />,
    );
    expect(screen.getByText("Sub-tasks")).toBeTruthy();
    expect(screen.getByText("(1/2)")).toBeTruthy();
    expect(screen.getByText("Book flights")).toBeTruthy();
    expect(screen.getByText("Pack bags")).toBeTruthy();
    expect(screen.queryByText("Not a child")).toBeNull();
  });

  it("checking a sub-task's box calls onSetStatus with ITS id, not the parent's", () => {
    const onSetStatus = vi.fn();
    render(<Harness todos={[child("s1", "Book flights")]} onSetStatus={onSetStatus} />);
    fireEvent.click(screen.getByLabelText("Mark Book flights done"));
    expect(onSetStatus).toHaveBeenCalledWith("s1", "done");
  });

  it("unchecking a done sub-task reopens it", () => {
    const onSetStatus = vi.fn();
    render(
      <Harness todos={[child("s1", "Book flights", "done")]} onSetStatus={onSetStatus} />,
    );
    fireEvent.click(screen.getByLabelText("Mark Book flights not done"));
    expect(onSetStatus).toHaveBeenCalledWith("s1", "open");
  });

  it("deleting a sub-task calls onDelete with ITS id and does not close the sheet", () => {
    const onDelete = vi.fn();
    render(<Harness todos={[child("s1", "Book flights")]} onDelete={onDelete} />);
    fireEvent.click(screen.getByLabelText("Delete sub-task Book flights"));
    expect(onDelete).toHaveBeenCalledWith("s1");
    // The sheet itself is still open — unlike the footer's Delete button,
    // this must not also call onClose.
    expect(screen.getByLabelText("Add a sub-task")).toBeTruthy();
  });

  it("typing a title and pressing Enter calls onAddSubtask with the parent id, then clears the draft", () => {
    const onAddSubtask = vi.fn();
    render(<Harness onAddSubtask={onAddSubtask} />);
    const input = screen.getByLabelText("Add a sub-task");
    fireEvent.change(input, { target: { value: "Book flights" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAddSubtask).toHaveBeenCalledWith(TODO.id, "Book flights");
    expect(input).toHaveProperty("value", "");
  });

  it("blurring with a typed title also commits it", () => {
    const onAddSubtask = vi.fn();
    render(<Harness onAddSubtask={onAddSubtask} />);
    const input = screen.getByLabelText("Add a sub-task");
    fireEvent.change(input, { target: { value: "Book flights" } });
    fireEvent.blur(input);
    expect(onAddSubtask).toHaveBeenCalledWith(TODO.id, "Book flights");
  });

  it("does not call onAddSubtask for a blank title", () => {
    const onAddSubtask = vi.fn();
    render(<Harness onAddSubtask={onAddSubtask} />);
    const input = screen.getByLabelText("Add a sub-task");
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(onAddSubtask).not.toHaveBeenCalled();
  });

  it("one level of nesting: a sub-task's own sheet shows no Sub-tasks section at all", () => {
    render(<Harness todo={{ ...TODO, parentId: "some-parent" }} />);
    expect(screen.queryByText("Sub-tasks")).toBeNull();
    expect(screen.queryByLabelText("Add a sub-task")).toBeNull();
  });
});

describe("History — the Faite Loop (EI-96)", () => {
  const ctx: PlacementContext = {
    today: "2026-08-11",
    visibleWindow: ["2026-08-11"],
    workdaysOnly: false,
    workdays: [1, 2, 3, 4, 5],
    overflowAfterDays: 3,
  };

  // History is open by default (EI-96 follow-up) — no toggle click needed.

  it("shows no roll rows without ctx — History is unchanged from before EI-96", () => {
    render(<Harness todo={{ ...TODO, scheduledDate: "2026-08-08" }} />);
    expect(screen.queryByText("Rolled over")).toBeNull();
  });

  it("shows a collapsed 'Rolled over' row while still on today's column", () => {
    render(<Harness todo={{ ...TODO, scheduledDate: "2026-08-08" }} ctx={ctx} />);
    expect(screen.getByText("Rolled over")).toBeTruthy();
    expect(screen.getByText("3 days, from Aug 8")).toBeTruthy();
    expect(screen.queryByText("Fell into Overflow")).toBeNull();
  });

  it("shows 'Fell into Overflow' once past the threshold", () => {
    render(<Harness todo={{ ...TODO, scheduledDate: "2026-08-07" }} ctx={ctx} />);
    expect(screen.getByText("Fell into Overflow")).toBeTruthy();
    expect(screen.getByText("from Aug 7")).toBeTruthy();
  });

  it("shows no roll rows for a recurring occurrence", () => {
    render(
      <Harness
        todo={{ ...TODO, scheduledDate: "2026-08-07", recurrenceParentId: "template-1" }}
        ctx={ctx}
      />,
    );
    expect(screen.queryByText("Rolled over")).toBeNull();
    expect(screen.queryByText("Fell into Overflow")).toBeNull();
  });
});

/**
 * EI-62: the Project picker is retired. The sheet now shows a read-only Tab
 * field, derived `listId → list.tabId → tab` (see `tabForTodo`, lib/board.ts)
 * rather than a stored, independently-editable field.
 */
describe("derived Tab field (EI-62)", () => {
  const PERSONAL_TAB: Tab = {
    id: "tab-personal",
    ownerId: "local-user",
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    name: "Personal",
    description: null,
    isDefault: false,
    archivedAt: null,
    position: "a0",
    color: null,
    emoji: null,
    iconUrl: null,
  };

  const TO_READ_LIST: List = {
    id: "list-to-read",
    ownerId: "local-user",
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    name: "To Read",
    isBacklog: false,
    archivedAt: null,
    archivedWithTabId: null,
    position: "a0",
    tabId: PERSONAL_TAB.id,
    color: null,
    emoji: null,
    iconUrl: null,
  };

  const BACKLOG_LIST: List = {
    ...TO_READ_LIST,
    id: "list-backlog",
    name: "Backlog",
    isBacklog: true,
    tabId: null,
  };

  it("has no Project field", () => {
    render(<Harness />);
    expect(screen.queryByText("Project")).toBeNull();
  });

  it("shows the tab its list belongs to", () => {
    render(
      <Harness
        todo={{ ...TODO, listId: TO_READ_LIST.id }}
        listsById={new Map([[TO_READ_LIST.id, TO_READ_LIST]])}
        tabsById={new Map([[PERSONAL_TAB.id, PERSONAL_TAB]])}
      />,
    );
    expect(screen.getByText("Tab")).toBeTruthy();
    expect(screen.getByText("Personal")).toBeTruthy();
  });

  it("is blank for a Backlog todo — list.tabId === null means pinned into every tab", () => {
    render(
      <Harness
        todo={{ ...TODO, listId: BACKLOG_LIST.id }}
        listsById={new Map([[BACKLOG_LIST.id, BACKLOG_LIST]])}
        tabsById={new Map([[PERSONAL_TAB.id, PERSONAL_TAB]])}
      />,
    );
    expect(screen.queryByText("Personal")).toBeNull();
  });

  it("is blank for an unfiled todo (listId === null)", () => {
    render(<Harness todo={{ ...TODO, listId: null }} />);
    expect(screen.queryByText("Personal")).toBeNull();
  });
});
