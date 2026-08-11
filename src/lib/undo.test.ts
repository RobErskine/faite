// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbForTests } from "@/lib/store/db";
import {
  createTodo,
  listPatch,
  setTodoStatus,
  statusPatch,
} from "@/lib/store/repositories";
import {
  MAX_UNDO,
  clearUndo,
  deleteListUndoSteps,
  inversePatch,
  isTextEntry,
  pushUndo,
  undoById,
  undoDepth,
  undoLast,
} from "./undo";

/**
 * happy-dom rather than the default node environment, because isTextEntry needs
 * a real DOM and the round-trip test needs fake-indexeddb. The pure functions
 * run fine in either, so one file covers all of it.
 */

beforeEach(async () => {
  clearUndo();
  await resetDbForTests();
});

const todo = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  ownerId: "local-user",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  title: "Buy milk",
  status: "open",
  listId: "l1",
  scheduledDate: null,
  completedAt: null,
  position: "a0",
  labelIds: ["lab1"],
  priority: null,
  ...over,
});

describe("inversePatch", () => {
  it("picks exactly the forward patch's keys and nothing else", () => {
    expect(inversePatch(todo(), { title: "Buy oat milk" })).toEqual({
      title: "Buy milk",
    });
  });

  it("never reverses stamped or identity fields", () => {
    expect(
      inversePatch(todo(), {
        title: "x",
        updatedAt: "2026-08-03T00:00:00.000Z",
        id: "other",
        ownerId: "other",
        createdAt: "2020-01-01T00:00:00.000Z",
      }),
    ).toEqual({ title: "Buy milk" });
  });

  it("turns a field missing from `before` into null, not undefined", () => {
    // Dexie's update() reads undefined as "delete this key path", so an
    // inverse carrying undefined would strip the field instead of clearing it.
    const inverse = inversePatch(todo(), { location: "Store" });
    expect(inverse).toEqual({ location: null });
    expect(Object.hasOwn(inverse, "location")).toBe(true);
  });

  it("preserves falsy real values", () => {
    // Guards against a `?? null` regression, which would silently rewrite
    // these three to null on undo.
    expect(
      inversePatch(todo({ done: false, count: 0, note: "" }), {
        done: true,
        count: 9,
        note: "text",
      }),
    ).toEqual({ done: false, count: 0, note: "" });
  });

  it("round-trips null and array fields", () => {
    expect(
      inversePatch(todo(), { scheduledDate: "2026-08-05", labelIds: [] }),
    ).toEqual({ scheduledDate: null, labelIds: ["lab1"] });
  });

  it("restores every touched field when composed over the forward patch", () => {
    const before = todo();
    const forward = { title: "New", listId: "l2", position: "a5" };
    const after = { ...before, ...forward };
    expect({ ...after, ...inversePatch(before, forward) }).toEqual(before);
  });
});

describe("inverses of the repository patch shapes", () => {
  it("restores the schedule that moving into a list cleared", () => {
    // Regression: moveTodoToList writes `scheduledDate: null` internally. A
    // call site that hand-built {listId, position} would drop it, so dragging
    // a scheduled todo into a list and undoing left it unscheduled.
    //
    // `scheduledAt` carries a real (non-null) instant here on purpose — with it
    // absent from the fixture, a bug that always restored `null` would pass
    // this test by coincidence (`before[key]` reads `undefined`, coerced to
    // `null` either way).
    const before = todo({ scheduledDate: "2026-08-05", scheduledAt: "2026-08-04T09:00:00.000Z" });
    expect(inversePatch(before, listPatch("l2", "a5"))).toEqual({
      listId: "l1",
      scheduledDate: "2026-08-05",
      scheduledAt: "2026-08-04T09:00:00.000Z",
      position: "a0",
    });
  });

  it("restores completedAt when un-completing", () => {
    expect(inversePatch(todo(), statusPatch("done"))).toEqual({
      status: "open",
      completedAt: null,
    });
  });
});

