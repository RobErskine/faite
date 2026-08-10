import { describe, expect, it } from "vitest";
import {
  NAV_CREATE_LIST,
  NAV_LOAD_MORE,
  addStop,
  buildNavGrid,
  cardStop,
  navKeyOf,
  resolveNavTarget,
  stopLocation,
  type BuildNavGridInput,
  type LastVisited,
} from "./column-nav";

/**
 * Only the pure layer, per docs/KEYBOARD.md §9. Moving focus and scrolling the
 * day track are `use-column-nav.ts`'s job and need a real layout to mean
 * anything; the grid arithmetic here needs no DOM at all.
 */

const NOWHERE: LastVisited = { calendar: null, planning: null };

/** Three days, two lists, Backlog with one card, Overflow with two. */
function fixture(over: Partial<BuildNavGridInput> = {}) {
  return buildNavGrid({
    overflow: { id: "day:overflow", todoIds: ["o1", "o2"] },
    days: [
      { id: "day:2026-08-09", todoIds: ["d1"] },
      { id: "day:2026-08-10", todoIds: [] },
      { id: "day:2026-08-11", todoIds: [] },
    ],
    hasLoadMore: true,
    backlog: { id: "list:backlog", todoIds: ["b1"] },
    lists: [
      { id: "list:overall", todoIds: ["a1", "a2"] },
      { id: "list:days", todoIds: [] },
    ],
    ...over,
  });
}

describe("navKeyOf", () => {
  const press = (key: string, over = {}) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...over,
  });

  it("accepts a bare arrow", () => {
    expect(navKeyOf(press("ArrowLeft"))).toBe("ArrowLeft");
    expect(navKeyOf(press("ArrowDown"))).toBe("ArrowDown");
  });

  it("ignores anything that is not an arrow", () => {
    expect(navKeyOf(press("Enter"))).toBeNull();
    expect(navKeyOf(press("a"))).toBeNull();
  });

  it("leaves modified arrows to the OS", () => {
    // ⌥← is word-jump, ⌘← is line-start, ⇧← extends a selection.
    expect(navKeyOf(press("ArrowLeft", { altKey: true }))).toBeNull();
    expect(navKeyOf(press("ArrowLeft", { metaKey: true }))).toBeNull();
    expect(navKeyOf(press("ArrowLeft", { shiftKey: true }))).toBeNull();
    expect(navKeyOf(press("ArrowLeft", { ctrlKey: true }))).toBeNull();
  });
});

describe("buildNavGrid", () => {
  it("orders each row and appends the end-of-track tiles", () => {
    const grid = fixture();
    expect(grid.calendar.map((c) => c.key)).toEqual([
      "day:overflow",
      "day:2026-08-09",
      "day:2026-08-10",
      "day:2026-08-11",
      NAV_LOAD_MORE,
    ]);
    expect(grid.planning.map((c) => c.key)).toEqual([
      "list:backlog",
      "list:overall",
      "list:days",
      NAV_CREATE_LIST,
    ]);
  });

  it("puts the quick-add last in every column that has one", () => {
    const grid = fixture();
    const overall = grid.planning[1];
    expect(overall.stops).toEqual([cardStop("a1"), cardStop("a2"), addStop("list:overall")]);
    expect(overall.hasQuickAdd).toBe(true);
  });

  it("gives Overflow cards but no quick-add", () => {
    const overflow = fixture().calendar[0];
    expect(overflow.stops).toEqual([cardStop("o1"), cardStop("o2")]);
    expect(overflow.hasQuickAdd).toBe(false);
  });

  it("leaves an empty Overflow with no stops at all", () => {
    const grid = fixture({ overflow: { id: "day:overflow", todoIds: [] } });
    expect(grid.calendar[0].stops).toEqual([]);
  });

  it("drops a collapsed rail from its row", () => {
    const grid = fixture({ overflow: null, backlog: null });
    expect(grid.calendar[0].key).toBe("day:2026-08-09");
    expect(grid.planning[0].key).toBe("list:overall");
  });

  it("omits the load-more tile once the cap is reached", () => {
    const grid = fixture({ hasLoadMore: false });
    expect(grid.calendar.at(-1)?.key).toBe("day:2026-08-11");
  });

  it("defaults cross-row moves to today and Backlog, never Overflow", () => {
    expect(fixture().defaults).toEqual({
      calendar: "day:2026-08-09",
      planning: "list:backlog",
    });
  });

  it("falls through to the first list, then Create list, when Backlog is gone", () => {
    expect(fixture({ backlog: null }).defaults.planning).toBe("list:overall");
    expect(fixture({ backlog: null, lists: [] }).defaults.planning).toBe(NAV_CREATE_LIST);
  });
});

