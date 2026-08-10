// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DndContext } from "@dnd-kit/core";
import { BoardColumn } from "./board-column";
import { useColumnNav } from "./use-column-nav";
import { addStop, buildNavGrid, cardStop } from "@/lib/column-nav";
import type { Todo } from "@/lib/schema";
import type { PlacementContext } from "@/lib/scheduling";

/**
 * The wiring the pure layer in `lib/column-nav.test.ts` cannot reach: that the
 * `data-nav-stop` attributes actually land on the DOM, that the hook finds them,
 * and — the one that matters — that a half-typed draft keeps its arrow keys.
 *
 * `onBlur` commits the quick-add, so navigating away mid-draft would silently
 * create the to-do you were still typing. That is a data bug, not a focus bug,
 * which is why it is guarded here rather than left to the unit tests.
 */

beforeAll(() => {
  // happy-dom has no layout, so this is absent. The hook calls it after focus.
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

const todo = (id: string, title: string): Todo => ({
  id,
  ownerId: "local-user",
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
  deletedAt: null,
  title,
  description: null,
  status: "open",
  priority: null,
  scheduledDate: null,
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

const OVERALL = [todo("t1", "Show Completed Items"), todo("t2", "Keyboard arrow keys")];

/** Two planning columns side by side, wired through the real hook. */
function Harness() {
  const grid = buildNavGrid({
    overflow: null,
    days: [],
    hasLoadMore: false,
    backlog: { id: "list:backlog", todoIds: [] },
    lists: [{ id: "list:overall", todoIds: OVERALL.map((t) => t.id) }],
  });

  const navigate = useColumnNav({
    grid,
    dayIds: [],
    dragging: false,
    anchorIndex: 0,
    visibleCount: 1,
    jumpToIndex: () => {},
  });

  return (
    <DndContext>
      <BoardColumn
        id="list:backlog"
        title="Backlog"
        todos={[]}
        labels={[]}
        ctx={ctx}
        onToggle={() => {}}
        onOpen={() => {}}
        onQuickAdd={() => {}}
        onNavigate={navigate}
      />
      <BoardColumn
        id="list:overall"
        title="Overall"
        todos={OVERALL}
        labels={[]}
        ctx={ctx}
        onToggle={() => {}}
        onOpen={() => {}}
        onQuickAdd={() => {}}
        onNavigate={navigate}
      />
    </DndContext>
  );
}

const quickAdd = (column: string) =>
  document.querySelector<HTMLInputElement>(`[data-nav-stop="${addStop(column)}"]`);

describe("arrow-key navigation wiring", () => {
  it("marks every stop with a data-nav-stop attribute", () => {
    render(<Harness />);
    expect(quickAdd("list:backlog")).toBeTruthy();
    expect(quickAdd("list:overall")).toBeTruthy();
    expect(document.querySelector(`[data-nav-stop="${cardStop("t2")}"]`)).toBeTruthy();
  });

  it("moves focus to the neighbouring column's quick-add", () => {
    render(<Harness />);
    const from = quickAdd("list:overall")!;
    from.focus();
    fireEvent.keyDown(from, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(quickAdd("list:backlog"));
  });

  it("leaves the caret alone while there is a draft to move through", () => {
    render(<Harness />);
    const from = quickAdd("list:overall")!;
    from.focus();
    fireEvent.change(from, { target: { value: "abc" } });
    fireEvent.keyDown(from, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(from);
  });

  it("walks up from the quick-add into the cards and back down", () => {
    render(<Harness />);
    const from = quickAdd("list:overall")!;
    from.focus();

    fireEvent.keyDown(from, { key: "ArrowUp" });
    const second = document.querySelector(`[data-nav-stop="${cardStop("t2")}"]`);
    expect(document.activeElement).toBe(second);

    fireEvent.keyDown(second!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(from);
  });

  it("stops at the bottom of the board", () => {
    render(<Harness />);
    const from = quickAdd("list:overall")!;
    from.focus();
    fireEvent.keyDown(from, { key: "ArrowDown" });
    expect(document.activeElement).toBe(from);
  });

  it("leaves modified arrows to the OS", () => {
    render(<Harness />);
    const from = quickAdd("list:overall")!;
    from.focus();
    fireEvent.keyDown(from, { key: "ArrowLeft", altKey: true });
    expect(document.activeElement).toBe(from);
  });

  it("keeps cards out of the tab order", () => {
    render(<Harness />);
    const card = document.querySelector(`[data-nav-stop="${cardStop("t2")}"]`);
    expect(card?.getAttribute("tabindex")).toBe("-1");
  });

  it("gives a column with no onQuickAdd no quick-add row", () => {
    render(
      <DndContext>
        <BoardColumn
          id="day:overflow"
          title="Overflow"
          todos={[]}
          labels={[]}
          ctx={ctx}
          onToggle={() => {}}
          onOpen={() => {}}
        />
      </DndContext>,
    );
    expect(screen.queryByLabelText("Add a to-do to Overflow")).toBeNull();
  });
});
