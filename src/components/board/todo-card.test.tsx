// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TodoCard } from "./todo-card";
import { cardStop, type NavKey } from "@/lib/column-nav";
import type { Todo } from "@/lib/schema";
import type { PlacementContext } from "@/lib/scheduling";

/**
 * The card's own contract, as distinct from the column wiring in
 * `column-nav.test.tsx`.
 *
 * Three of these guard things that are invisible in review and silent when
 * broken: that the title button keeps `min-w-0` (the class that actually stops a
 * card overflowing into the next column), that the out-of-flow grip's hit area
 * stays vertical-only (an `opacity-0` element still takes pointer events, so a
 * 24×24 expansion would sit over the checkbox and eat its clicks), and that the
 * location tooltip trigger stays a plain `span` (a focusable trigger would nest
 * a control inside the title button).
 *
 * happy-dom has no layout, so wrapping and clamping can only be asserted as
 * classes here. The visual half is on the manual checklist in
 * docs/DRAG-AND-DROP.md §8.
 */

beforeAll(() => {
  // happy-dom has no layout; dnd-kit reaches for this during a keyboard lift.
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

const todo = (overrides: Partial<Todo> = {}): Todo => ({
  id: "t1",
  ownerId: "local-user",
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
  deletedAt: null,
  title: "Buy milk",
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
  ...overrides,
});

interface HarnessProps {
  todo?: Todo;
  onToggle?: (t: Todo) => void;
  onOpen?: (t: Todo) => void;
  onNavigate?: (stop: string, key: NavKey) => boolean;
  onDragStart?: () => void;
  showInsertionLine?: boolean;
  missedCount?: number | null;
}

function Harness({
  todo: t = todo(),
  onToggle = vi.fn(),
  onOpen = vi.fn(),
  onNavigate,
  onDragStart,
  showInsertionLine,
  missedCount,
}: HarnessProps) {
  return (
    <TooltipProvider>
      <DndContext onDragStart={onDragStart}>
        <SortableContext items={[t.id]}>
          <TodoCard
            todo={t}
            labels={[]}
            ctx={ctx}
            onToggle={onToggle}
            onOpen={onOpen}
            onNavigate={onNavigate}
            showInsertionLine={showInsertionLine}
            missedCount={missedCount}
          />
        </SortableContext>
      </DndContext>
    </TooltipProvider>
  );
}

const row = (id = "t1") =>
  document.querySelector<HTMLElement>(`[data-nav-stop="${cardStop(id)}"]`)!;
const title = () => document.querySelector<HTMLElement>("[data-todo-title]")!;
const grip = () => screen.getByLabelText(/drag to reschedule/i);
/**
 * The title button by exact name. A regex would also match the grip, whose
 * `aria-label` ends in the same title.
 */
const titleButton = () => screen.getByRole("button", { name: "Buy milk" });
/** The badge row, which only exists when there is a chip left to put in it. */
const badgeRow = () => row().querySelector(".flex-wrap");

describe("the title", () => {
  it("wraps and clamps instead of truncating", () => {
    render(<Harness />);
    expect(title().className).toContain("line-clamp-3");
    expect(title().className).toContain("wrap-break-word");
    expect(title().className).not.toContain("truncate");
  });

  it("takes the column's full width, or there is nothing to wrap within", () => {
    render(<Harness />);
    // A button is inline-block by default and would shrink-wrap its text.
    expect(titleButton().className).toContain("block");
    expect(titleButton().className).toContain("w-full");
  });

  it("indents only the first line, so later lines run under the checkbox", () => {
    render(<Harness />);
    expect(title().className).toContain("indent-6");
  });
});

describe("the grip", () => {
  it("is out of the flow and hidden until reached for", () => {
    render(<Harness />);
    expect(grip().className).toContain("absolute");
    expect(grip().className).toContain("opacity-0");
    expect(grip().className).toContain("group-hover:opacity-100");
  });

  it("expands its hit area vertically only, so it cannot eat checkbox clicks", () => {
    render(<Harness />);
    expect(grip().className).toContain("before:inset-x-0");
    // `-inset-x-1.5` from DragGrip's base must be MERGED AWAY, not merely
    // overridden. tailwind-merge does not treat the `-inset-1.5` shorthand as
    // conflicting with a per-axis override, so while the base used the shorthand
    // both survived and CSS source order silently decided which won — with an
    // invisible box over the checkbox as the prize.
    expect(grip().className).not.toContain("before:-inset-x-1.5");
    expect(grip().className).not.toContain("before:-inset-1.5");
  });

  it("still lifts on Space", () => {
    const onDragStart = vi.fn();
    render(<Harness onDragStart={onDragStart} />);
    fireEvent.keyDown(grip(), { key: " ", code: "Space" });
    expect(onDragStart).toHaveBeenCalledTimes(1);
  });

  it("is not covered by the checkbox's own hit expansion", () => {
    render(<Harness />);
    const checkbox = document.querySelector<HTMLElement>('[data-slot="checkbox"]')!;
    // The shadcn base expands 12px horizontally, which from `left-3` reaches
    // back over the whole grip — a click meant for the grip would toggle done.
    expect(checkbox.className).toContain("after:-inset-x-1");
  });
});

describe("priority", () => {
  it("renders a rail sized for the level", () => {
    render(<Harness todo={todo({ priority: 1 })} />);
    const rail = document.querySelector<HTMLElement>("[data-priority-rail]")!;
    expect(rail.getAttribute("data-priority-rail")).toBe("1");
    expect(rail.style.width).toBe("3px");
  });

  it("renders no rail without a priority", () => {
    render(<Harness />);
    expect(document.querySelector("[data-priority-rail]")).toBeNull();
  });

  it("leaves room for the drop indicator", () => {
    render(<Harness todo={todo({ priority: 1 })} showInsertionLine />);
    expect(document.querySelector("[data-drop-indicator]")).toBeTruthy();
    expect(document.querySelector("[data-priority-rail]")).toBeTruthy();
  });

  /*
    textContent rather than getByText: the level is inside the title span, so a
    substring matcher would also match the span and the button that contain it and
    fail on "multiple elements".
  */
  it("says the level out loud instead of showing a chip", () => {
    render(<Harness todo={todo({ priority: 1 })} />);
    expect(title().textContent).toContain("Priority 1, highest");
    expect(title().textContent).not.toContain("P1");
    expect(badgeRow()).toBeNull();
  });
});

describe("location", () => {
  it("shows a pin, not a chip", () => {
    render(<Harness todo={todo({ location: "Grocery Store" })} />);
    expect(document.querySelector("[data-location-pin]")).toBeTruthy();
    expect(title().textContent).toContain("Location: Grocery Store");
    // A badge row at all would mean the chip came back.
    expect(badgeRow()).toBeNull();
  });

  it("renders nothing without a location", () => {
    render(<Harness />);
    expect(document.querySelector("[data-location-pin]")).toBeNull();
  });

  it("keeps the tooltip trigger non-interactive inside the title button", () => {
    render(<Harness todo={todo({ location: "Home" })} />);
    const pin = document.querySelector<HTMLElement>("[data-location-pin]")!;
    expect(pin.tagName).toBe("SPAN");
    expect(pin.hasAttribute("tabindex")).toBe(false);
    expect(pin.getAttribute("role")).toBeNull();
  });
});

describe("deadlines", () => {
  it("marks an upcoming deadline inline, next to the location pin", () => {
    render(<Harness todo={todo({ deadline: "2026-08-14" })} />);
    expect(document.querySelector("[data-deadline-marker]")).toBeTruthy();
    // ctx.today is 2026-08-09.
    expect(title().textContent).toContain("Due in 5 days: Aug 14");
  });

  it("renders no marker without a deadline", () => {
    render(<Harness />);
    expect(document.querySelector("[data-deadline-marker]")).toBeNull();
  });

  /*
    A missed deadline keeps the loud destructive badge it always had. Showing the
    quiet inline marker as well would say the same thing twice, which is what this
    redesign is trying to stop doing.
  */
  it("hands a missed deadline to the badge instead of the marker", () => {
    render(<Harness todo={todo({ deadline: "2026-08-01" })} />);
    expect(document.querySelector("[data-deadline-marker]")).toBeNull();
    expect(badgeRow()?.textContent).toContain("Deadline");
  });
});

describe("the list wash stays off the card", () => {
  /*
    The wash lives on a wrapper behind each group's run of cards
    (board-column.tsx). Moving it onto the row would beat `hover:bg-accent/50`
    outright — inline styles always win — and kill the hover state on every
    grouped card. This is the guard against that being "tidied up" later.
  */
  it("keeps the hover class and no inline background", () => {
    render(<Harness />);
    expect(row().className).toContain("hover:bg-accent/50");
    expect(row().style.backgroundColor).toBe("");
  });
});

describe("the row's keyboard contract, unchanged", () => {
  it("toggles on Space and opens on Enter", () => {
    const onToggle = vi.fn();
    const onOpen = vi.fn();
    render(<Harness onToggle={onToggle} onOpen={onOpen} />);

    fireEvent.keyDown(row(), { key: " " });
    expect(onToggle).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(row(), { key: "Enter" });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("does not fire twice for a press that started on the title", () => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);
    // The row's handler sees this as it bubbles and must bail on `e.target`.
    // A real browser would also synthesise a click, which `onClick` handles.
    fireEvent.keyDown(titleButton(), { key: "Enter" });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("hands arrow keys to the navigator and stays out of the tab order", () => {
    const onNavigate = vi.fn(() => true);
    render(<Harness onNavigate={onNavigate} />);
    fireEvent.keyDown(row(), { key: "ArrowDown" });
    expect(onNavigate).toHaveBeenCalledWith(cardStop("t1"), "ArrowDown");
    expect(row().getAttribute("tabindex")).toBe("-1");
  });
});

describe("recurrence", () => {
  it("shows the repeat marker for a materialized occurrence", () => {
    render(<Harness todo={todo({ recurrenceParentId: "template-1" })} />);
    expect(row().querySelector("[data-recurrence-marker]")).not.toBeNull();
  });

  it("shows no repeat marker for a plain todo", () => {
    render(<Harness />);
    expect(row().querySelector("[data-recurrence-marker]")).toBeNull();
  });

  it("shows no ×N badge for a single occurrence (missedCount 1)", () => {
    render(<Harness missedCount={1} />);
    expect(badgeRow()).toBeNull();
  });

  it("shows no ×N badge when missedCount is unset", () => {
    render(<Harness missedCount={null} />);
    expect(badgeRow()).toBeNull();
  });

  it("shows the ×N badge once more than one occurrence has accrued", () => {
    render(<Harness missedCount={3} />);
    expect(badgeRow()?.textContent).toContain("×3");
  });
});
