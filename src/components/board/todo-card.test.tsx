// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TodoCard } from "./todo-card";
import { cardStop, type NavKey } from "@/lib/column-nav";
import type { ReminderPreset, Todo } from "@/lib/schema";
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
  source: null,
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
  recurrenceSummary?: string;
  reminderPresets?: ReminderPreset[];
  subtaskCount?: { done: number; total: number } | null;
  timezone?: string;
}

function Harness({
  todo: t = todo(),
  onToggle = vi.fn(),
  onOpen = vi.fn(),
  onNavigate,
  onDragStart,
  showInsertionLine,
  missedCount,
  recurrenceSummary,
  reminderPresets,
  subtaskCount,
  timezone,
}: HarnessProps) {
  return (
    <TooltipProvider>
      <DndContext onDragStart={onDragStart}>
        <SortableContext items={[t.id]}>
          <TodoCard
            todo={t}
            labels={[]}
            reminderPresets={reminderPresets}
            ctx={ctx}
            timezone={timezone}
            onToggle={onToggle}
            onOpen={onOpen}
            onNavigate={onNavigate}
            showInsertionLine={showInsertionLine}
            missedCount={missedCount}
            recurrenceSummary={recurrenceSummary}
            subtaskCount={subtaskCount}
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

  it("carries the series summary in the marker's sr-only text when given one", () => {
    render(
      <Harness
        todo={todo({ recurrenceParentId: "template-1" })}
        recurrenceSummary="Every week on Fri"
      />,
    );
    const marker = row().querySelector("[data-recurrence-marker]");
    expect(marker?.textContent).toContain("Every week on Fri");
  });

  it("falls back to a generic description with no summary threaded in", () => {
    render(<Harness todo={todo({ recurrenceParentId: "template-1" })} />);
    const marker = row().querySelector("[data-recurrence-marker]");
    expect(marker?.textContent).toContain("part of a repeating series");
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

describe("TodoCard — reminder badge (EI-106 P5)", () => {
  const MORNING: ReminderPreset = {
    id: "p1",
    ownerId: "u",
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    name: "In the morning",
    time: "08:00",
    position: "a0",
    color: null,
    emoji: "🌅",
    iconUrl: null,
  };

  it("shows no reminder badge with no reminderTime", () => {
    render(<Harness todo={todo({ reminderTime: null })} />);
    expect(badgeRow()).toBeNull();
  });

  it("shows a formatted clock time with no matching preset", () => {
    render(<Harness todo={todo({ reminderTime: "15:45" })} />);
    expect(badgeRow()?.textContent).toContain("3:45 PM");
  });

  it("shows the preset's emoji + name when reminderTime matches one", () => {
    render(
      <Harness todo={todo({ reminderTime: "08:00" })} reminderPresets={[MORNING]} />,
    );
    expect(badgeRow()?.textContent).toContain("🌅 In the morning");
  });

  it("falls back to a formatted clock time when presets are omitted entirely", () => {
    render(<Harness todo={todo({ reminderTime: "08:00" })} />);
    expect(badgeRow()?.textContent).toContain("8:00 AM");
  });
});

describe("TodoCard — sub-task progress badge (EI-183)", () => {
  it("shows no badge with no sub-tasks", () => {
    render(<Harness subtaskCount={undefined} />);
    expect(badgeRow()).toBeNull();
  });

  it("shows no badge when the count is null", () => {
    render(<Harness subtaskCount={null} />);
    expect(badgeRow()).toBeNull();
  });

  it("shows no badge when total is 0", () => {
    render(<Harness subtaskCount={{ done: 0, total: 0 }} />);
    expect(badgeRow()).toBeNull();
  });

  it("shows the done/total count once there is at least one sub-task", () => {
    render(<Harness subtaskCount={{ done: 2, total: 5 }} />);
    expect(badgeRow()?.textContent).toContain("2/5");
  });

  it("shows 0/N for a sub-task group with none done yet", () => {
    render(<Harness subtaskCount={{ done: 0, total: 3 }} />);
    expect(badgeRow()?.textContent).toContain("0/3");
  });
});

describe("the Faite Loop", () => {
  // ctx.today is 2026-08-09, overflowAfterDays is 3.

  it("shows no rollover marker for a todo due today", () => {
    render(<Harness todo={todo({ scheduledDate: "2026-08-09" })} />);
    expect(row().querySelector("[data-rollover-marker]")).toBeNull();
    expect(badgeRow()).toBeNull();
  });

  it("shows the rollover marker once a todo has rolled, up to the threshold", () => {
    render(<Harness todo={todo({ scheduledDate: "2026-08-08" })} />); // 1 roll
    const marker = row().querySelector("[data-rollover-marker]");
    expect(marker).not.toBeNull();
    expect(marker?.textContent).toContain("Rolled from Aug 8");
    expect(badgeRow()).toBeNull();
  });

  it("still shows the marker, not the badge, exactly at the threshold", () => {
    render(<Harness todo={todo({ scheduledDate: "2026-08-06" })} />); // 3 rolls
    expect(row().querySelector("[data-rollover-marker]")).not.toBeNull();
    expect(badgeRow()).toBeNull();
  });

  it("switches to the Overflow age badge one roll past the threshold", () => {
    render(<Harness todo={todo({ scheduledDate: "2026-08-05" })} />); // 4 rolls
    expect(row().querySelector("[data-rollover-marker]")).toBeNull();
    expect(badgeRow()?.textContent).toContain("In Overflow 4 days");
  });

  it("shows neither for a settled todo, however stale", () => {
    render(
      <Harness todo={todo({ scheduledDate: "2026-07-01", status: "done" })} />,
    );
    expect(row().querySelector("[data-rollover-marker]")).toBeNull();
    expect(badgeRow()).toBeNull();
  });

  it("shows neither for a recurring occurrence — one miss bypasses the loop", () => {
    render(
      <Harness
        todo={todo({ scheduledDate: "2026-08-05", recurrenceParentId: "template-1" })}
      />,
    );
    expect(row().querySelector("[data-rollover-marker]")).toBeNull();
    // The repeat marker still shows; the badge row exists only for it.
    expect(badgeRow()).toBeNull();
  });
});

/**
 * EI-192. The tooltip popup itself is portalled and hover-gated, so — as with
 * the location pin and the clamped title — these assert the trigger's state
 * and the `sr-only` channel rather than the rendered popup.
 */
describe("the completion stamp", () => {
  const checkbox = () => document.querySelector<HTMLElement>('[data-slot="checkbox"]')!;
  const done = (overrides: Partial<Todo> = {}) =>
    todo({ status: "done", completedAt: "2026-08-14T21:41:00.000Z", ...overrides });

  it("says nothing on an open to-do", () => {
    render(<Harness />);
    expect(checkbox().hasAttribute("data-completed-at")).toBe(false);
    expect(title().textContent).not.toContain("Completed");
  });

  it("carries the completion time for a done to-do", () => {
    render(<Harness todo={done()} timezone="UTC" />);
    expect(checkbox().getAttribute("data-completed-at")).toBe("2026-08-14T21:41:00.000Z");
    expect(title().textContent).toContain("Completed Aug 14 · 9:41 PM");
  });

  it("says dropped, not completed, for a won't-do", () => {
    render(<Harness todo={done({ status: "dropped" })} timezone="UTC" />);
    expect(title().textContent).toContain("Dropped Aug 14 · 9:41 PM");
    expect(title().textContent).not.toContain("Completed");
  });

  it("renders the stamp in the given timezone", () => {
    render(<Harness todo={done()} timezone="America/Los_Angeles" />);
    expect(title().textContent).toContain("Completed Aug 14 · 2:41 PM");
  });

  it("leaves the accessible name alone", () => {
    // A tooltip is a description. Folding it into the name would make the
    // control announce itself as "Mark Buy milk not done Completed Aug 14…".
    render(<Harness todo={done()} timezone="UTC" />);
    expect(checkbox().getAttribute("aria-label")).toBe("Mark Buy milk not done");
  });

  it("still toggles while a tooltip is attached", () => {
    // Base UI's `render` merges the trigger's props onto the Checkbox. If that
    // merge ever swallowed `onCheckedChange`, completed cards would silently
    // stop being reopenable — and nothing else here would catch it.
    const onToggle = vi.fn();
    render(<Harness todo={done()} timezone="UTC" onToggle={onToggle} />);
    fireEvent.click(checkbox());
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("keeps the checkbox out of the grip's hit area when it has a tooltip", () => {
    // The positioning must stay ON the checkbox, not migrate to a wrapper.
    render(<Harness todo={done()} timezone="UTC" />);
    expect(checkbox().className).toContain("absolute left-3 top-2");
    expect(checkbox().className).toContain("after:-inset-x-1");
  });
});
