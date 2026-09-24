// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CommandPalette } from "./command-palette";
import { formatShortDate } from "@/lib/scheduling";
import { collapseRecurringSeries } from "@/lib/search";
import { resetDbForTests, getDb } from "@/lib/store/db";
import type { Label as LabelRecord, List, Settings, Tab, Todo } from "@/lib/schema";

/**
 * Regression guard for the ⌘K crash.
 *
 * shadcn's CommandDialog renders its children straight into DialogContent
 * without wrapping them in <Command>, so cmdk's Input had no store to
 * subscribe to and threw "Cannot read properties of undefined (reading
 * 'subscribe')" the moment the palette opened.
 *
 * Mounting it open is enough to catch that class of bug: a missing context
 * fails at render, not on interaction.
 *
 * The search cases guard a second, subtler failure: cmdk applies its own
 * filter on top of the rows we hand it, so a row that searchTodos considers a
 * hit can still be scored to zero and vanish. These assert on what actually
 * reaches the DOM, not on what the matcher returned.
 */

const list = (id: string, name: string, isBacklog = false): List => ({
  id,
  ownerId: "local-user",
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
  deletedAt: null,
  name,
  isBacklog,
  archivedAt: null,
  archivedWithTabId: null,
  position: "a0",
  tabId: null,
  defaultReminderPresetId: null,
  description: null,
  color: null,
  emoji: null,
  iconUrl: null,
});

const todo = (overrides: Partial<Todo> & { id: string }): Todo => ({
  ownerId: "local-user",
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
  deletedAt: null,
  title: overrides.id,
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

const settings: Settings = {
  ownerId: "local-user",
  timezone: "UTC",
  workdaysOnly: false,
  workdays: [1, 2, 3, 4, 5],
  overflowAfterDays: 3,
  visibleDays: 7,
  visibleStatuses: ["open"],
  visibleEventKinds: ["created", "scheduled", "done", "dropped"],
  visibleActivityKinds: ["created", "scheduled", "unscheduled", "moved", "done", "dropped", "reopened", "edited", "deleted", "attached", "detached", "rolledOver", "overflowed"],
  visibleHistoryKinds: ["created", "scheduled", "unscheduled", "moved", "done", "dropped", "reopened", "edited", "deleted", "attached", "detached", "rolledOver", "overflowed"],
  hiddenEventKinds: null,
  hiddenActivityKinds: null,
  hiddenHistoryKinds: null,
  showWeekends: true,
  fontPairing: "hyperlegible",
  theme: "system",
  displayName: "",
  avatarKind: "initials",
  avatarInitials: "",
  avatarEmoji: "",
  avatarImage: "",
  activeTabId: null,
  backlogWidth: null,
  backlogCollapsed: false,
  overflowWidth: null,
  overflowCollapsed: false,
  splitRatio: null,
  splitCollapsed: "none",
  reminderPresetsSeeded: false,
  goodJobMode: false,
  overdriveMinTodos: 5,
  overdriveAutoConfirmMs: 0,
  updatedAt: "2026-08-03T00:00:00.000Z",
};

const tab = (id: string, name: string, isDefault = false): Tab => ({
  id,
  ownerId: "local-user",
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
  deletedAt: null,
  name,
  description: null,
  isDefault,
  archivedAt: null,
  position: "a0",
  color: null,
  emoji: null,
  iconUrl: null,
});

const mkLabel = (id: string, name: string): LabelRecord => ({
  id,
  ownerId: "local-user",
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
  deletedAt: null,
  name,
  position: "a0",
  color: null,
  emoji: null,
  iconUrl: null,
});

const LISTS = [list("l1", "Backlog", true), list("l2", "Grocery List")];
const LABELS = [mkLabel("lb1", "Urgent"), mkLabel("lb2", "Errand")];

const TABS = [tab("tab1", "My Lists", true), tab("tab2", "Work")];

const TODOS = [
  todo({ id: "t1", title: "Buy oat milk", listId: "l2" }),
  todo({ id: "t2", title: "Renew passport", description: "Check the photo booth hours" }),
];

const PLACEHOLDER = "Search to-dos or run a command…";

function renderPalette(
  overrides: Partial<React.ComponentProps<typeof CommandPalette>> = {},
) {
  const props = {
    open: true,
    onOpenChange: () => {},
    lists: LISTS,
    tabs: TABS,
    todos: TODOS,
    labels: [] as LabelRecord[],
    settings,
    activeTabId: "tab1",
    onSelectTodo: () => {},
    onSelectTab: () => {},
    onSetTodoStatus: () => {},
    onDeleteTodo: () => {},
    overflowCount: 0,
    onOpenOverdrive: () => {},
    onOpenHelp: () => {},
    onOpenActivity: () => {},
    onOpenHistory: () => {},
    ...overrides,
  };
  return render(<CommandPalette {...props} />);
}

/** Types into the palette input, which is what drives both filters. */
function search(text: string) {
  fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), {
    target: { value: text },
  });
}

