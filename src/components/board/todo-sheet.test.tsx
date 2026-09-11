// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TodoSheet, type RecurrenceInfo } from "./todo-sheet";
import { defaultRule } from "@/lib/recurrence";
import { PRIORITY_RAILS } from "@/lib/priority";
import type { Label as LabelRecord, List, Todo, TodoEvent } from "@/lib/schema";
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
    // No "Change…" here any more — editing the rule is the Repeat entry
    // inside the date control, so there is one way in (EI-318). What stays
    // is the two verbs that are not schedule edits.
    expect(screen.queryByRole("button", { name: "Change…" })).toBeNull();
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
  description: null,
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

/**
 * GOOD JOB mode's confetti origin (`lib/celebrate.ts`), measured from the
 * sheet's OWN controls.
 *
 * Not from the board card behind it — that card may be scrolled away,
 * filtered out, or on another tab, and a sub-task never has one at all. Both
 * assertions really test that a ref survives: the footer button reaches its
 * DOM node through Base UI's `TooltipTrigger render={...}` prop, and if that
 * merge ever stops working, `originOf` returns null and the confetti silently
 * stops — which is indistinguishable from the setting being off.
 *
 * happy-dom has no layout, hence the stubbed rect; the tests elsewhere in this
 * file that assert a trailing `null` origin are the unstubbed case.
 */
/**
 * happy-dom has no layout, so any test wanting a real origin must say where
 * the element is. Shared by the two `describe`s below that do.
 */
function stubRect(el: Element) {
  window.innerWidth = 1000;
  window.innerHeight = 500;
  const box = { x: 200, y: 100, left: 200, top: 100, width: 100, height: 50, right: 300, bottom: 150 };
  el.getBoundingClientRect = () => ({ ...box, toJSON: () => box }) as DOMRect;
}

describe("the confetti origin passed to onSetStatus", () => {

  it("comes from the Mark done button, for both the click and ⌘Enter", () => {
    const onSetStatus = vi.fn();
    render(<Harness onSetStatus={onSetStatus} />);
    stubRect(screen.getByRole("button", { name: "Mark done" }));

    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    expect(onSetStatus).toHaveBeenLastCalledWith("t1", "done", { x: 0.25, y: 0.25 });

    fireEvent.keyDown(sheetContent(), { key: "Enter", metaKey: true });
    expect(onSetStatus).toHaveBeenLastCalledWith("t1", "done", { x: 0.25, y: 0.25 });
  });
});

