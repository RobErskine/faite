// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DndContext } from "@dnd-kit/core";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardColumn, FILTER_MIN_TODOS } from "./board-column";
import { dayGroupId, type TodoGroup } from "@/lib/board";
import { cardStop, groupStop } from "@/lib/column-nav";
import type { Todo } from "@/lib/schema";
import type { PlacementContext } from "@/lib/scheduling";

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
  todos,
});

const ADMIN = group("admin", "Admin", [todo("a1"), todo("a2")]);
const BUY = group("buy", "To Buy", [todo("b1")], "#e5484d");

interface HarnessProps {
  groups?: TodoGroup[];
  collapsedGroups?: ReadonlySet<string>;
  onToggleGroup?: (key: string) => void;
  overGroupId?: string | null;
  minRows?: number;
  onOpenInfo?: () => void;
  todos?: Todo[];
  collapsed?: boolean;
  filter?: string;
  onFilterChange?: (query: string) => void;
  totalCount?: number;
  onQuickAdd?: (title: string, listId?: string, labelIds?: string[]) => void;
  footer?: React.ReactNode;
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
});

describe("filler rows", () => {
  it("counts headers as occupied space", () => {
    const rows = (props: HarnessProps) => {
      const { unmount } = render(<Harness {...props} />);
      const count = document.querySelectorAll(".h-8").length;
      unmount();
      return count;
    };
    // Two groups of three cards total: 8 - 3 - 2 headers = 3.
    expect(rows({ groups: [ADMIN, BUY], minRows: 8 })).toBe(3);
  });
});

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

  it("shows a bordered 'n of m todos' chip, outside the input group, only while a filter is active", () => {
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
    // Only the two counts are `num` (monospace); "of"/"todos" stay in the
    // body font, so they render as separate elements from the chip's words.
    const counts = document.querySelectorAll("span.num");
    expect(Array.from(counts).map((el) => el.textContent)).toEqual(["1", "8"]);

    const chip = counts[0].closest("span.rounded-md");
    expect(chip?.textContent?.replace(/\s+/g, " ").trim()).toBe("1 of 8 todos");
    expect(chip?.className).toContain("border");
    // Outside the input group, not one of its addons — see the component's
    // comment on why this moved.
    expect(chip?.closest('[data-slot="input-group"]')).toBeNull();
  });

  it("renders 'No matches' when the filter leaves nothing, without losing the ruled height", () => {
    render(<Harness todos={[]} filter="nothing" onFilterChange={vi.fn()} totalCount={12} />);
    expect(screen.getByText("No matches")).toBeTruthy();
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
    expect(onQuickAdd).toHaveBeenCalledWith("New task", undefined, []);
    expect(onFilterChange).toHaveBeenCalledWith("");
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
