// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AssigneesProvider } from "@/components/board/assignees-context";
import { TodoSheet, type RecurrenceInfo } from "./todo-sheet";
import { defaultRule } from "@/lib/recurrence";
import { PRIORITY_RAILS } from "@/lib/priority";
import type { Assignee, Label as LabelRecord, List, Todo, TodoEvent } from "@/lib/schema";
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
  duplicateOf: null,
  duplicateHeld: null,
  suggestedListId: null,
  assigneeId: null,
  doneCriteria: [],
  access: null,
};

interface HarnessProps {
  backToDay?: string;
  onBackToDay?: () => void;
  onSetStatus?: (id: string, status: Todo["status"]) => void;
  onDelete?: (id: string) => void;
  onMoveBackToList?: (todo: Todo, opts?: { toBacklog?: boolean }) => void;
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
  onMoveBackToList,
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
      onMoveBackToList={onMoveBackToList}
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

  it("leaving an untouched title that ends in a date word re-parses nothing (EI-379)", () => {
    // A second date kept as "not used" at capture lives in the title.
    const onSave = vi.fn();
    render(<Harness onSave={onSave} todo={{ ...TODO, title: "Call about oct 1" }} />);
    expect(screen.queryByText(/Oct 1/)).toBeNull();
    fireEvent.blur(screen.getByLabelText("Title"));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not read a date at the start of an existing title (EI-379)", () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} todo={{ ...TODO, title: "10/1 invoice" }} />);
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "10/1 invoice v2" } });
    fireEvent.blur(title);
    expect(onSave).toHaveBeenCalledWith(TODO.id, { title: "10/1 invoice v2" });
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

const mkAssignee = (id: string, name: string, kind: Assignee["kind"]): Assignee => ({
  id,
  ownerId: "local-user",
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
  deletedAt: null,
  name,
  kind,
  color: null,
  instructions: null,
  apiKeyId: null,
});
const INSTINCT = mkAssignee("as1", "Instinct", "agent");
const MOM = mkAssignee("as2", "Mom", "person");

describe("title assignees (EI-426)", () => {
  it("picking an assignee from @ writes assigneeId at once", () => {
    const onSave = vi.fn();
    render(
      <AssigneesProvider assignees={[INSTINCT, MOM]}>
        <Harness onSave={onSave} />
      </AssigneesProvider>,
    );
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Reply to the design feedback @mo" },
    });

    fireEvent.mouseDown(screen.getByRole("option", { name: /Mom/ }));

    expect(onSave).toHaveBeenCalledWith(TODO.id, { assigneeId: "as2" });
  });

  it("a title ending \"for <agent>\" sets assigneeId and strips the words on blur", () => {
    const onSave = vi.fn();
    render(
      <AssigneesProvider assignees={[INSTINCT, MOM]}>
        <Harness onSave={onSave} />
      </AssigneesProvider>,
    );
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Reply to the design feedback for Instinct" } });
    fireEvent.blur(title);

    expect(onSave).toHaveBeenCalledWith(TODO.id, { assigneeId: "as1" });
    expect(screen.getByLabelText("Title")).toHaveProperty(
      "value",
      "Reply to the design feedback",
    );
  });

  it("\"for <person>\" is left in the title", () => {
    const onSave = vi.fn();
    render(
      <AssigneesProvider assignees={[INSTINCT, MOM]}>
        <Harness onSave={onSave} />
      </AssigneesProvider>,
    );
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "Reply to the design feedback for Mom" } });
    fireEvent.blur(title);

    expect(onSave).not.toHaveBeenCalledWith(TODO.id, expect.objectContaining({ assigneeId: expect.anything() }));
  });
});

