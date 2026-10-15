// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DndContext } from "@dnd-kit/core";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardColumn, FILTER_MIN_TODOS } from "./board-column";
import { dayGroupId, type TodoGroup } from "@/lib/board";
import { cardStop, groupStop } from "@/lib/column-nav";
import type { List, Todo } from "@/lib/schema";
import { ListColumnMenu } from "./list-column-menu";
import { dayRegionLabel, type PlacementContext } from "@/lib/scheduling";

/**
 * Grouped rendering, which `column-nav.test.tsx` does not reach — it covers the
 * arrow-key wiring, this covers what a group header and a wash actually render.
 *
 * happy-dom has no layout, so anything about size or overlap is on the manual
 * checklist in docs/DRAG-AND-DROP.md §8 instead.
 */

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

const ctx: PlacementContext = {
  today: "2026-08-09",
  visibleWindow: ["2026-08-09"],
  workdaysOnly: false,
  workdays: [1, 2, 3, 4, 5],
  overflowAfterDays: 3,
};

const todo = (id: string): Todo => ({
  id,
  ownerId: "local-user",
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
  deletedAt: null,
  title: id,
  description: null,
  status: "open",
  priority: null,
  scheduledDate: "2026-08-09",
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
  duplicateOf: null,
  duplicateHeld: null,
  suggestedListId: null,
});

const group = (
  key: string,
  name: string,
  todos: Todo[],
  color: string | null = null,
): TodoGroup => ({
  id: dayGroupId("2026-08-09", key),
  key,
  name,
  color,
  sortKey: name,
  // Untabbed: these groups are handed to the column already ordered, so the
  // tab level of `byListGroup` never runs here.
  tabKey: "",
  tabSortKey: "",
  todos,
});

const ADMIN = group("admin", "Admin", [todo("a1"), todo("a2")]);
const BUY = group("buy", "To Buy", [todo("b1")], "#e5484d");

interface HarnessProps {
  groups?: TodoGroup[];
  collapsedGroups?: ReadonlySet<string>;
  onToggleGroup?: (key: string) => void;
  overGroupId?: string | null;
  onOpenInfo?: () => void;
  todos?: Todo[];
  collapsed?: boolean;
  dueCount?: number;
  filter?: string;
  onFilterChange?: (query: string) => void;
  totalCount?: number;
  onQuickAdd?: (
    title: string,
    listId?: string,
    labelIds?: string[],
    literals?: readonly string[],
  ) => void;
  onCreateList?: (name: string) => void;
  lists?: { id: string; name: string; color: string | null }[];
  footer?: React.ReactNode;
  actions?: React.ReactNode;
  isColumnDragActive?: boolean;
  isColumnDropTarget?: boolean;
  headerMenu?: React.ReactNode;
  onRescheduleGroup?: (todos: readonly Todo[], date: string) => void;
  tone?: "urgent";
  regionLabel?: string;
  anchorId?: string;
}

function Harness({ groups, todos, ...rest }: HarnessProps) {
  const resolvedTodos = todos ?? (groups ? groups.flatMap((g) => g.todos) : [todo("flat")]);
  return (
    <TooltipProvider>
      <DndContext>
        <BoardColumn
          id="day:2026-08-09"
          title="Sunday"
          todos={resolvedTodos}
          labels={[]}
          ctx={ctx}
          groups={groups}
          onToggle={vi.fn()}
          onOpen={vi.fn()}
          onQuickAdd={vi.fn()}
          {...rest}
        />
      </DndContext>
    </TooltipProvider>
  );
}

const header = (name: string) => screen.getByRole("button", { name: new RegExp(name) });
const wash = (g: TodoGroup) => document.getElementById(`${g.id}-cards`)!;

describe("grouped rendering", () => {
  it("renders one header per group", () => {
    render(<Harness groups={[ADMIN, BUY]} />);
    expect(header("Admin, 2 to-dos")).toBeTruthy();
    expect(header("To Buy, 1 to-do")).toBeTruthy();
  });

  it("shows a count only when collapsed", () => {
    const { unmount } = render(<Harness groups={[ADMIN]} />);
    // Visible text, as distinct from the accessible name, which always has it.
    expect(header("Admin").textContent).not.toContain("2");
    unmount();

    render(<Harness groups={[ADMIN]} collapsedGroups={new Set(["admin"])} />);
    expect(header("Admin").textContent).toContain("2");
  });

  it("hides a collapsed group's cards", () => {
    render(<Harness groups={[ADMIN]} collapsedGroups={new Set(["admin"])} />);
    expect(screen.queryByText("a1")).toBeNull();
    expect(header("Admin").getAttribute("aria-expanded")).toBe("false");
  });

  it("toggles on click and on Enter", () => {
    const onToggleGroup = vi.fn();
    render(<Harness groups={[ADMIN]} onToggleGroup={onToggleGroup} />);
    fireEvent.click(header("Admin"));
    expect(onToggleGroup).toHaveBeenCalledWith("admin");
  });

  it("keeps headers out of the tab order but on the nav grid", () => {
    render(<Harness groups={[ADMIN]} />);
    // Arrow-reachable, not Tab-reachable: 28 new Tab stops in a seven-day week
    // with four lists would all sit ahead of the first quick-add.
    expect(header("Admin").getAttribute("tabindex")).toBe("-1");
    expect(header("Admin").getAttribute("data-nav-stop")).toBe(groupStop(ADMIN.id));
  });
});