describe("keyboard shortcuts", () => {
  it("⌘Enter marks the todo done", () => {
    const onSetStatus = vi.fn();
    render(<Harness onSetStatus={onSetStatus} />);
    fireEvent.keyDown(sheetContent(), { key: "Enter", metaKey: true });
    expect(onSetStatus).toHaveBeenCalledWith("t1", "done", null);
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
    expect(onSetStatus).toHaveBeenCalledWith("s1", "done", null);
  });

  /**
   * A sub-task has no board card, so the row itself is the only honest
   * origin for GOOD JOB mode's confetti — see the footer's case above.
   */
  it("hands its own row as the confetti origin", () => {
    const onSetStatus = vi.fn();
    render(<Harness todos={[child("s1", "Book flights")]} onSetStatus={onSetStatus} />);
    stubRect(screen.getByLabelText("Mark Book flights done").closest("li")!);

    fireEvent.click(screen.getByLabelText("Mark Book flights done"));

    expect(onSetStatus).toHaveBeenCalledWith("s1", "done", { x: 0.25, y: 0.25 });
  });

  it("unchecking a done sub-task reopens it", () => {
    const onSetStatus = vi.fn();
    render(
      <Harness todos={[child("s1", "Book flights", "done")]} onSetStatus={onSetStatus} />,
    );
    fireEvent.click(screen.getByLabelText("Mark Book flights not done"));
    expect(onSetStatus).toHaveBeenCalledWith("s1", "open", null);
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


describe("priority in the header (EI-318)", () => {
  it("sits before the title in the DOM, which is the tab order", () => {
    // Shift+Tab from the title lands on priority and Tab lands on Date —
    // both fall out of source order, so this asserts the order rather than
    // simulating a browser's focus walk, which happy-dom does not implement.
    render(<Harness />);
    const priority = document.getElementById("todo-priority")!;
    const title = screen.getByLabelText("Title");
    expect(priority.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("reads P1..P4, and None when unset", () => {
    // The rail carries the level; `P2` is the label beside it because that is
    // the token quick-add and ⌘K parse. An adjective spent width saying what
    // the rail had already said.
    const { rerender } = render(<Harness todo={{ ...TODO, priority: null }} />);
    expect(document.getElementById("todo-priority")!.textContent).toContain("None");
    rerender(<Harness todo={{ ...TODO, priority: 2 }} />);
    expect(document.getElementById("todo-priority")!.textContent).toContain("P2");
  });

  it("draws the same rail the card wears, from the same table", () => {
    // One vocabulary for reading the sheet and scanning the column — the
    // glyph is `PriorityRail` with a positioning override, not a copy.
    render(<Harness todo={{ ...TODO, priority: 1 }} />);
    const glyph = document
      .getElementById("todo-priority")!
      .querySelector("[data-priority-rail]") as HTMLElement;
    expect(glyph).toBeTruthy();
    expect(glyph.getAttribute("data-priority-rail")).toBe("1");
    expect(glyph.style.width).toBe(`${PRIORITY_RAILS[1].width}px`);
  });

  it("puts the level on the SHEET's leading edge, as the card's own rail", () => {
    // One mark, one table. The sheet reads as that card opened rather than as
    // a different surface that happens to be about it — which is also why the
    // select no longer carries a tint of its own: saying it twice in two
    // different ways is not consistency.
    render(<Harness todo={{ ...TODO, priority: 1 }} />);
    const edge = sheetContent().querySelector(":scope > [data-priority-rail]") as HTMLElement;
    expect(edge).toBeTruthy();
    expect(edge.getAttribute("data-priority-rail")).toBe("1");
    expect(edge.style.width).toBe(`${PRIORITY_RAILS[1].width}px`);
    // Full height here, unlike the card's inset tick: there is no next sheet
    // below this one to fuse with.
    expect(edge.className).toContain("inset-y-0");
  });

  it("wears nothing on that edge when the to-do is unprioritized", () => {
    render(<Harness todo={{ ...TODO, priority: null }} />);
    expect(sheetContent().querySelector(":scope > [data-priority-rail]")).toBeNull();
  });

  it("hangs the control off that edge once there is board to hang it over", () => {
    // Gated on `lg`, not on the desktop shell: what matters is whether the
    // sheet leaves room beside it, and it is `w-full` below `sm`.
    render(<Harness todo={{ ...TODO, priority: 2 }} />);
    const tab = document.getElementById("todo-priority")!.parentElement!;
    expect(tab.className).toContain("lg:absolute");
    // Exactly its own width, so its right edge meets the sheet's padding edge
    // where the rail begins, and the rail runs on past it unbroken.
    expect(tab.className).toContain("lg:-left-24");
    expect(tab.className).toContain("lg:w-24");
  });

  it("gives the tab no shadow, which is what made it look detached", () => {
    // `--shadow-overlay` casts on every side, including into the seam the two
    // surfaces are supposed to share. The tab is chrome ON the sheet, so it
    // carries the sheet's background and three borders instead.
    render(<Harness todo={{ ...TODO, priority: 2 }} />);
    const tab = document.getElementById("todo-priority")!.parentElement!;
    expect(tab.className).not.toContain("shadow-(--shadow-overlay)");
    expect(tab.className).toContain("lg:bg-popover");
    expect(tab.className).toContain("lg:border-r-0");
    expect(tab.className).toContain("lg:rounded-r-none");
  });

  it("outlines the tab in the rail's own treatment, so the edge wraps it", () => {
    // The sheet's edge comes down, goes behind the tab, and is picked up by
    // the tab's border in the same width, color and dottedness — one line
    // that wraps, rather than a box parked on a line.
    render(<Harness todo={{ ...TODO, priority: 1 }} />);
    const tab = document.getElementById("todo-priority")!.parentElement!;
    expect(tab.style.getPropertyValue("--priority-edge-width")).toBe(
      `${PRIORITY_RAILS[1].width}px`,
    );
    // P1 is `double` now — the four levels are CSS's four line styles.
    expect(tab.style.getPropertyValue("--priority-edge-style")).toBe("double");
    expect(tab.style.getPropertyValue("--priority-edge-color")).toContain("--foreground");
  });

  it("outlines the tab in each level's own line style, exactly", () => {
    // The four levels are CSS's four `border-style` values, so the tab needs
    // no approximation — it draws the same thing the rail does.
    for (const [priority, style] of [
      [1, "double"],
      [2, "solid"],
      [3, "dashed"],
      [4, "dotted"],
    ] as const) {
      cleanup();
      render(<Harness todo={{ ...TODO, priority }} />);
      const tab = document.getElementById("todo-priority")!.parentElement!;
      expect(tab.style.getPropertyValue("--priority-edge-style")).toBe(style);
    }
  });

  it("falls back to the ordinary field border when unprioritized", () => {
    // Which is also what every to-do gets below `lg`, where the variables are
    // set and nothing reads them.
    render(<Harness todo={{ ...TODO, priority: null }} />);
    const tab = document.getElementById("todo-priority")!.parentElement!;
    expect(tab.style.getPropertyValue("--priority-edge-width")).toBe("1px");
    expect(tab.style.getPropertyValue("--priority-edge-color")).toBe("var(--input)");
  });

  it("layers the rail above the sheet's contents, and the tab above the rail", () => {
    // This test used to assert the rail had NO z-index — a proxy for "the tab
    // paints over it". The proxy was wrong: it also let every later POSITIONED
    // element paint over the rail, and History's day headers did, cutting the
    // edge into segments. Assert the actual relationship instead, and see
    // `core-flows.spec.ts` for the paint order checked in a real browser.
    render(<Harness todo={{ ...TODO, priority: 1 }} />);
    const edge = sheetContent().querySelector(":scope > [data-priority-rail]") as HTMLElement;
    const tab = document.getElementById("todo-priority")!.parentElement!;
    expect(edge.className).toContain("z-10");
    expect(tab.className).toContain("lg:z-20");
  });

  it("labels the tab, and hides that label when there is no tab", () => {
    render(<Harness todo={{ ...TODO, priority: 2 }} />);
    const label = document.querySelector('label[for="todo-priority"]') as HTMLElement;
    expect(label.textContent).toBe("Priority");
    // Below `lg` the control sits beside the title with no room for a word,
    // and its `aria-label` carries the name instead.
    expect(label.className).toContain("hidden");
    expect(label.className).toContain("lg:flex");
    expect(document.getElementById("todo-priority")!.getAttribute("aria-label")).toBe("Priority");
  });

});

describe("arrow verbs (EI-318)", () => {
  it("up marks the to-do done", () => {
    const onSetStatus = vi.fn();
    render(<Harness onSetStatus={onSetStatus} />);
    fireEvent.keyDown(sheetContent(), { key: "ArrowUp" });
    expect(onSetStatus).toHaveBeenCalledWith("t1", "done", null);
  });

  it("left marks it dropped — the same two keys Overdrive uses", () => {
    const onSetStatus = vi.fn();
    render(<Harness onSetStatus={onSetStatus} />);
    fireEvent.keyDown(sheetContent(), { key: "ArrowLeft" });
    expect(onSetStatus).toHaveBeenCalledWith("t1", "dropped");
  });

  it("does NOTHING while the caret is in a text field — there it moves the caret", () => {
    // The guard, not the keypress (docs/KEYBOARD.md §9). This is the whole
    // reason the sheet does not autofocus the title on open.
    const onSetStatus = vi.fn();
    render(<Harness onSetStatus={onSetStatus} />);
    fireEvent.keyDown(screen.getByLabelText("Title"), { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByLabelText("Title"), { key: "ArrowLeft" });
    expect(onSetStatus).not.toHaveBeenCalled();
  });

  it("ignores a modified arrow — those belong to the OS and the browser", () => {
    const onSetStatus = vi.fn();
    render(<Harness onSetStatus={onSetStatus} />);
    for (const mod of ["metaKey", "ctrlKey", "altKey", "shiftKey"]) {
      fireEvent.keyDown(sheetContent(), { key: "ArrowUp", [mod]: true });
    }
    expect(onSetStatus).not.toHaveBeenCalled();
  });

  it("leaves down and right alone", () => {
    // Overdrive's meanings for them need its verdict state machine; giving
    // them different ones here would break the shared muscle memory.
    const onSetStatus = vi.fn();
    render(<Harness onSetStatus={onSetStatus} />);
    fireEvent.keyDown(sheetContent(), { key: "ArrowDown" });
    fireEvent.keyDown(sheetContent(), { key: "ArrowRight" });
    expect(onSetStatus).not.toHaveBeenCalled();
  });
});

describe("the header's title and priority (EI-318)", () => {
  it("sizes the title so it survives Textarea's own responsive class", () => {
    // `Textarea`'s base ends in `md:text-sm`. tailwind-merge treats the
    // variant as part of the key, so a bare `text-lg` loses at every width
    // this sheet is read at — measured 14px on a 1280px viewport with the
    // class present and doing nothing. Same shape as the backdrop-blur
    // override below.
    render(<Harness />);
    const cls = screen.getByLabelText("Title").className;
    expect(cls).toContain("md:text-lg");
  });

  it("gives the title and the priority select the same line box", () => {
    // `leading-8` on the title, `h-8` on the select: equal boxes are what
    // make `items-start` read as vertical centering on the first line,
    // without pinning the select to the middle of a three-line title.
    render(<Harness />);
    expect(screen.getByLabelText("Title").className).toContain("leading-8");
    expect(document.getElementById("todo-priority")!.className).toContain("h-8");
  });
});

describe("the backdrop (EI-318)", () => {
  const overlay = () => document.querySelector('[data-slot="sheet-overlay"]')!;

  it("drops the blur, so a change lands visibly on the board behind", () => {
    // Almost every field here writes straight through to a card: the date
    // moves it to another day, the list to another column, Mark done takes it
    // off the board. A blurred backdrop smears the only confirmation those
    // actions have.
    //
    // Asserted on the resolved class string rather than trusted, because the
    // override goes through tailwind-merge and the variant is part of the
    // key: a bare `backdrop-blur-none` would NOT beat
    // `supports-backdrop-filter:backdrop-blur-xs`, and would fail silently.
    render(<Harness />);
    expect(overlay().className).not.toContain("backdrop-blur-xs");
    expect(overlay().className).toContain("backdrop-blur-none");
  });

  it("holds the exit's last frame, so the dim cannot flash back on close", () => {
    // Measured before this existed: opacity ran to 0.00005 at 188ms, snapped
    // back to 1 at 206ms, unmounted at 223ms — two frames of full dim after
    // the sheet had gone. `tw-animate-css` defaults `animation-fill-mode` to
    // `none`, and Base UI waits for the panel (the longer animation) before
    // unmounting. Asserted here on the RESOLVED class, where tailwind-merge
    // has run; `ui/overlay-exit.test.ts` covers the other two primitives.
    render(<Harness />);
    expect(overlay().className).toContain("data-closed:fill-mode-forwards");
  });

  it("keeps the dim — the sheet is still modal", () => {
    // Visible, not usable. Base UI keeps the focus trap and `openTodoExists`
    // still feeds `computeModalOpen`; the scrim is what says so.
    render(<Harness />);
    expect(overlay().className).toContain("bg-black/10");
  });
});