describe("the undo stack", () => {
  // `apply()` writes through `mutate()`, which now throws on a missing local
  // row (see mutate.ts) — these tests are about STACK mechanics (order,
  // eviction, id-targeting), not the write itself, but they still have to
  // target real rows for `undoLast`/`undoById` to succeed.
  const step = (entityId: string) => [
    { kind: "todo" as const, entityId, patch: { title: "old" } },
  ];

  it("pops in LIFO order", async () => {
    const a = await createTodo({ title: "A" });
    const b = await createTodo({ title: "B" });
    pushUndo("A", step(a));
    pushUndo("B", step(b));
    expect((await undoLast())?.label).toBe("B");
    expect((await undoLast())?.label).toBe("A");
  });

  it("returns null when empty", async () => {
    expect(await undoLast()).toBeNull();
  });

  it("evicts the oldest entries past the cap", async () => {
    const a = await createTodo({ title: "A" });
    for (let i = 0; i < MAX_UNDO + 5; i++) pushUndo(`entry-${i}`, step(a));
    expect(undoDepth()).toBe(MAX_UNDO);
    // The five oldest are gone, so the bottom of the stack is entry-5.
    for (let i = 0; i < MAX_UNDO - 1; i++) await undoLast();
    expect((await undoLast())?.label).toBe("entry-5");
  });

  it("undoById removes that specific entry and leaves the rest", async () => {
    // Sonner stacks toasts, so the one clicked is not always the newest.
    const idA = await createTodo({ title: "A" });
    const idB = await createTodo({ title: "B" });
    const a = pushUndo("A", step(idA));
    pushUndo("B", step(idB));
    expect((await undoById(a))?.label).toBe("A");
    expect((await undoLast())?.label).toBe("B");
  });

  it("undoById is a no-op once ⌘Z has consumed the entry", async () => {
    const idA = await createTodo({ title: "A" });
    const a = pushUndo("A", step(idA));
    await undoLast();
    expect(await undoById(a)).toBeNull();
  });
});

describe("deleteListUndoSteps", () => {
  it("restores the list before re-pointing its todos", () => {
    // Ordering invariant: no rendered frame where a todo points at a list
    // that is still tombstoned.
    const steps = deleteListUndoSteps("l1", ["t1", "t2"]);
    expect(steps[0]).toEqual({
      kind: "list",
      entityId: "l1",
      patch: { deletedAt: null },
    });
    expect(steps.slice(1)).toEqual([
      { kind: "todo", entityId: "t1", patch: { listId: "l1" } },
      { kind: "todo", entityId: "t2", patch: { listId: "l1" } },
    ]);
  });

  it("is a single step for an empty list", () => {
    expect(deleteListUndoSteps("l1", [])).toHaveLength(1);
  });
});

describe("isTextEntry", () => {
  const render = (html: string) => {
    document.body.innerHTML = html;
    return document.body.firstElementChild!;
  };

  it("is true for inputs and textareas", () => {
    expect(isTextEntry(render("<input />"))).toBe(true);
    expect(isTextEntry(render("<textarea></textarea>"))).toBe(true);
  });

  it("is true inside a contenteditable, false when disabled", () => {
    const editable = render("<div contenteditable><span>x</span></div>");
    expect(isTextEntry(editable.firstElementChild)).toBe(true);
    const off = render("<div contenteditable='false'><span>x</span></div>");
    expect(isTextEntry(off.firstElementChild)).toBe(false);
  });

  it("is false for buttons", () => {
    // Base UI's Checkbox renders a <button>, so ⌘Z must stay live when focus
    // is sitting on a card's checkbox.
    expect(isTextEntry(render("<button>Done</button>"))).toBe(false);
  });

  it("is false for the body and for null", () => {
    expect(isTextEntry(document.body)).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});

describe("undo against the real store", () => {
  it("reverses a completion as an ordinary forward mutation", async () => {
    const id = await createTodo({ title: "Buy milk" });
    const before = (await getDb().todos.get(id))!;
    const outboxAfterCreate = await getDb().outbox.count();

    pushUndo("Completed", [
      {
        kind: "todo",
        entityId: id,
        patch: inversePatch(before, statusPatch("done")),
      },
    ]);
    await setTodoStatus(id, "done");
    expect((await getDb().todos.get(id))!.status).toBe("done");

    await undoLast();

    const after = (await getDb().todos.get(id))!;
    expect(after.status).toBe("open");
    expect(after.completedAt).toBeNull();

    /**
     * The architectural claim, asserted: the undo went through mutate() and
     * left its own outbox entry. Sync sees three ordinary edits, not a create,
     * an edit, and a revert.
     */
    expect(await getDb().outbox.count()).toBe(outboxAfterCreate + 2);
    expect(after.updatedAt >= before.updatedAt).toBe(true);
  });
});