/** The list group header's right-click menu (EI-337). */
describe("group header menu", () => {
  it("is the header button itself, not a wrapper around it", () => {
    render(<Harness groups={[ADMIN]} onRescheduleGroup={vi.fn()} />);
    const el = header("Admin");
    expect(el.tagName).toBe("BUTTON");
    expect(el.getAttribute("data-slot")).toBe("context-menu-trigger");
    expect(el.getAttribute("data-nav-stop")).toBe(groupStop(ADMIN.id));
  });

  it("opens only where a column can both add and reschedule", async () => {
    const { unmount } = render(<Harness groups={[ADMIN]} onRescheduleGroup={vi.fn()} />);
    fireEvent.contextMenu(header("Admin"));
    expect(await screen.findByRole("menuitem", { name: "New to-do here" })).toBeTruthy();
    unmount();

    // Overflow: no quick-add, so no menu.
    render(<Harness groups={[ADMIN]} onRescheduleGroup={vi.fn()} onQuickAdd={undefined} />);
    fireEvent.contextMenu(header("Admin"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("counts only the open to-dos Reschedule will move", async () => {
    const done = { ...todo("a3"), status: "done" as const };
    render(
      <Harness
        groups={[group("admin", "Admin", [todo("a1"), todo("a2"), done])]}
        onRescheduleGroup={vi.fn()}
      />,
    );
    fireEvent.contextMenu(header("Admin"));
    expect(await screen.findByRole("menuitem", { name: "Reschedule 2" })).toBeTruthy();
  });

  it("New to-do here files the title into that list, and Escape discards", async () => {
    const onQuickAdd = vi.fn();
    render(
      <Harness groups={[ADMIN]} onRescheduleGroup={vi.fn()} onQuickAdd={onQuickAdd} />,
    );
    fireEvent.contextMenu(header("Admin"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "New to-do here" }));

    const field = await screen.findByRole("textbox", { name: "New to-do in Admin" });
    fireEvent.change(field, { target: { value: "Call the bank" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onQuickAdd).toHaveBeenCalledWith("Call the bank", "admin");

    fireEvent.change(field, { target: { value: "never mind" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "New to-do in Admin" })).toBeNull();
    expect(onQuickAdd).toHaveBeenCalledTimes(1);
  });
});

describe("the list wash", () => {
  it("goes behind the cards, so hover still composites over it", () => {
    render(<Harness groups={[BUY]} />);
    // Asserted as "present, and on the wrapper rather than the row" — the exact
    // serialisation of an 8-digit hex is the DOM implementation's business. On the
    // card row an inline background would beat `hover:bg-accent/50` outright,
    // which is why it lives here at all.
    expect(wash(BUY).style.backgroundColor).toBeTruthy();
    expect(wash(BUY).contains(screen.getByText("b1"))).toBe(true);
  });

  it("renders no background for an uncolored list", () => {
    render(<Harness groups={[ADMIN]} />);
    expect(wash(ADMIN).style.backgroundColor).toBe("");
    expect(header("Admin").style.borderColor).toBe("");
  });
});

describe("flat rendering, for the planning half", () => {
  it("renders no headers and no wash without groups", () => {
    render(<Harness />);
    expect(screen.getByText("flat")).toBeTruthy();
    expect(document.querySelector("[data-nav-stop^='group:']")).toBeNull();
  });
});

describe("drop indicators", () => {
  it("draws exactly one, even with a group hovered", () => {
    // `readLandingRect()` depends on this: with two, the dragged card flies to
    // whichever one `querySelector` finds first.
    render(<Harness groups={[ADMIN, BUY]} overGroupId={ADMIN.id} />);
    expect(document.querySelectorAll("[data-drop-indicator]")).toHaveLength(1);
  });

  /**
   * EI-193. A DAY column can now be a column-drag drop target — dropping a
   * list on it schedules that list's unscheduled to-dos. Before this, only
   * the planning half ever received this chrome.
   */
  it("outlines a day column that a dragged list would schedule onto", () => {
    render(<Harness isColumnDragActive isColumnDropTarget />);
    const section = document.querySelector<HTMLElement>("section")!;
    expect(section.className).toContain("outline-primary");
    expect(section.hasAttribute("data-drop-indicator")).toBe(true);
  });

  it("draws no chrome on a day column a list is merely passing over", () => {
    render(<Harness isColumnDragActive />);
    const section = document.querySelector<HTMLElement>("section")!;
    expect(section.hasAttribute("data-drop-indicator")).toBe(false);
    // Candidate outlines are card-drag only, so a list drag must not raise
    // the dashed border on every column it flies past.
    expect(section.className).not.toContain("border-dashed");
  });

  it("still draws exactly one indicator during a list-onto-day drag", () => {
    // The flight target. A group indicator co-existing here would send the
    // chip to the wrong place, and nothing would report it.
    render(<Harness groups={[ADMIN, BUY]} isColumnDragActive isColumnDropTarget />);
    expect(document.querySelectorAll("[data-drop-indicator]")).toHaveLength(1);
  });
});

// Ruled filler rows were removed in the V3.5 pass (docs/DESIGN.md §3): with
// columns as bordered panels and no row dividers, empty space is just the
// panel — decorative rules would fight the cleaner surface.

describe("column heading", () => {
  it("fires onOpenInfo when the heading is activated", () => {
    const onOpenInfo = vi.fn();
    render(<Harness onOpenInfo={onOpenInfo} />);
    fireEvent.click(screen.getByRole("button", { name: "Sunday" }));
    expect(onOpenInfo).toHaveBeenCalledTimes(1);
  });

  it("is a real button, so the keyboard reaches it", () => {
    // The bare `<h2 onClick>` this replaced was pointer-only.
    render(<Harness onOpenInfo={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Sunday" }).tagName).toBe("BUTTON");
  });

  it("renders plain text when there is nothing to open", () => {
    render(<Harness />);
    expect(screen.queryByRole("button", { name: "Sunday" })).toBeNull();
    expect(screen.getByText("Sunday")).toBeTruthy();
  });
});

/**
 * EI-374. Overflow's red is said once, by the column — and only while it has
 * something in it. The count was already gated on `todos.length`; the rule
 * under the title was not, so an empty Overflow still wore a red line.
 */
describe("the urgent tone", () => {
  const urgentRule = () => document.querySelector("[class*='border-urgent']");

  it("draws the red rule and the count while the column holds something", () => {
    render(<Harness tone="urgent" todos={[todo("o1"), todo("o2")]} />);
    expect(urgentRule()).not.toBeNull();
    expect(urgentRule()?.textContent).toContain("2");
  });

  it("draws neither on an empty column", () => {
    render(<Harness tone="urgent" todos={[]} />);
    expect(urgentRule()).toBeNull();
    expect(document.querySelector("[class*='text-urgent']")).toBeNull();
  });

  it("draws the rule at 70%, the alpha that clears 3:1 on the rail's surface", () => {
    // EI-382: /40 measured 2.09:1 light and 1.98:1 dark on `surface-0`;
    // /70 is 3.51:1 and 3.68:1.
    render(<Harness tone="urgent" todos={[todo("o1")]} />);
    const cls = urgentRule()!.className.split(/\s+/);
    expect(cls).toContain("border-b-2");
    expect(cls).toContain("border-urgent/70");
    expect(cls).not.toContain("border-urgent/40");
  });
});

describe("due banner", () => {
  const banner = () => document.querySelector("[data-due-banner]");

  it("renders nothing when dueCount is undefined", () => {
    render(<Harness />);
    expect(banner()).toBeNull();
  });

  it("renders nothing when dueCount is zero", () => {
    render(<Harness dueCount={0} />);
    expect(banner()).toBeNull();
  });

  it("is a button, gated on onOpenInfo, that fires it once on click", () => {
    const onOpenInfo = vi.fn();
    render(<Harness dueCount={3} onOpenInfo={onOpenInfo} />);
    const el = banner()!;
    expect(el.tagName).toBe("BUTTON");
    expect(el.getAttribute("data-due-banner")).toBe("3");
    fireEvent.click(el);
    expect(onOpenInfo).toHaveBeenCalledTimes(1);
  });

  it("names the button with the count and the singular/plural to-do", () => {
    render(<Harness dueCount={3} onOpenInfo={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Show the 3 to-dos due on this day" }),
    ).toBeTruthy();
  });

  it("reads as singular for a count of one", () => {
    render(<Harness dueCount={1} onOpenInfo={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Show the 1 to-do due on this day" }),
    ).toBeTruthy();
  });

  it("stays inert text, not a button, without onOpenInfo — but still carries the marker", () => {
    render(<Harness dueCount={3} />);
    expect(screen.queryByRole("button", { name: /due on this day/ })).toBeNull();
    const el = banner()!;
    expect(el.tagName).toBe("DIV");
    expect(el.getAttribute("data-due-banner")).toBe("3");
  });

  it("speaks in the urgent channel's text ink, off the smallest size, in both forms", () => {
    // EI-382: `--urgent` at `text-2xs` on the banner's tint failed 4.5:1.
    for (const onOpenInfo of [vi.fn(), undefined]) {
      cleanup();
      render(<Harness dueCount={3} onOpenInfo={onOpenInfo} />);
      const cls = banner()!.className.split(/\s+/);
      expect(cls).toContain("text-urgent-foreground");
      expect(cls).not.toContain("text-urgent");
      expect(cls).toContain("text-xs");
      expect(cls).not.toContain("text-2xs");
    }
  });

  it("never renders when the column is collapsed", () => {
    render(<Harness dueCount={3} onOpenInfo={vi.fn()} collapsed />);
    expect(banner()).toBeNull();
  });
});

describe("in-column filter", () => {
  const manyTodos = (n: number) => Array.from({ length: n }, (_, i) => todo(`t${i}`));
  const filterInput = () => screen.queryByRole("textbox", { name: "Filter Sunday" });

  it("stays hidden below the threshold", () => {
    render(
      <Harness
        todos={manyTodos(FILTER_MIN_TODOS - 1)}
        onFilterChange={vi.fn()}
        totalCount={FILTER_MIN_TODOS - 1}
      />,
    );
    expect(filterInput()).toBeNull();
  });

  it("appears once the column reaches the threshold", () => {
    render(
      <Harness
        todos={manyTodos(FILTER_MIN_TODOS)}
        onFilterChange={vi.fn()}
        totalCount={FILTER_MIN_TODOS}
      />,
    );
    expect(filterInput()).toBeTruthy();
  });

  it("names the column's unfiltered total in the idle placeholder", () => {
    render(
      <Harness
        todos={manyTodos(FILTER_MIN_TODOS)}
        onFilterChange={vi.fn()}
        totalCount={14}
      />,
    );
    expect(filterInput()!.getAttribute("placeholder")).toBe("Filter 14 to-dos");
  });

  it("singularizes the placeholder for exactly one to-do", () => {
    render(<Harness todos={[todo("only")]} filter="o" onFilterChange={vi.fn()} totalCount={1} />);
    expect(filterInput()!.getAttribute("placeholder")).toBe("Filter 1 to-do");
  });

  it("falls back to todos.length when totalCount is omitted", () => {
    const todos = manyTodos(FILTER_MIN_TODOS);
    render(<Harness todos={todos} filter="x" onFilterChange={vi.fn()} />);
    expect(filterInput()!.getAttribute("placeholder")).toBe(`Filter ${FILTER_MIN_TODOS} to-dos`);
  });

  it("stays mounted while a filter is active even below the threshold", () => {
    render(
      <Harness
        todos={[todo("only")]}
        filter="on"
        onFilterChange={vi.fn()}
        totalCount={FILTER_MIN_TODOS - 1}
      />,
    );
    expect(filterInput()).toBeTruthy();
  });

  it("never renders when the column is collapsed", () => {
    render(
      <Harness
        todos={manyTodos(FILTER_MIN_TODOS)}
        onFilterChange={vi.fn()}
        totalCount={FILTER_MIN_TODOS}
        collapsed
      />,
    );
    expect(filterInput()).toBeNull();
  });

  it("calls onFilterChange as the user types", () => {
    const onFilterChange = vi.fn();
    render(
      <Harness
        todos={manyTodos(FILTER_MIN_TODOS)}
        onFilterChange={onFilterChange}
        totalCount={FILTER_MIN_TODOS}
      />,
    );
    fireEvent.change(filterInput()!, { target: { value: "gro" } });
    expect(onFilterChange).toHaveBeenCalledWith("gro");
  });

  it("Escape clears an active filter, then blurs on the next press", () => {
    const onFilterChange = vi.fn();
    const { rerender } = render(
      <Harness
        todos={[todo("only")]}
        filter="gro"
        onFilterChange={onFilterChange}
        totalCount={FILTER_MIN_TODOS}
      />,
    );
    const input = filterInput()!;
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onFilterChange).toHaveBeenCalledWith("");
    expect(document.activeElement).toBe(input);

    // Simulate the controlling parent applying the clear, as
    // `use-board-ui-state.ts`'s `setColumnFilter` would.
    onFilterChange.mockClear();
    rerender(
      <Harness
        todos={[todo("only")]}
        filter=""
        onFilterChange={onFilterChange}
        totalCount={FILTER_MIN_TODOS}
      />,
    );
    fireEvent.keyDown(filterInput()!, { key: "Escape" });
    expect(onFilterChange).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(filterInput());
  });

  it("focuses the filter on '/' from a focused card row", () => {
    const todos = manyTodos(FILTER_MIN_TODOS);
    render(<Harness todos={todos} onFilterChange={vi.fn()} totalCount={FILTER_MIN_TODOS} />);
    const row = document.querySelector(`[data-nav-stop="${cardStop("t0")}"]`) as HTMLElement;
    row.focus();
    fireEvent.keyDown(row, { key: "/" });
    expect(document.activeElement).toBe(filterInput());
  });

  it("does not steal '/' typed into quick-add", () => {
    const todos = manyTodos(FILTER_MIN_TODOS);
    render(<Harness todos={todos} onFilterChange={vi.fn()} totalCount={FILTER_MIN_TODOS} />);
    const addInput = screen.getByRole("textbox", { name: "Add a to-do to Sunday" });
    addInput.focus();
    fireEvent.keyDown(addInput, { key: "/" });
    expect(document.activeElement).toBe(addInput);
  });

  it("shows a bordered 'n of m to-dos' chip, outside the input group, only while a filter is active", () => {
    const { rerender } = render(
      <Harness
        todos={manyTodos(FILTER_MIN_TODOS)}
        onFilterChange={vi.fn()}
        totalCount={FILTER_MIN_TODOS}
      />,
    );
    expect(document.querySelector("span.num")).toBeNull();

    rerender(
      <Harness
        todos={[todo("t0")]}
        filter="t0"
        onFilterChange={vi.fn()}
        totalCount={FILTER_MIN_TODOS}
      />,
    );
    // Only the two counts are `num` (monospace); "of"/"to-dos" stay in the
    // body font, so they render as separate elements from the chip's words.
    const counts = document.querySelectorAll("span.num");
    expect(Array.from(counts).map((el) => el.textContent)).toEqual(["1", "8"]);

    const chip = counts[0].closest("span.rounded-md");
    expect(chip?.textContent?.replace(/\s+/g, " ").trim()).toBe("1 of 8 to-dos");
    expect(chip?.className).toContain("border");
    // Outside the input group, not one of its addons — see the component's
    // comment on why this moved.
    expect(chip?.closest('[data-slot="input-group"]')).toBeNull();
  });

  it("names the query and offers a clear-filter exit when the filter leaves nothing", () => {
    render(<Harness todos={[]} filter="nothing" onFilterChange={vi.fn()} totalCount={12} />);
    expect(screen.getByText(/No to-dos match/)).toBeTruthy();
    expect(screen.getByText("Clear filter")).toBeTruthy();
  });

  it("clears the filter when a quick-add commits", () => {
    const onFilterChange = vi.fn();
    const onQuickAdd = vi.fn();
    render(
      <Harness
        todos={[todo("only")]}
        filter="gro"
        onFilterChange={onFilterChange}
        onQuickAdd={onQuickAdd}
        totalCount={FILTER_MIN_TODOS}
      />,
    );
    const addInput = screen.getByRole("textbox", { name: "Add a to-do to Sunday" });
    fireEvent.change(addInput, { target: { value: "New task" } });
    fireEvent.keyDown(addInput, { key: "Enter" });
    expect(onQuickAdd).toHaveBeenCalledWith("New task", undefined, [], []);
    expect(onFilterChange).toHaveBeenCalledWith("");
  });
});

/**
 * EI-110 follow-up: matched date/time/priority words now fold out of the
 * visible quick-add text the moment their own trailing space lands — the
 * same "removed from the string" treatment `#label`/`@list` mentions already
 * get, since typing them left them sitting unstripped in the field even
 * though the final title already excluded them. See `foldQuickAddDraft`
 * (lib/quick-add.ts) for the pure logic this wires up.
 */
describe("quick-add — folding a completed date/time word out of the input", () => {
  const addInput = () => screen.getByRole("textbox", { name: "Add a to-do to Sunday" });

  it("folds a trailing date word out of the visible input once its space lands", () => {
    render(<Harness />);
    fireEvent.change(addInput(), { target: { value: "Buy milk tomorrow " } });
    expect(addInput()).toHaveProperty("value", "Buy milk ");
  });

  it("leaves a still-in-progress word alone", () => {
    render(<Harness />);
    fireEvent.change(addInput(), { target: { value: "Buy milk tom" } });
    expect(addInput()).toHaveProperty("value", "Buy milk tom");
  });

  const keep = (word: string) => screen.queryByRole("button", { name: `Keep “${word}” in the title` });

  it("shows the folded word as a dismissible chip", () => {
    render(<Harness />);
    fireEvent.change(addInput(), { target: { value: "Buy milk tomorrow " } });
    expect(keep("tomorrow")).toBeTruthy();
  });

  it("dismissing the chip puts the word back in the title, unparsed (EI-375)", () => {
    const onQuickAdd = vi.fn();
    render(<Harness onQuickAdd={onQuickAdd} />);
    fireEvent.change(addInput(), { target: { value: "Buy milk tomorrow " } });
    fireEvent.mouseDown(keep("tomorrow")!);
    expect(keep("tomorrow")).toBeNull();
    expect(addInput()).toHaveProperty("value", "Buy milk tomorrow");
    // It must not fold straight back out on the next space.
    fireEvent.change(addInput(), { target: { value: "Buy milk tomorrow " } });
    expect(addInput()).toHaveProperty("value", "Buy milk tomorrow ");
    fireEvent.keyDown(addInput(), { key: "Enter" });
    expect(onQuickAdd).toHaveBeenCalledWith("Buy milk tomorrow", undefined, [], ["tomorrow"]);
  });

  it("committing reappends the folded word so the created todo still gets the parsed field", () => {
    const onQuickAdd = vi.fn();
    render(<Harness onQuickAdd={onQuickAdd} />);
    fireEvent.change(addInput(), { target: { value: "Buy milk tomorrow " } });
    fireEvent.keyDown(addInput(), { key: "Enter" });
    expect(onQuickAdd).toHaveBeenCalledWith("Buy milk tomorrow", undefined, [], []);
    expect(addInput()).toHaveProperty("value", "");
  });

  it("Escape clears both the live text and any folded chip", () => {
    render(<Harness />);
    fireEvent.change(addInput(), { target: { value: "Buy milk tomorrow " } });
    expect(keep("tomorrow")).toBeTruthy();
    fireEvent.keyDown(addInput(), { key: "Escape" });
    expect(keep("tomorrow")).toBeNull();
    expect(addInput()).toHaveProperty("value", "");
  });

  it("a second date word puts the first back in the field and shows as 'not used' (EI-379)", () => {
    render(<Harness />);
    fireEvent.change(addInput(), { target: { value: "Buy milk tomorrow " } });
    fireEvent.change(addInput(), { target: { value: "Buy milk fri " } });
    expect(addInput()).toHaveProperty("value", "Buy milk tomorrow fri ");
    expect(screen.getAllByRole("button", { name: /^Keep “/ })).toHaveLength(1);
    expect(keep("tomorrow")).toBeTruthy();
    expect(screen.getByText("fri · not used")).toBeTruthy();
  });
});

/**
 * EI-379: one date wins — the earliest — and every other date phrase stays
 * in the title with a dashed "not used" chip. Never dropped without one.
 */
describe("quick-add — a second date is 'not used', never dropped (EI-379)", () => {
  const addInput = () => screen.getByRole("textbox", { name: "Add a to-do to Sunday" });
  const keep = (word: string) => screen.queryByRole("button", { name: `Keep “${word}” in the title` });

  it("shows the winner as a dismissible chip and the other as a dashed one with a hint", () => {
    render(<Harness />);
    fireEvent.change(addInput(), { target: { value: "Call about Thursday oct 1" } });
    // ctx.today is Sunday 2026-08-09.
    expect(screen.getByText("Thu Aug 13")).toBeTruthy();
    expect(keep("Thursday")).toBeTruthy();
    const notUsed = screen.getByText("oct 1 · not used");
    expect(notUsed.className).toContain("border-dashed");
    expect(notUsed.getAttribute("title")).toMatch(/Only the first date is used/);
    // Not dismissible: the word is already title text.
    expect(keep("oct 1")).toBeNull();
  });

  it("dismissing the winner hands the date to the other one", () => {
    const onQuickAdd = vi.fn();
    render(<Harness onQuickAdd={onQuickAdd} />);
    fireEvent.change(addInput(), { target: { value: "Call about Thursday oct 1" } });
    fireEvent.mouseDown(keep("Thursday")!);
    expect(screen.queryByText("oct 1 · not used")).toBeNull();
    expect(screen.getByText("Thu Oct 1")).toBeTruthy();
    expect(keep("oct 1")).toBeTruthy();
    fireEvent.keyDown(addInput(), { key: "Enter" });
    expect(onQuickAdd).toHaveBeenCalledWith("Call about Thursday oct 1", undefined, [], ["Thursday"]);
  });

  it("an Enter before the next space still commits the first date as the winner", () => {
    const onQuickAdd = vi.fn();
    render(<Harness onQuickAdd={onQuickAdd} />);
    fireEvent.change(addInput(), { target: { value: "Buy milk tomorrow " } });
    fireEvent.change(addInput(), { target: { value: "Buy milk fri" } });
    expect(screen.getByText("fri · not used")).toBeTruthy();
    fireEvent.keyDown(addInput(), { key: "Enter" });
    // The folded word goes back where it was typed, so the parse at write
    // time sees "tomorrow" first — the same thing the preview showed.
    expect(onQuickAdd).toHaveBeenCalledWith("Buy milk tomorrow fri", undefined, [], []);
  });

  it("a word-only date at the start says it was not used", () => {
    render(<Harness />);
    fireEvent.change(addInput(), { target: { value: "Wednesday anchor" } });
    const chip = screen.getByText("Wednesday · not used");
    expect(chip.getAttribute("title")).toMatch(/at the end to schedule it/);
  });
});

/**
 * EI-375: a date word inside a sentence still parses — the owner's call —
 * so its chip is the one place a misread shows, and it has to be
 * dismissible by mouse and by keyboard without committing the field.
 */
describe("quick-add — a dismissible date chip (EI-375)", () => {
  const addInput = () => screen.getByRole("textbox", { name: "Add a to-do to Sunday" });
  const keepThursday = () =>
    screen.queryByRole("button", { name: "Keep “Thursday” in the title" });

  it("shows the date a mid-sentence word parsed to", () => {
    render(<Harness />);
    fireEvent.change(addInput(), { target: { value: "Call the dentist about Thursday" } });
    // ctx.today is Sunday 2026-08-09, so Thursday is Aug 13.
    expect(screen.getByText("Thu Aug 13")).toBeTruthy();
    expect(keepThursday()).toBeTruthy();
  });

  it("× by mouse keeps the word in the title and files it unscheduled", () => {
    const onQuickAdd = vi.fn();
    render(<Harness onQuickAdd={onQuickAdd} />);
    fireEvent.change(addInput(), { target: { value: "Call the dentist about Thursday" } });
    fireEvent.mouseDown(keepThursday()!);
    expect(screen.queryByText("Thu Aug 13")).toBeNull();
    expect(addInput()).toHaveProperty("value", "Call the dentist about Thursday");
    fireEvent.keyDown(addInput(), { key: "Enter" });
    expect(onQuickAdd).toHaveBeenCalledWith(
      "Call the dentist about Thursday",
      undefined,
      [],
      ["Thursday"],
    );
  });

  it("is reachable from the keyboard: Tab to it does not commit, Enter dismisses, focus returns", () => {
    const onQuickAdd = vi.fn();
    render(<Harness onQuickAdd={onQuickAdd} />);
    addInput().focus();
    fireEvent.change(addInput(), { target: { value: "Call the dentist about Thursday" } });
    const chip = keepThursday()!;
    // Tab: focus moves from the field to the chip inside the same row.
    fireEvent.blur(addInput(), { relatedTarget: chip });
    chip.focus();
    expect(onQuickAdd).not.toHaveBeenCalled();
    // Enter/Space on a button is a click with `detail === 0`.
    fireEvent.click(chip, { detail: 0 });
    expect(keepThursday()).toBeNull();
    expect(document.activeElement).toBe(addInput());
    expect(addInput()).toHaveProperty("value", "Call the dentist about Thursday");
  });

  it("still commits when focus leaves the row entirely", () => {
    const onQuickAdd = vi.fn();
    render(<Harness onQuickAdd={onQuickAdd} />);
    fireEvent.change(addInput(), { target: { value: "Buy milk" } });
    fireEvent.blur(addInput(), { relatedTarget: null });
    expect(onQuickAdd).toHaveBeenCalledWith("Buy milk", undefined, [], []);
  });
});

describe("quick-add — typed @mentions (EI-375)", () => {
  const addInput = () => screen.getByRole("textbox", { name: "Add a to-do to Sunday" });
  const LISTS = [
    { id: "read", name: "To Read", color: null },
    { id: "buy", name: "To Buy", color: null },
  ];

  it("shows a typed-out @to-read as filing into To Read once the caret leaves it", () => {
    render(<Harness lists={LISTS} />);
    fireEvent.change(addInput(), { target: { value: "Dune @to-read later" } });
    expect(screen.getByText("→ To Read")).toBeTruthy();
  });

  it("shows an @mention that matched no list as a dashed chip, with Create list", () => {
    const onCreateList = vi.fn();
    render(<Harness lists={LISTS} onCreateList={onCreateList} />);
    fireEvent.change(addInput(), { target: { value: "Dune @novels later" } });
    expect(screen.getByText("@novels · no list")).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("button", { name: "Create a list called “novels”" }));
    expect(onCreateList).toHaveBeenCalledWith("novels");
  });

  it("says nothing about the mention still being typed", () => {
    render(<Harness lists={LISTS} />);
    const input = addInput();
    fireEvent.change(input, { target: { value: "Dune @nov" } });
    fireEvent.select(input, { target: { selectionStart: 9 } });
    expect(screen.queryByText(/no list/)).toBeNull();
  });
});

/**
 * `footer` — EI-97's Overdrive entry button slot. Board-column itself only
 * has to place the node and respect `collapsed`; whether the button decides
 * to render at all is `OverdriveButton`'s own concern (`overdrive-button.tsx`).
 */
describe("footer", () => {
  it("renders the given node below the card list", () => {
    render(<Harness footer={<div data-testid="overdrive-entry">Overdrive · 12</div>} />);
    expect(screen.getByTestId("overdrive-entry")).toBeTruthy();
  });

  it("is absent when no footer is given", () => {
    render(<Harness />);
    expect(screen.queryByTestId("overdrive-entry")).toBeNull();
  });

  it("never renders when the column is collapsed", () => {
    render(
      <Harness collapsed footer={<div data-testid="overdrive-entry">Overdrive · 12</div>} />,
    );
    expect(screen.queryByTestId("overdrive-entry")).toBeNull();
  });

  it("wraps the footer in a sticky bottom-anchored box (round 4)", () => {
    render(<Harness footer={<div data-testid="overdrive-entry">Overdrive · 12</div>} />);
    const wrapper = screen.getByTestId("overdrive-entry").parentElement;
    expect(wrapper?.className).toContain("sticky");
    expect(wrapper?.className).toContain("bottom-0");
  });
});

/**
 * `actions` — the header's right-aligned slot. Overflow/Backlog pass
 * `RailCollapseButton` here; EI-253 is the first thing to pass it on a DAY
 * column (`Harness`'s own header is already day-shaped: no `reorderListId`,
 * so no drag chrome to potentially collide with). Board-column itself only
 * has to place the node next to the title — whether it renders at all is
 * `DayOverdriveButton`'s own concern (`overdrive-button.tsx`).
 */
describe("actions", () => {
  it("renders the given node in the header, alongside the title", () => {
    render(<Harness actions={<div data-testid="day-overdrive-entry">Overdrive · 7</div>} />);
    expect(screen.getByTestId("day-overdrive-entry")).toBeTruthy();
  });

  it("is absent when no actions node is given", () => {
    render(<Harness />);
    expect(screen.queryByTestId("day-overdrive-entry")).toBeNull();
  });

  it("coexists with onOpenInfo — clicking the action does not open the day sheet", () => {
    const onOpenInfo = vi.fn();
    const onAction = vi.fn();
    render(
      <Harness
        onOpenInfo={onOpenInfo}
        actions={
          <button type="button" data-testid="day-overdrive-entry" onClick={onAction}>
            Overdrive
          </button>
        }
      />,
    );
    fireEvent.click(screen.getByTestId("day-overdrive-entry"));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onOpenInfo).not.toHaveBeenCalled();
  });

  it("never renders when the column is collapsed", () => {
    render(
      <Harness collapsed actions={<div data-testid="day-overdrive-entry">Overdrive · 7</div>} />,
    );
    expect(screen.queryByTestId("day-overdrive-entry")).toBeNull();
  });
});

/**
 * The header's right-click menu (EI-286).
 *
 * The header is also the column's drag surface and its landmark element, so
 * these guard the two things making it a trigger could silently take away:
 * that it is still a `<header>`, and that the existing drag/nav tests above
 * still pass unchanged — which is the real regression test.
 */
describe("header context menu", () => {
  const menu = (
    <ListColumnMenu
      list={
        {
          id: "l1",
          name: "Errands",
          color: null,
          tabId: "tab1",
        } as unknown as List
      }
      tabsById={new Map()}
      onSave={vi.fn()}
      onArchive={vi.fn()}
      onDelete={vi.fn()}
      onOpenInfo={vi.fn()}
    />
  );

  const headerEl = () => document.querySelector("header") as HTMLElement;

  it("renders no menu without the prop", () => {
    render(<Harness />);
    fireEvent.contextMenu(headerEl());
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens on right-click when given one", async () => {
    render(<Harness headerMenu={menu} />);
    fireEvent.contextMenu(headerEl());
    expect(await screen.findByRole("menuitem", { name: "Archive" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
  });

  it("keeps the header a real <header>, not a div", () => {
    render(<Harness headerMenu={menu} />);
    const el = headerEl();
    expect(el.tagName).toBe("HEADER");
    expect(el.getAttribute("data-slot")).toBe("context-menu-trigger");
  });

  it("offers every accent color plus an explicit none", async () => {
    render(<Harness headerMenu={menu} />);
    fireEvent.contextMenu(headerEl());
    fireEvent.click(await screen.findByRole("menuitem", { name: "Color" }));
    const swatches = await screen.findAllByRole("menuitemradio");
    // Hardcoded, not `ACCENT_COLORS.length + 1`: an expectation derived from
    // the same constant the code maps over cannot fail (lessons L1108).
    expect(swatches).toHaveLength(11);
    expect(screen.getByRole("menuitemradio", { name: "Tomato" })).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: "Pink" })).toBeTruthy();
    // A list with no color of its own says so, and stays selected.
    const none = screen.getByRole("menuitemradio", { name: "None" });
    expect(none.getAttribute("aria-checked")).toBe("true");
  });
});

describe("accessibility floor (EI-378)", () => {
  it("names a day's region with its date when given one", () => {
    render(<Harness regionLabel="Sunday, Aug 9" />);
    // Exact: the name is the weekday AND the date, not the weekday alone —
    // a board renders ~30 days, so "Sunday" by itself repeats.
    expect(screen.getByRole("region", { name: "Sunday, Aug 9" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Sunday" })).toBeNull();
  });

  it("names today's region \"Today\" as well, keeping the weekday findable (EI-381)", () => {
    render(<Harness regionLabel={dayRegionLabel(ctx.today, ctx.today)} />);
    expect(screen.getByRole("region", { name: "Today, Sunday, Aug 9" })).toBeTruthy();
    // e2e selects day regions by weekday substring; today must still match.
    expect(screen.getByRole("region", { name: /Sunday, Aug 9/ })).toBeTruthy();
  });

  it("tags the section with its column id, for the skip links (EI-381)", () => {
    render(<Harness />);
    const region = screen.getByRole("region", { name: "Sunday" });
    expect(region.getAttribute("data-column-id")).toBe("day:2026-08-09");
  });

  it("carries a skip link's target id only when given one (EI-386)", () => {
    const { unmount } = render(<Harness anchorId="today" />);
    expect(screen.getByRole("region", { name: "Sunday" }).id).toBe("today");
    unmount();
    render(<Harness />);
    expect(screen.getByRole("region", { name: "Sunday" }).hasAttribute("id")).toBe(false);
  });

  it("falls back to the title when no region label is given", () => {
    render(<Harness />);
    expect(screen.getByRole("region", { name: "Sunday" })).toBeTruthy();
  });

  it("gives the quick-add a visible focus and keeps it clear of the +", () => {
    render(<Harness />);
    const field = screen.getByRole("textbox", { name: "Add a to-do to Sunday" });
    const cls = field.className.split(/\s+/);
    // The shared spectrum outline, not a bare `outline-none` with nothing
    // in its place (which is what this field used to have).
    expect(cls).toContain("focus-ring");
    expect(cls).not.toContain("outline-none");
    // Unconditional: the + is also revealed by hover and on touch, not only
    // on focus, so padding that followed focus let it overlap the "A".
    expect(cls).toContain("pl-6");
    expect(cls.some((c) => c.endsWith(":pl-6"))).toBe(false);
  });

  it("keeps Overflow's red count off the smallest size", () => {
    render(<Harness tone="urgent" todos={[todo("o1"), todo("o2")]} />);
    const count = [...document.querySelectorAll<HTMLElement>("header span[aria-hidden]")].find(
      (el) => el.textContent === "2",
    )!;
    // Still red: the channel's text token, which passes on the chip's tint.
    expect(count.className).toContain("text-urgent-foreground");
    expect(count.className).toContain("text-xs");
    expect(count.className).not.toContain("text-2xs");
  });
});