describe("stopLocation", () => {
  it("reports the row and column a stop belongs to", () => {
    const grid = fixture();
    expect(stopLocation(grid, cardStop("a2"))).toEqual({
      row: "planning",
      columnKey: "list:overall",
    });
    expect(stopLocation(grid, addStop("day:2026-08-10"))).toEqual({
      row: "calendar",
      columnKey: "day:2026-08-10",
    });
  });

  it("returns null for a stop that is not on the board", () => {
    expect(stopLocation(fixture(), cardStop("gone"))).toBeNull();
  });
});

describe("resolveNavTarget — vertical", () => {
  const grid = fixture();

  it("walks up through the cards to the top of the column", () => {
    expect(resolveNavTarget(grid, addStop("list:overall"), "ArrowUp", NOWHERE)).toBe(
      cardStop("a2"),
    );
    expect(resolveNavTarget(grid, cardStop("a2"), "ArrowUp", NOWHERE)).toBe(cardStop("a1"));
  });

  it("walks back down to the quick-add", () => {
    expect(resolveNavTarget(grid, cardStop("a1"), "ArrowDown", NOWHERE)).toBe(cardStop("a2"));
    expect(resolveNavTarget(grid, cardStop("a2"), "ArrowDown", NOWHERE)).toBe(
      addStop("list:overall"),
    );
  });

  it("stops at the bottom of the board", () => {
    expect(resolveNavTarget(grid, addStop("list:overall"), "ArrowDown", NOWHERE)).toBeNull();
    expect(resolveNavTarget(grid, NAV_CREATE_LIST, "ArrowDown", NOWHERE)).toBeNull();
  });

  it("stops at the top of the board", () => {
    expect(resolveNavTarget(grid, cardStop("d1"), "ArrowUp", NOWHERE)).toBeNull();
    expect(resolveNavTarget(grid, cardStop("o1"), "ArrowUp", NOWHERE)).toBeNull();
  });

  it("crosses up into today by default, landing on its bottom stop", () => {
    expect(resolveNavTarget(grid, cardStop("a1"), "ArrowUp", NOWHERE)).toBe(
      addStop("day:2026-08-09"),
    );
  });

  it("crosses down into Backlog by default, keeping the quick-add anchor", () => {
    expect(resolveNavTarget(grid, addStop("day:2026-08-09"), "ArrowDown", NOWHERE)).toBe(
      addStop("list:backlog"),
    );
  });

  it("returns to the column you were last in on that row", () => {
    const last: LastVisited = { calendar: "day:2026-08-11", planning: "list:days" };
    expect(resolveNavTarget(grid, cardStop("a1"), "ArrowUp", last)).toBe(
      addStop("day:2026-08-11"),
    );
    expect(resolveNavTarget(grid, addStop("day:2026-08-09"), "ArrowDown", last)).toBe(
      addStop("list:days"),
    );
  });

  it("falls back to the row default when the remembered column has gone", () => {
    const last: LastVisited = { calendar: "day:2030-01-01", planning: null };
    // Today, not Overflow — which is what the default exists to guarantee.
    expect(resolveNavTarget(grid, cardStop("a1"), "ArrowUp", last)).toBe(
      addStop("day:2026-08-09"),
    );
  });

  it("falls back to the first column with stops when the default has gone too", () => {
    const noDays = fixture({ days: [], hasLoadMore: false });
    expect(resolveNavTarget(noDays, cardStop("a1"), "ArrowUp", NOWHERE)).toBe(cardStop("o2"));
  });

  it("lands on the first stop when crossing down off a column with no quick-add", () => {
    // Overflow's last card is not a quick-add, so the anchor is top-of-column.
    expect(resolveNavTarget(grid, cardStop("o2"), "ArrowDown", NOWHERE)).toBe(cardStop("b1"));
  });
});