describe("footer endings (EI-396)", () => {
  it("renders Done, Won't do, Back to <list> and Delete", () => {
    render(<Harness onMoveBackToList={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Won't do" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to Backlog" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull();
  });

  it("omits Back to <list> when the to-do has no day", () => {
    render(<Harness onMoveBackToList={vi.fn()} todo={{ ...TODO, scheduledDate: null, scheduledAt: null }} />);
    expect(screen.queryByRole("button", { name: /^Back to/ })).toBeNull();
  });

  it("lays the footer out as an inverted T: Done alone, then three equal cells", () => {
    const { unmount } = render(<Harness onMoveBackToList={vi.fn()} />);
    const footer = document.querySelector('[data-slot="sheet-footer"]')!;
    expect(footer.className).toContain("grid-cols-3");
    expect(screen.getByRole("button", { name: "Done" }).className).toContain("col-span-3");
    expect(footer.children.length).toBe(4);
    for (const name of ["Won't do", "Back to Backlog", "Delete"]) {
      expect(screen.getByRole("button", { name }).className).not.toContain("flex-");
    }
    unmount();
    render(<Harness onMoveBackToList={vi.fn()} todo={{ ...TODO, scheduledDate: null, scheduledAt: null }} />);
    const bare = document.querySelector('[data-slot="sheet-footer"]')!;
    // Back to <list> is gone but its cell stays, so Won't do and Delete hold still.
    expect(bare.children.length).toBe(4);
    expect(bare.children[2].tagName).toBe("DIV");
  });

  it("shows the Delete chord inline", () => {
    render(<Harness onMoveBackToList={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Delete" }).querySelector('[data-slot="kbd"]')).toBeTruthy();
  });

  it("header and footer share the body's px-4 edge", () => {
    render(<Harness onMoveBackToList={vi.fn()} />);
    expect(document.querySelector('[data-slot="sheet-header"]')!.className).toContain("px-4");
    expect(document.querySelector('[data-slot="sheet-footer"]')!.className).toContain("px-4");
  });

  it("shift+down sends it to Backlog, only with a day and not from a text field", () => {
    const onMoveBackToList = vi.fn();
    const { unmount } = render(<Harness onMoveBackToList={onMoveBackToList} />);
    fireEvent.keyDown(screen.getByLabelText("Title"), { key: "ArrowDown", shiftKey: true });
    expect(onMoveBackToList).not.toHaveBeenCalled();
    fireEvent.keyDown(sheetContent(), { key: "ArrowDown", shiftKey: true });
    expect(onMoveBackToList).toHaveBeenCalledWith(TODO, { toBacklog: true });
    unmount();

    const none = vi.fn();
    render(<Harness onMoveBackToList={none} todo={{ ...TODO, scheduledDate: null, scheduledAt: null }} />);
    fireEvent.keyDown(sheetContent(), { key: "ArrowDown", shiftKey: true });
    expect(none).not.toHaveBeenCalled();
  });

  it("d opens the Date popover, but not from a text field", () => {
    render(<Harness onMoveBackToList={vi.fn()} />);
    const trigger = document.getElementById("todo-scheduled")!;
    const click = vi.spyOn(trigger, "click");
    fireEvent.keyDown(screen.getByLabelText("Title"), { key: "d" });
    expect(click).not.toHaveBeenCalled();
    fireEvent.keyDown(sheetContent(), { key: "d" });
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("clicking Back to <list> calls onMoveBackToList with the to-do", () => {
    const onMoveBackToList = vi.fn();
    render(<Harness onMoveBackToList={onMoveBackToList} />);
    fireEvent.click(screen.getByRole("button", { name: "Back to Backlog" }));
    expect(onMoveBackToList).toHaveBeenCalledWith(TODO);
  });

  it("bare down moves it back to its list, but not from a text field or without a day", () => {
    const onMoveBackToList = vi.fn();
    const { unmount } = render(<Harness onMoveBackToList={onMoveBackToList} />);
    fireEvent.keyDown(screen.getByLabelText("Title"), { key: "ArrowDown" });
    expect(onMoveBackToList).not.toHaveBeenCalled();
    fireEvent.keyDown(sheetContent(), { key: "ArrowDown" });
    expect(onMoveBackToList).toHaveBeenCalledWith(TODO);
    unmount();

    const none = vi.fn();
    render(<Harness onMoveBackToList={none} todo={{ ...TODO, scheduledDate: null, scheduledAt: null }} />);
    fireEvent.keyDown(sheetContent(), { key: "ArrowDown" });
    expect(none).not.toHaveBeenCalled();
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

  it("comes from the Done button, for both the click and ⌘Enter", () => {
    const onSetStatus = vi.fn();
    render(<Harness onSetStatus={onSetStatus} />);
    stubRect(screen.getByRole("button", { name: "Done" }));

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
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

  it("reads '‹ <day>', named 'Return to <day>', and fires onBackToDay", () => {
    const onBackToDay = vi.fn();
    render(<Harness backToDay="2026-08-11" onBackToDay={onBackToDay} />);
    const button = screen.getByRole("button", { name: "Return to Aug 11" });
    expect(button.textContent).toBe("‹Aug 11");
    fireEvent.click(button);
    expect(onBackToDay).toHaveBeenCalledTimes(1);
  });

  it("is absent if backToDay is set but no handler is wired (defensive)", () => {
    render(<Harness backToDay="2026-08-11" />);
    expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
  });
});

/** The sub-task input is hidden until the "+" beside the label is clicked. */
const openSubtaskInput = () => {
  fireEvent.click(screen.getByRole("button", { name: "Add a sub-task" }));
  return screen.getByPlaceholderText("Add a sub-task");
};

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
    const input = openSubtaskInput();
    fireEvent.change(input, { target: { value: "Book flights" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAddSubtask).toHaveBeenCalledWith(TODO.id, "Book flights");
    expect(input).toHaveProperty("value", "");
  });

  it("blurring with a typed title also commits it", () => {
    const onAddSubtask = vi.fn();
    render(<Harness onAddSubtask={onAddSubtask} />);
    const input = openSubtaskInput();
    fireEvent.change(input, { target: { value: "Book flights" } });
    fireEvent.blur(input);
    expect(onAddSubtask).toHaveBeenCalledWith(TODO.id, "Book flights");
  });

  it("does not call onAddSubtask for a blank title", () => {
    const onAddSubtask = vi.fn();
    render(<Harness onAddSubtask={onAddSubtask} />);
    const input = openSubtaskInput();
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(onAddSubtask).not.toHaveBeenCalled();
  });

  it("hides the input until the + is clicked, which shows and focuses it", () => {
    render(<Harness />);
    expect(screen.queryByPlaceholderText("Add a sub-task")).toBeNull();
    const input = openSubtaskInput();
    expect(document.activeElement).toBe(input);
  });

  it("stays open after a commit; Escape hides it again", () => {
    render(<Harness />);
    const input = openSubtaskInput();
    fireEvent.change(input, { target: { value: "Book flights" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByPlaceholderText("Add a sub-task")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByPlaceholderText("Add a sub-task")).toBeNull();
  });

  it("blurring with an empty draft hides the input", () => {
    render(<Harness />);
    fireEvent.blur(openSubtaskInput());
    expect(screen.queryByPlaceholderText("Add a sub-task")).toBeNull();
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

  // History is collapsed by default (EI-396) — open it before reading rows.
  const openHistory = () =>
    fireEvent.click(screen.getByRole("button", { name: /^History/ }));

  it("shows no roll rows without ctx — History is unchanged from before EI-96", () => {
    render(<Harness todo={{ ...TODO, scheduledDate: "2026-08-08" }} />);
    expect(screen.queryByText("Rolled over")).toBeNull();
  });

  it("shows a collapsed 'Rolled over' row while still on today's column", () => {
    render(<Harness todo={{ ...TODO, scheduledDate: "2026-08-08" }} ctx={ctx} />);
    openHistory();
    expect(screen.getByText("Rolled over")).toBeTruthy();
    expect(screen.getByText("3 days, from Aug 8")).toBeTruthy();
    expect(screen.queryByText("Fell into Overflow")).toBeNull();
  });

  it("shows 'Fell into Overflow' once past the threshold", () => {
    render(<Harness todo={{ ...TODO, scheduledDate: "2026-08-07" }} ctx={ctx} />);
    openHistory();
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


describe("on-demand sections (EI-396)", () => {
  it("collapses Attachments and History by default, as buttons with aria-expanded", () => {
    render(<Harness />);
    const attachments = screen.getByRole("button", { name: /^Attachments/ });
    const history = screen.getByRole("button", { name: /^History/ });
    expect(attachments.getAttribute("aria-expanded")).toBe("false");
    expect(history.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Attach a file" })).toBeNull();
    expect(screen.queryByRole("list", { name: /^History for/ })).toBeNull();
  });

  it("shows the Attachments label once, on the toggle, when open", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /^Attachments/ }));
    expect(screen.getAllByText("Attachments")).toHaveLength(1);
  });

  it("opens Attachments on click and closes it again", () => {
    render(<Harness />);
    const toggle = screen.getByRole("button", { name: /^Attachments/ });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Attach a file" })).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByRole("button", { name: "Attach a file" })).toBeNull();
  });

  it("opens History by default only when it has more than 3 events", () => {
    const event = (n: number): TodoEvent => ({
      id: `e${n}`,
      ownerId: "local",
      createdAt: `2026-08-0${n}T09:00:00.000Z`,
      updatedAt: `2026-08-0${n}T09:00:00.000Z`,
      deletedAt: null,
      todoId: TODO.id,
      kind: "created",
      at: `2026-08-0${n}T09:00:00.000Z`,
      payload: null,
    });
    const { unmount } = render(<Harness events={[1, 2, 3].map(event)} />);
    expect(
      screen.getByRole("button", { name: /^History/ }).getAttribute("aria-expanded"),
    ).toBe("false");
    unmount();
    render(<Harness events={[1, 2, 3, 4].map(event)} />);
    expect(
      screen.getByRole("button", { name: /^History/ }).getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("renders a note's text and, for an agent's write, who wrote it (EI-402)", () => {
    const note = (id: string, payload: unknown): TodoEvent => ({
      id,
      ownerId: "local",
      createdAt: "2026-08-05T09:00:00.000Z",
      updatedAt: "2026-08-05T09:00:00.000Z",
      deletedAt: null,
      todoId: TODO.id,
      kind: "note",
      at: "2026-08-05T09:00:00.000Z",
      payload: JSON.stringify(payload),
    });
    render(
      <Harness
        events={[
          note("n1", { text: "Opened the PR", via: "agent:a1" }),
          note("n2", { text: "Checked by hand", via: "ui" }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^History/ }));
    expect(screen.getAllByText("Note")).toHaveLength(2);
    expect(screen.getByText("Opened the PR")).toBeTruthy();
    expect(screen.getByText("Checked by hand")).toBeTruthy();
    expect(screen.getAllByText("by Agent")).toHaveLength(1);
  });

  it("opens History on click", () => {
    render(<Harness />);
    const toggle = screen.getByRole("button", { name: /^History/ });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("orders the body: When, List, Labels, Location, Sub-tasks, Notes, then the disclosures", () => {
    render(<Harness />);
    const order = [
      document.getElementById("todo-scheduled")!,
      document.getElementById("todo-list")!,
      screen.getByText("Sub-tasks"),
      screen.getByLabelText("Notes"),
      screen.getByRole("button", { name: /^Attachments/ }),
      screen.getByRole("button", { name: /^History/ }),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(
        order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
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

  it("wears the rail as a short mark on the select trigger, not a full-height edge", () => {
    // The row's own rail (`railEdgeVars`), only as tall as the select (EI-396). The
    // full-height edge on the sheet is gone.
    render(<Harness todo={{ ...TODO, priority: 1 }} />);
    const mark = document.getElementById("todo-priority")!;
    expect(mark.getAttribute("data-priority-mark")).toBe("1");
    expect(mark.style.getPropertyValue("--rail-w")).toBe(`${PRIORITY_RAILS[1].width}px`);
    expect(mark.style.getPropertyValue("--rail-style")).toBe("double");
    expect(sheetContent().querySelector(":scope > [data-priority-rail]")).toBeNull();
  });

  it("wears no mark when the to-do is unprioritized", () => {
    render(<Harness todo={{ ...TODO, priority: null }} />);
    const mark = document.getElementById("todo-priority")!;
    expect(mark.style.getPropertyValue("--rail-w")).toBe("");
    expect(sheetContent().querySelector(":scope > [data-priority-rail]")).toBeNull();
  });

  it("has no hanging tab", () => {
    render(<Harness todo={{ ...TODO, priority: 2 }} />);
    expect(sheetContent().innerHTML).not.toContain("lg:-left-24");
    expect(sheetContent().innerHTML).not.toContain("lg:absolute");
  });

  it("keeps the priority select, id and options", () => {
    render(<Harness todo={{ ...TODO, priority: 2 }} />);
    const trigger = document.getElementById("todo-priority")!;
    expect(trigger.getAttribute("aria-label")).toBe("Priority");
    expect(trigger.textContent).toContain("P2");
  });
});

describe("the header's story line (EI-396)", () => {
  const ctx: PlacementContext = {
    today: "2026-08-11",
    visibleWindow: ["2026-08-11", "2026-08-12"],
    workdaysOnly: false,
    workdays: [1, 2, 3, 4, 5],
    overflowAfterDays: 3,
  };
  const story = () => document.querySelector('[data-slot="story-line"]');

  it("says where a rolled to-do came from and when it overflows", () => {
    render(<Harness todo={{ ...TODO, scheduledDate: "2026-08-08" }} ctx={ctx} />);
    expect(story()?.textContent).toBe("Rolled from Aug 8 · Overflow in 1 day");
  });

  it("says since when a to-do has been in Overflow", () => {
    render(<Harness todo={{ ...TODO, scheduledDate: "2026-08-04" }} ctx={ctx} />);
    expect(story()?.textContent).toMatch(/^In Overflow since Aug \d+ · \d+ days?$/);
  });

  it("shows the completion stamp with its planned note for a done to-do", () => {
    render(
      <Harness
        todo={{
          ...TODO,
          status: "done",
          scheduledDate: "2026-08-08",
          completedAt: "2026-08-11T12:05:00.000Z",
        }}
        ctx={ctx}
      />,
    );
    expect(story()?.textContent).toMatch(/^Completed Aug 11 · .* · planned Aug 8$/);
  });

  it("shows the Won't do stamp, and works without ctx", () => {
    render(
      <Harness
        todo={{ ...TODO, status: "dropped", completedAt: "2026-08-11T12:05:00.000Z" }}
      />,
    );
    expect(story()?.textContent).toMatch(/^Marked won’t do Aug 11/);
    expect(story()?.textContent).not.toContain("planned");
  });

  it("is absent for a plain to-do, and for a rolled one with no ctx", () => {
    const { rerender } = render(<Harness todo={{ ...TODO, scheduledDate: "2026-08-11" }} ctx={ctx} />);
    expect(story()).toBeNull();
    rerender(<Harness todo={{ ...TODO, scheduledDate: "2026-08-07" }} />);
    expect(story()).toBeNull();
  });

  it("is muted text-xs ink", () => {
    render(<Harness todo={{ ...TODO, scheduledDate: "2026-08-08" }} ctx={ctx} />);
    expect(story()?.className).toContain("text-xs");
    expect(story()?.className).toContain("text-muted-foreground");
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

  it("leaves right alone, and down never changes status", () => {
    // Overdrive's meaning for right needs its verdict state machine; down is
    // "back to list" (EI-396), which is not a status write.
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
