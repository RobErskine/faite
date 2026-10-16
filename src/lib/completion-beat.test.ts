import { describe, expect, it } from "vitest";
import {
  beatOutcome,
  heldSnapshot,
  holdGroups,
  holdRows,
  neighborsOf,
  rowTransition,
  BEAT_MS,
  GIVE_UP_MS,
  TICK_LEAD_MS,
  type HeldRow,
} from "./completion-beat";
import type { TodoGroup } from "./board";
import type { Todo } from "./schema";

/**
 * The completion beat's placement rules (EI-395). The timing and the slide
 * live in `use-completion-beat.ts` and are covered through the column in
 * `board-column.test.tsx`; these are the pure parts that decide WHERE a
 * held row goes, and the transition string the row composes.
 */

const t = (id: string, status: Todo["status"] = "open"): Todo =>
  ({ id, title: id, status, completedAt: status === "open" ? null : "x" }) as Todo;

const held = (id: string, over: Partial<HeldRow> = {}): HeldRow => ({
  id,
  todo: heldSnapshot(t(id), "2026-10-15T12:00:00.000Z"),
  prevId: null,
  nextId: null,
  group: null,
  prevGroupId: null,
  nextGroupId: null,
  phase: "beat",
  ...over,
});

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("heldSnapshot", () => {
  it("is the row as last shown, marked done", () => {
    const snap = heldSnapshot(t("a"), "2026-10-15T12:00:00.000Z");
    expect(snap.status).toBe("done");
    expect(snap.completedAt).toBe("2026-10-15T12:00:00.000Z");
    expect(snap.title).toBe("a");
  });
});

describe("neighborsOf", () => {
  it("names the rows either side", () => {
    expect(neighborsOf([t("a"), t("b"), t("c")], "b")).toEqual({ prevId: "a", nextId: "c" });
    expect(neighborsOf([t("a"), t("b")], "a")).toEqual({ prevId: null, nextId: "b" });
    expect(neighborsOf([t("a")], "zzz")).toEqual({ prevId: null, nextId: null });
  });
});

describe("holdRows", () => {
  it("puts a row the data dropped back where it was (default view)", () => {
    const { rows, heldIds } = holdRows([t("a"), t("c")], [held("b", { prevId: "a", nextId: "c" })]);
    expect(ids(rows)).toEqual(["a", "b", "c"]);
    expect(rows[1].status).toBe("done");
    expect([...heldIds]).toEqual(["b"]);
  });

  it("keeps a first row first and a last row last", () => {
    expect(ids(holdRows([t("b")], [held("a", { nextId: "b" })]).rows)).toEqual(["a", "b"]);
    expect(ids(holdRows([t("a")], [held("b", { prevId: "a" })]).rows)).toEqual(["a", "b"]);
    expect(ids(holdRows([], [held("a")]).rows)).toEqual(["a"]);
  });

  it("lets the data win while the row is still open: the write has not landed, or was undone", () => {
    const { rows, heldIds } = holdRows([t("a"), t("b")], [held("b", { prevId: "a" })]);
    expect(rows.map((r) => r.status)).toEqual(["open", "open"]);
    expect(heldIds.size).toBe(0);
  });

  it("holds a settled row at its old place (View: All), drawn from the data, not the snapshot", () => {
    // The data sank "a" below the open work; the beat keeps it on top until release.
    const live = { ...t("a", "done"), title: "fresh" };
    const { rows, heldIds } = holdRows([t("b"), t("c"), live], [held("a", { nextId: "b" })]);
    expect(ids(rows)).toEqual(["a", "b", "c"]);
    expect(rows[0].title).toBe("fresh");
    expect(heldIds.size).toBe(0);
  });

  it("does not show a row twice when the data already has it elsewhere in the column", () => {
    const { rows } = holdRows([t("c")], [held("a", { nextId: "c" })], new Set(["c", "a"]));
    expect(ids(rows)).toEqual(["c"]);
  });

  it("places two quick completions by neighbor, so one leaving does not shift the other", () => {
    // a and b ticked in a row: b was recorded after the held a.
    const both = [held("a", { nextId: "b" }), held("b", { prevId: "a", nextId: "c" })];
    expect(ids(holdRows([t("c")], both).rows)).toEqual(["a", "b", "c"]);
    // a released first: b still goes back above c, not at its stale index.
    expect(ids(holdRows([t("c"), t("d")], [both[1]]).rows)).toEqual(["b", "c", "d"]);
  });
});

describe("holdGroups", () => {
  const g = (id: string, todos: Todo[]): TodoGroup =>
    ({ id, key: id, name: id, color: null, sortKey: id, tabKey: "", tabSortKey: "", todos }) as TodoGroup;
  const meta = (id: string) => {
    const { todos: _rows, ...rest } = g(id, []);
    void _rows;
    return rest;
  };

  it("holds a row inside its own group", () => {
    const out = holdGroups(
      [g("x", [t("a")]), g("y", [t("c")])],
      [held("b", { group: meta("x"), prevId: "a" })],
    );
    expect(out.groups.map((gr) => ids(gr.todos))).toEqual([["a", "b"], ["c"]]);
    expect([...out.heldIds]).toEqual(["b"]);
  });

  it("brings back a group the row was the last of, in its old place", () => {
    const out = holdGroups(
      [g("x", [t("a")]), g("z", [t("c")])],
      [held("b", { group: meta("y"), prevGroupId: "x", nextGroupId: "z" })],
    );
    expect(out.groups.map((gr) => gr.id)).toEqual(["x", "y", "z"]);
    expect(ids(out.groups[1].todos)).toEqual(["b"]);
  });

  it("brings back a column's only group", () => {
    const out = holdGroups([], [held("b", { group: meta("y") })]);
    expect(out.groups.map((gr) => gr.id)).toEqual(["y"]);
  });

  it("restores a vanished group once, around every held row that needs it", () => {
    const out = holdGroups(
      [],
      [held("a", { group: meta("y") }), held("b", { group: meta("y"), prevId: "a" })],
    );
    expect(out.groups).toHaveLength(1);
    expect(ids(out.groups[0].todos)).toEqual(["a", "b"]);
  });
});

describe("beatOutcome", () => {
  it("leaves when the data no longer has the row", () => {
    expect(beatOutcome(false, null)).toBe("leave");
  });
  it("releases into its new place when it stays, settled (View: All)", () => {
    expect(beatOutcome(true, "done")).toBe("release");
  });
  it("stops holding when it is open again: undone", () => {
    expect(beatOutcome(true, "open")).toBe("undone");
  });
});

describe("rowTransition", () => {
  it("keeps dnd-kit's transform transition AND the wash and fade", () => {
    const value = rowTransition("transform 200ms ease");
    expect(value).toMatch(/^transform 200ms ease, /);
    expect(value).toContain("background-color var(--row-wash-dur)");
    expect(value).toContain("opacity var(--row-fade-dur)");
  });

  it("still carries the wash and fade when dnd-kit has no transition", () => {
    const value = rowTransition(undefined);
    expect(value).not.toContain("transform");
    expect(value).toContain("background-color");
    expect(value).toContain("opacity");
  });
});

describe("TICK_LEAD_MS (EI-399)", () => {
  it("is a couple of frames: enough for the flash to start, far short of the beat and the give-up", () => {
    expect(TICK_LEAD_MS).toBeGreaterThanOrEqual(16);
    expect(TICK_LEAD_MS).toBeLessThanOrEqual(50);
    expect(TICK_LEAD_MS).toBeLessThan(BEAT_MS);
    expect(TICK_LEAD_MS * 10).toBeLessThan(GIVE_UP_MS);
  });
});