// Not using vitest globals, so RTL's automatic cleanup does not run. Without
// this, each render leaks into the next test's DOM queries.
afterEach(cleanup);
beforeEach(async () => {
  await resetDbForTests();
});

describe("CommandPalette", () => {
  it("mounts open without throwing", () => {
    expect(() => renderPalette()).not.toThrow();
  });

  it("renders the search input and root commands", () => {
    renderPalette();

    expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeTruthy();
    expect(screen.getByText("New to-do")).toBeTruthy();
    expect(screen.getByText("New list")).toBeTruthy();
    expect(screen.getByText("New tab")).toBeTruthy();
    expect(screen.getByText("Delete a list…")).toBeTruthy();
    expect(screen.getByText("Delete a tab…")).toBeTruthy();
  });

  it("lists tabs for switching, marking the active one", () => {
    renderPalette();

    expect(screen.getByText("Work")).toBeTruthy();
    expect(screen.getByText("current")).toBeTruthy();
  });

  it("hides the switcher when there is only one tab", () => {
    // A group of one that is already selected is pure noise.
    renderPalette({ tabs: [TABS[0]] });

    expect(screen.queryByText("current")).toBeNull();
  });

  it("has no Typography group — font pairing lives in Settings → Design now", () => {
    renderPalette();

    expect(screen.queryByText("Typography")).toBeNull();
  });

  it("shows no to-do results until something is typed", () => {
    renderPalette();

    expect(screen.queryByText("Buy oat milk")).toBeNull();
  });

  it("surfaces matching to-dos with the column they sit in", () => {
    renderPalette();

    search("milk");

    expect(screen.getByText("Buy oat milk")).toBeTruthy();
    expect(screen.getByText("Grocery List")).toBeTruthy();
  });

  it("finds to-dos by description, which cmdk's own filter cannot see", () => {
    renderPalette();

    search("photo booth");

    expect(screen.getByText("Renew passport")).toBeTruthy();
  });

  it("hands the selected to-do back to the board", () => {
    const selected: string[] = [];
    renderPalette({ onSelectTodo: (t) => selected.push(t.id) });

    search("milk");
    fireEvent.click(screen.getByText("Buy oat milk"));

    expect(selected).toEqual(["t1"]);
  });

  it("offers to create the query as a to-do when nothing matches", () => {
    renderPalette();

    search("call the dentist");

    expect(screen.queryByText("Buy oat milk")).toBeNull();
    expect(screen.getByText(/Create to-do/)).toBeTruthy();
  });

  it("renders nothing when closed", () => {
    renderPalette({ open: false });

    expect(screen.queryByText("New to-do")).toBeNull();
  });
});