describe("resolveNavTarget — horizontal", () => {
  const grid = fixture();

  it("moves between neighbouring columns", () => {
    expect(resolveNavTarget(grid, addStop("list:overall"), "ArrowLeft", NOWHERE)).toBe(
      addStop("list:backlog"),
    );
    expect(resolveNavTarget(grid, addStop("list:backlog"), "ArrowRight", NOWHERE)).toBe(
      addStop("list:overall"),
    );
  });

  it("walks the lists and lands on Create list", () => {
    expect(resolveNavTarget(grid, addStop("list:overall"), "ArrowRight", NOWHERE)).toBe(
      addStop("list:days"),
    );
    expect(resolveNavTarget(grid, addStop("list:days"), "ArrowRight", NOWHERE)).toBe(
      NAV_CREATE_LIST,
    );
  });

  it("does not wrap at either edge", () => {
    expect(resolveNavTarget(grid, NAV_CREATE_LIST, "ArrowRight", NOWHERE)).toBeNull();
    expect(resolveNavTarget(grid, addStop("list:backlog"), "ArrowLeft", NOWHERE)).toBeNull();
    expect(resolveNavTarget(grid, cardStop("o1"), "ArrowLeft", NOWHERE)).toBeNull();
    expect(resolveNavTarget(grid, NAV_LOAD_MORE, "ArrowRight", NOWHERE)).toBeNull();
  });

  it("reaches Overflow's last card from today", () => {
    expect(resolveNavTarget(grid, addStop("day:2026-08-09"), "ArrowLeft", NOWHERE)).toBe(
      cardStop("o2"),
    );
  });

  it("treats an empty Overflow as a wall rather than skipping it", () => {
    const empty = fixture({ overflow: { id: "day:overflow", todoIds: [] } });
    expect(resolveNavTarget(empty, addStop("day:2026-08-09"), "ArrowLeft", NOWHERE)).toBeNull();
  });

  it("keeps the quick-add anchor across columns with different card counts", () => {
    // `list:days` has no cards at all; `list:overall` has two.
    expect(resolveNavTarget(grid, addStop("list:days"), "ArrowLeft", NOWHERE)).toBe(
      addStop("list:overall"),
    );
    expect(resolveNavTarget(grid, addStop("list:overall"), "ArrowRight", NOWHERE)).toBe(
      addStop("list:days"),
    );
  });

  it("keeps the card index when leaving a card, clamped to the target", () => {
    // Card index 0 in Overflow → card index 0 in today's column.
    expect(resolveNavTarget(grid, cardStop("o1"), "ArrowRight", NOWHERE)).toBe(cardStop("d1"));
    // Card index 1 has nowhere that deep in today's column, so it clamps.
    expect(resolveNavTarget(grid, cardStop("o2"), "ArrowRight", NOWHERE)).toBe(
      addStop("day:2026-08-09"),
    );
  });

  it("reaches the load-more tile off the last day", () => {
    expect(resolveNavTarget(grid, addStop("day:2026-08-11"), "ArrowRight", NOWHERE)).toBe(
      NAV_LOAD_MORE,
    );
    expect(resolveNavTarget(grid, NAV_LOAD_MORE, "ArrowLeft", NOWHERE)).toBe(
      addStop("day:2026-08-11"),
    );
  });
});

describe("resolveNavTarget — unknown origin", () => {
  it("returns null rather than guessing", () => {
    expect(resolveNavTarget(fixture(), cardStop("gone"), "ArrowRight", NOWHERE)).toBeNull();
  });
});
