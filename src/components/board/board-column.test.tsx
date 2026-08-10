// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DndContext } from "@dnd-kit/core";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardColumn } from "./board-column";
import { dayGroupId, type TodoGroup } from "@/lib/board";
import { groupStop } from "@/lib/column-nav";
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
}

function Harness({ groups, ...rest }: HarnessProps) {
  const todos = groups ? groups.flatMap((g) => g.todos) : [todo("flat")];
  return (
    <TooltipProvider>
      <DndContext>
        <BoardColumn
          id="day:2026-08-09"
          title="Sunday"
          todos={todos}
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