describe("CommandPalette — @list mention", () => {
  it("opens a filtered popover when typing @ + a list name, in root mode", () => {
    renderPalette();

    search("buy milk @groc");

    expect(screen.getByRole("option", { name: "Grocery List" })).toBeTruthy();
  });

  it("opens the popover in New to-do mode too", () => {
    renderPalette();

    fireEvent.click(screen.getByText("New to-do"));
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "buy milk @groc" },
    });

    expect(screen.getByRole("option", { name: "Grocery List" })).toBeTruthy();
  });

  it("selecting a mention strips the @token and shows a destination chip", () => {
    renderPalette();

    search("buy milk @groc");
    fireEvent.mouseDown(screen.getByRole("option", { name: "Grocery List" }));

    expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveProperty("value", "buy milk");
    expect(screen.getByText("→ Grocery List")).toBeTruthy();
  });

  it("does not open for a query with no matching list", () => {
    renderPalette();

    search("buy milk @nonexistent");

    expect(screen.queryByRole("listbox", { name: "Lists" })).toBeNull();
  });
});

describe("CommandPalette — #label mention", () => {
  it("opens a filtered popover when typing # + a label name, with aria-label Labels", () => {
    renderPalette({ labels: LABELS });

    search("buy milk #urg");

    expect(screen.getByRole("listbox", { name: "Labels" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Urgent" })).toBeTruthy();
  });

  it("selecting a mention strips the #token and shows a label chip; picking accumulates", () => {
    renderPalette({ labels: LABELS });

    search("buy milk #urg");
    fireEvent.mouseDown(screen.getByRole("option", { name: "Urgent" }));

    expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveProperty("value", "buy milk");
    expect(screen.getByText("#Urgent")).toBeTruthy();

    search("buy milk #err");
    fireEvent.mouseDown(screen.getByRole("option", { name: "Errand" }));

    expect(screen.getByText("#Urgent")).toBeTruthy();
    expect(screen.getByText("#Errand")).toBeTruthy();
  });

  it("excludes an already-picked label from further results", () => {
    renderPalette({ labels: LABELS });

    search("buy milk #urg");
    fireEvent.mouseDown(screen.getByRole("option", { name: "Urgent" }));

    search("buy milk #");

    expect(screen.queryByRole("option", { name: "Urgent" })).toBeNull();
    expect(screen.getByRole("option", { name: "Errand" })).toBeTruthy();
  });

  it("offers to create a label with no match, and picking it adds the chip once created", async () => {
    renderPalette({ labels: LABELS });

    search("buy milk #brandnew");

    const createRow = screen.getByRole("option", { name: 'Create label "brandnew"' });
    fireEvent.mouseDown(createRow);

    expect(await screen.findByText("#brandnew")).toBeTruthy();
  });

  it("does not open for a query with an exact existing label name", () => {
    renderPalette({ labels: LABELS });

    search("buy milk #Urgent");

    expect(screen.queryByText(/Create label/)).toBeNull();
  });
});

describe("CommandPalette — to-do result rows", () => {
  // `document.body`, not the render `container`: CommandDialog portals its
  // content out via Base UI's FloatingPortal, so it never lands inside the
  // container div RTL mounts into. `screen` queries already account for
  // this (bound to `document.body`); these need a raw selector, so they go
  // straight to `document.body` too.
  it("shows the priority rail for a prioritized hit", () => {
    const todos = [...TODOS, todo({ id: "t3", title: "Ship taxes", priority: 1 })];
    renderPalette({ todos });

    search("taxes");

    expect(document.body.querySelector('[data-priority-rail="1"]')).toBeTruthy();
  });

  it("shows a marker for a deadline still ahead", () => {
    const todos = [
      ...TODOS,
      todo({ id: "t4", title: "Renew lease", deadline: "2099-01-01" }),
    ];
    renderPalette({ todos });

    search("lease");

    expect(document.body.querySelector("[data-deadline-marker]")).toBeTruthy();
  });

  it("shows a marker for a recurring occurrence", () => {
    const todos = [
      ...TODOS,
      todo({ id: "t5", title: "Water plants", recurrenceParentId: "series1" }),
    ];
    renderPalette({ todos });

    search("plants");

    expect(document.body.querySelector("[data-recurrence-marker]")).toBeTruthy();
  });

  it("shows a scheduled date badge — the card only shows this when away from its column, the palette always does", () => {
    const todos = [
      ...TODOS,
      todo({ id: "t6", title: "Pack suitcase", scheduledDate: "2099-06-01" }),
    ];
    renderPalette({ todos });

    search("suitcase");

    expect(document.body.textContent).toContain(formatShortDate("2099-06-01"));
  });
});

describe("CommandPalette — row actions", () => {
  function pressOnInput(key: string, opts: Record<string, boolean> = {}) {
    fireEvent.keyDown(screen.getByPlaceholderText(PLACEHOLDER), { key, ...opts });
  }

  it("⌘⏎ completes the highlighted hit without opening it", () => {
    const statusCalls: Array<[string, string]> = [];
    const selected: string[] = [];
    renderPalette({
      onSetTodoStatus: (id, status) => statusCalls.push([id, status]),
      onSelectTodo: (t) => selected.push(t.id),
    });

    search("milk");
    pressOnInput("Enter", { metaKey: true });

    expect(statusCalls).toEqual([["t1", "done"]]);
    expect(selected).toEqual([]);
  });

  it("⌘⌫ marks the highlighted hit as won't-do", () => {
    const statusCalls: Array<[string, string]> = [];
    renderPalette({ onSetTodoStatus: (id, status) => statusCalls.push([id, status]) });

    search("milk");
    pressOnInput("Backspace", { metaKey: true });

    expect(statusCalls).toEqual([["t1", "dropped"]]);
  });

  it("⌘⇧⌫ deletes the highlighted hit", () => {
    const deleted: string[] = [];
    renderPalette({ onDeleteTodo: (id) => deleted.push(id) });

    search("milk");
    pressOnInput("Backspace", { metaKey: true, shiftKey: true });

    expect(deleted).toEqual(["t1"]);
  });

  it("stays open after a row action", () => {
    const openCalls: boolean[] = [];
    renderPalette({ onOpenChange: (open) => openCalls.push(open) });

    search("milk");
    pressOnInput("Enter", { metaKey: true });

    expect(openCalls).toEqual([]);
  });
});

/**
 * EI-110 follow-up: matched date/time/priority words fold out of the visible
 * quick-add text once their own trailing space lands — same treatment as
 * board-column.tsx's inline quick-add row. See `foldQuickAddDraft`
 * (lib/quick-add.ts).
 */
describe("CommandPalette — folding a completed date/time word out of the input", () => {
  function enterNewTodoMode() {
    fireEvent.click(screen.getByText("New to-do"));
    return screen.getByPlaceholderText("What needs doing?");
  }

  it("folds a trailing date word out of the visible input once its space lands", () => {
    renderPalette();
    const input = enterNewTodoMode();
    fireEvent.change(input, { target: { value: "Buy milk tomorrow " } });
    expect(input).toHaveProperty("value", "Buy milk ");
  });

  it("shows the folded word as a removable chip", () => {
    renderPalette();
    const input = enterNewTodoMode();
    fireEvent.change(input, { target: { value: "Buy milk tomorrow " } });
    expect(screen.getByRole("button", { name: /^Remove/ })).toBeTruthy();
  });

  it("removing the chip drops the confirmed match without touching the remaining text", () => {
    renderPalette();
    const input = enterNewTodoMode();
    fireEvent.change(input, { target: { value: "Buy milk tomorrow " } });
    fireEvent.mouseDown(screen.getByRole("button", { name: /^Remove/ }));
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
    expect(input).toHaveProperty("value", "Buy milk ");
  });

  it("creating still applies the folded field even though it's no longer in the visible text", async () => {
    renderPalette();
    const input = enterNewTodoMode();
    fireEvent.change(input, { target: { value: "Buy milk tomorrow " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(async () => {
      const rows = await getDb().todos.toArray();
      const created = rows.find((r) => r.title === "Buy milk");
      expect(created).toBeTruthy();
      expect(created?.scheduledDate).not.toBeNull();
    });
  });

  it("does not fold inside a non-quick-add entry mode (e.g. naming a new list)", () => {
    renderPalette();
    fireEvent.click(screen.getByText("New list"));
    const input = screen.getByPlaceholderText("List name…");
    fireEvent.change(input, { target: { value: "Grocery tomorrow " } });
    expect(input).toHaveProperty("value", "Grocery tomorrow ");
  });
});

/**
 * EI-341. `board.tsx` hands the palette `data.searchableTodos` — the board's
 * own expanded view run through `collapseRecurringSeries` — rather than the
 * raw table, which for a repeating to-do holds only its finished occurrences.
 * These compose the same pipeline so the palette's half of it is pinned:
 * one row in, one row rendered, and the virtual id reaching `onSelectTodo`
 * intact (`board.tsx` resolves it through `todosById` and materializes on
 * write, which is why a virtual hit is safe to act on).
 */
describe("CommandPalette — a repeating to-do is one row, the next one", () => {
  const SERIES = "series-trash";
  const history = [
    todo({
      id: `${SERIES}@2026-09-09`,
      title: "Take down trash",
      status: "done",
      scheduledDate: "2026-09-09",
      recurrenceParentId: SERIES,
      updatedAt: "2026-09-09T18:00:00.000Z",
    }),
    todo({
      id: `${SERIES}@2026-09-16`,
      title: "Take down trash",
      status: "done",
      scheduledDate: "2026-09-16",
      recurrenceParentId: SERIES,
      updatedAt: "2026-09-16T18:00:00.000Z",
    }),
  ];
  /** Virtual — synthesized by `expandRecurrences`, no row behind it. */
  const next = todo({
    id: `${SERIES}@2099-09-23`,
    title: "Take down trash",
    scheduledDate: "2099-09-23",
    recurrenceParentId: SERIES,
  });

  it("renders a single hit, the upcoming occurrence, not the completed ones", () => {
    renderPalette({ todos: collapseRecurringSeries([...TODOS, ...history, next]) });

    search("take down trash");

    const rows = document.body.querySelectorAll("[data-todo-id]");
    expect([...rows].map((r) => r.getAttribute("data-todo-id"))).toEqual([next.id]);
  });

  it("shows it as upcoming rather than struck through", () => {
    renderPalette({ todos: collapseRecurringSeries([...TODOS, ...history, next]) });

    search("take down trash");

    expect(document.body.querySelector(".line-through")).toBeNull();
    expect(document.body.querySelector("[data-recurrence-marker]")).toBeTruthy();
    expect(document.body.textContent).toContain(formatShortDate("2099-09-23"));
  });

  it("hands the virtual occurrence's own id to onSelectTodo", () => {
    const selected: string[] = [];
    renderPalette({
      todos: collapseRecurringSeries([...TODOS, ...history, next]),
      onSelectTodo: (t: Todo) => selected.push(t.id),
    });

    search("take down trash");
    fireEvent.click(document.body.querySelector(`[data-todo-id="${next.id}"]`)!);

    expect(selected).toEqual([next.id]);
  });

  it("leaves an ordinary completed to-do searchable", () => {
    const filed = todo({
      id: "one-off",
      title: "File taxes",
      status: "done",
      updatedAt: "2026-04-15T00:00:00.000Z",
    });
    renderPalette({ todos: collapseRecurringSeries([...TODOS, filed]) });

    search("file taxes");

    const rows = document.body.querySelectorAll("[data-todo-id]");
    expect([...rows].map((r) => r.getAttribute("data-todo-id"))).toEqual(["one-off"]);
  });
});
