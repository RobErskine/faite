// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ROW_BADGE_ORDER, ROW_GLYPH_ORDER } from "@/lib/row-grammar";
import type { Label, Todo } from "@/lib/schema";
import type { PlacementContext } from "@/lib/scheduling";
import { DragChip } from "./drag-chip";
import { TodoMetaBadges, type TodoRowSources } from "./todo-row-parts";

afterEach(cleanup);

const ctx: PlacementContext = {
  today: "2026-10-14",
  visibleWindow: ["2026-10-14"],
  workdaysOnly: false,
  workdays: [1, 2, 3, 4, 5],
  overflowAfterDays: 3,
};

const todo = (overrides: Partial<Todo> = {}): Todo => ({
  id: "t1",
  ownerId: "local-user",
  createdAt: "2026-08-01T09:00:00.000Z",
  updatedAt: "2026-08-01T09:00:00.000Z",
  deletedAt: null,
  title: "Call dentist",
  description: null,
  status: "open",
  priority: null,
  scheduledDate: "2026-10-14",
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
  ...overrides,
});

const LABEL: Label = {
  id: "l1",
  ownerId: "local-user",
  createdAt: "2026-08-01T09:00:00.000Z",
  updatedAt: "2026-08-01T09:00:00.000Z",
  deletedAt: null,
  name: "Health",
  color: "#2a9d8f",
  emoji: null,
  iconUrl: null,
  position: "a0",
};

/**
 * Everything a one-off row can carry at once: rolled from Oct 12 (so ↳), a
 * deadline ahead, a location, a time, sub-tasks, attachments and a label. A
 * series occurrence never rolls (it drops straight into Overflow), so the
 * repeat glyph has its own case.
 */
const KITCHEN_SINK = todo({
  scheduledDate: "2026-10-12",
  deadline: "2026-10-20",
  location: "Main St Dental",
  reminderTime: "14:00",
  labelIds: ["l1"],
  priority: 2,
});

const SOURCES: TodoRowSources = {
  recurrenceSummaries: new Map([["series-1", "Every week on Mon"]]),
  subtaskCounts: new Map([["t1", { done: 1, total: 3 }]]),
  attachmentCounts: new Map([["t1", 2]]),
};

const renderChip = (t: Todo, extra: { selectionCount?: number; sources?: TodoRowSources } = {}) =>
  render(
    <TooltipProvider>
      <DragChip
        todo={t}
        labels={[LABEL]}
        ctx={ctx}
        rowSources={extra.sources ?? SOURCES}
        selectionCount={extra.selectionCount}
      />
    </TooltipProvider>,
  );

const chip = () => document.querySelector<HTMLElement>("[data-drag-chip]")!;
const glyphs = () =>
  [...chip().querySelectorAll<HTMLElement>("[data-row-glyph]")].map((g) => g.dataset.rowGlyph);
const badges = () =>
  [...chip().querySelectorAll<HTMLElement>("[data-row-badge]")].map((b) => b.dataset.rowBadge);

describe("DragChip — the row's anatomy, carried (EI-395)", () => {
  it("shows every title glyph the row shows, ↳ and the deadline flag included, in row order", () => {
    renderChip(KITCHEN_SINK);
    expect(glyphs()).toEqual(ROW_GLYPH_ORDER.filter((g) => g !== "recurring"));
    cleanup();
    renderChip(todo({ recurrenceParentId: "series-1", deadline: "2026-10-20", location: "Home" }));
    expect(glyphs()).toEqual(ROW_GLYPH_ORDER.filter((g) => g !== "rolled"));
  });

  it("shows the row's badge line, in ROW_BADGE_ORDER", () => {
    renderChip(KITCHEN_SINK);
    const shown = badges();
    expect(shown).toEqual(["time", "subtasks", "attachments", "label"]);
    const rank = shown.map((b) => ROW_BADGE_ORDER.indexOf(b as (typeof ROW_BADGE_ORDER)[number]));
    expect(rank).toEqual([...rank].sort((a, b) => a - b));
  });

  it("carries the verdicts too: a missed deadline, and an Overflow age", () => {
    renderChip(todo({ scheduledDate: "2026-10-01", deadline: "2026-10-10" }), { sources: {} });
    expect(badges()).toEqual(["deadline-missed", "overflow-age"]);
    expect(chip().querySelector("[data-overflow-age]")?.textContent).toBe("since Oct 5 · 9 days");
  });

  it("never shows the scheduled date — the column under the pointer is the date", () => {
    renderChip(todo({ scheduledDate: "2026-10-20" }));
    expect(chip().querySelector('[data-row-badge="scheduled"]')).toBeNull();
  });

  it("opens nothing on hover: no tooltip triggers, no title attributes", () => {
    renderChip(todo({ ...KITCHEN_SINK, scheduledDate: "2026-10-01" }));
    expect(chip().querySelector("[data-overflow-age]")).not.toBeNull();
    expect(chip().querySelectorAll('[data-slot="tooltip-trigger"]')).toHaveLength(0);
    expect(chip().querySelectorAll("[title]")).toHaveLength(0);
  });

  it("CONTROL: the same badges on a row do open hover text", () => {
    // Without this, "no triggers" above could mean the selector is blind.
    render(
      <TooltipProvider>
        <TodoMetaBadges
          todo={todo()}
          labels={[]}
          today={ctx.today}
          overflow={{ from: "2026-10-01", since: "2026-10-05" }}
          subtaskCount={{ done: 1, total: 3 }}
        />
      </TooltipProvider>,
    );
    expect(document.querySelectorAll('[data-slot="tooltip-trigger"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll("[title]").length).toBeGreaterThan(0);
  });

  it("lets the title wrap to two lines, where it used to truncate to one", () => {
    renderChip(todo({ title: "A long enough title to need a second line in a chip" }));
    const title = chip().querySelector<HTMLElement>("[data-drag-chip-title]")!;
    expect(title.className).toContain("line-clamp-2");
    expect(title.className).not.toContain("truncate");
  });

  it("wears the row's rail as its left border", () => {
    // The settled step-back rides `color-mix`, which happy-dom drops from
    // `style`; `railBorder`'s own test in lib/priority.test.ts covers it.
    renderChip(todo({ priority: 1 }));
    expect(chip().style.borderLeftStyle).toBe("double");
    expect(chip().style.borderLeftWidth).toBe("5px");
    cleanup();
    renderChip(todo());
    expect(chip().style.borderLeftStyle).toBe("");
  });

  it("strikes a done title's words, not its glyphs; Won't do is dimmed only", () => {
    renderChip(todo({ status: "done", location: "Home" }));
    const title = chip().querySelector<HTMLElement>("[data-drag-chip-title]")!;
    expect(title.className).toContain("text-foreground/60");
    expect(title.querySelector(".line-through")?.textContent).toBe("Call dentist");
    expect(title.querySelector("[data-row-glyph]")?.closest(".line-through")).toBeNull();
    cleanup();
    renderChip(todo({ status: "dropped" }));
    const dropped = chip().querySelector<HTMLElement>("[data-drag-chip-title]")!;
    expect(dropped.className).toContain("text-foreground/60");
    expect(dropped.querySelector(".line-through")).toBeNull();
  });

  it("counts a multi-drag, and shows no count for one", () => {
    renderChip(todo(), { selectionCount: 3 });
    expect(chip().querySelector("[data-drag-chip-count]")?.textContent).toBe("3");
    cleanup();
    renderChip(todo());
    expect(chip().querySelector("[data-drag-chip-count]")).toBeNull();
  });
});
