// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./command-palette";
import { announceQuickAdd } from "./quick-add-toast";
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
  duplicateOf: null,
  duplicateHeld: null,
  suggestedListId: null,
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
  holdAllDuplicates: false,
  smartSortEnabled: false,
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

function renderPaletteDefaults() {
  return {
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
    backlogCount: 0,
    onOpenQuickSort: () => {},
    onOpenHelp: () => {},
    onOpenActivity: () => {},
    onOpenHistory: () => {},
    duplicateCount: 0,
    onOpenDuplicates: () => {},
    onOpenSettings: () => {},
  };
}

function renderPalette(
  overrides: Partial<React.ComponentProps<typeof CommandPalette>> = {},
) {
  return render(<CommandPalette {...renderPaletteDefaults()} {...overrides} />);
}

/** Types into the palette input, which is what drives both filters. */
function search(text: string) {
  fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), {
    target: { value: text },
  });
}

// The toast itself is sonner's; what matters here is what the palette asks
// it to say. `describeQuickAddLanding` has its own unit tests.
vi.mock("./quick-add-toast", () => ({ announceQuickAdd: vi.fn() }));

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

  it("leads with Overdrive while Overflow has cards, and ends with Delete (EI-383)", () => {
    renderPalette({ overflowCount: 8 });

    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options[0]).toBe("Open Overdrive (8)");
    expect(options.slice(-2)).toEqual(["Delete a list…", "Delete a tab…"]);
    expect(screen.getByText("Triage")).toBeTruthy();
  });

  it("with Overflow empty, starts at Create and keeps a disabled Overdrive under View (EI-383)", () => {
    renderPalette({ overflowCount: 0 });

    const options = screen.getAllByRole("option");
    expect(options[0].textContent).toBe("New to-do");
    expect(options.slice(-2).map((o) => o.textContent)).toEqual(["Delete a list…", "Delete a tab…"]);
    expect(screen.queryByText("Triage")).toBeNull();
    const overdrive = screen.getByRole("option", { name: "Overdrive — Overflow is empty" });
    expect(overdrive.getAttribute("aria-disabled")).toBe("true");
  });

  it("follows Overdrive with Quick sort in Triage while Backlog has cards (EI-386)", () => {
    renderPalette({ overflowCount: 8, backlogCount: 3 });

    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options.slice(0, 2)).toEqual(["Open Overdrive (8)", "Quick sort Backlog (3)"]);

    search("quick sort");
    expect(screen.getByRole("option", { name: "Quick sort Backlog (3)" })).toBeTruthy();
  });

  it("finds Settings, and opens a section directly (EI-386)", () => {
    const onOpenSettings = vi.fn();
    const onOpenChange = vi.fn();
    renderPalette({ onOpenSettings, onOpenChange });

    // "sett" used to find nothing better than "Show 7 days". Since EI-389
    // the create-from-query fallback follows the commands that match.
    search("sett");
    const names = screen.getAllByRole("option").map((o) => o.textContent);
    expect(names.slice(0, 3)).toEqual(["Open settings", "Faite Loop settings", "Design settings"]);
    expect(names.at(-1)).toBe("Create to-do “sett”");

    fireEvent.click(screen.getByRole("option", { name: "Faite Loop settings" }));
    expect(onOpenSettings).toHaveBeenCalledWith("loop");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("names itself only while open — no stray heading on a closed palette (EI-386)", () => {
    const { rerender } = renderPalette({ open: false });
    expect(screen.queryByRole("heading", { name: "Command palette" })).toBeNull();
    expect(screen.queryByText("Create and manage to-dos, lists, and labels")).toBeNull();

    rerender(
      <CommandPalette
        {...({
          ...renderPaletteDefaults(),
          open: true,
        } as React.ComponentProps<typeof CommandPalette>)}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Command palette" });
    const heading = screen.getByRole("heading", { name: "Command palette" });
    expect(dialog.contains(heading)).toBe(true);
  });

  it("still finds the moved commands by searching (EI-383)", () => {
    renderPalette({ overflowCount: 8 });

    search("delete a tab");
    expect(screen.getByRole("option", { name: "Delete a tab…" })).toBeTruthy();
    search("overdrive");
    expect(screen.getByRole("option", { name: "Open Overdrive (8)" })).toBeTruthy();
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

  it("names a to-do row title first, then its list, comma-separated (EI-381)", () => {
    renderPalette({
      todos: [todo({ id: "t1", title: "Buy oat milk", listId: "l2", priority: 2 })],
    });

    search("milk");

    expect(
      screen.getByRole("option", { name: "Buy oat milk, Priority 2, Grocery List" }),
    ).toBeTruthy();
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

/**
 * EI-389. The fallback's value contains the query verbatim, so cmdk scored it
 * near the top of every search: "loop" + Enter filed a to-do called "loop".
 * It now ranks below every real match, and leads only when there is none.
 */
describe("CommandPalette — Create to-do ranks below real matches (EI-389)", () => {
  const optionNames = () => screen.getAllByRole("option").map((o) => o.textContent);
  const selectedName = () =>
    document.body.querySelector('[cmdk-item][aria-selected="true"]')?.textContent;
  const pressEnter = () =>
    fireEvent.keyDown(screen.getByPlaceholderText(PLACEHOLDER), { key: "Enter" });

  it("“sett” highlights Open settings, not Create", () => {
    renderPalette();
    search("sett");
    expect(optionNames()[0]).toBe("Open settings");
    expect(selectedName()).toBe("Open settings");
  });

  it("“loop” + Enter opens Faite Loop settings and creates nothing", async () => {
    const onOpenSettings = vi.fn();
    renderPalette({ onOpenSettings });
    search("loop");
    expect(optionNames()[0]).toBe("Faite Loop settings");

    pressEnter();
    expect(onOpenSettings).toHaveBeenCalledWith("loop");
    expect(await getDb().todos.count()).toBe(0);
  });

  it("“overdrive” leads with Open Overdrive", () => {
    renderPalette({ overflowCount: 8 });
    search("overdrive");
    expect(selectedName()).toBe("Open Overdrive (8)");
    expect(optionNames().at(-1)).toBe("Create to-do “overdrive”");
  });

  it("puts a to-do hit above Create", () => {
    renderPalette();
    search("milk");
    const rows = screen.getAllByRole("option");
    expect(rows[0].getAttribute("data-todo-id")).toBe("t1");
    expect(rows[0].getAttribute("aria-selected")).toBe("true");
    expect(rows.at(-1)!.textContent).toBe("Create to-do “milk”");
  });

  it("stays below a match in another group even when a Create sibling matches too", () => {
    // "New tab" leads the Create group; the fallback must not ride along
    // with it past the Tabs and Delete rows that also match.
    renderPalette();
    search("tab");
    const names = optionNames();
    expect(names).toContain("Delete a tab…");
    expect(names.at(-1)).toBe("Create to-do “tab”");
  });

  it("a scattered, coincidental match does not take Enter from a capture", () => {
    // cmdk's subsequence scorer finds r…e…a…d in "Show items marked as
    // won't do" (0.02). Under the palette's match threshold, it is dropped.
    renderPalette();
    search("read");
    expect(screen.queryByRole("option", { name: "Show items marked as won't do" })).toBeNull();
    expect(optionNames()).toEqual(["Create to-do “read”"]);
  });

  it("keeps Create once a folded date leaves a trailing space in the search", () => {
    // The search is "buy milk " — which the row's value, built from the
    // trimmed query, cannot match. The row is not scored, so it stays.
    renderPalette();
    search("buy milk tomorrow ");
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveProperty("value", "buy milk ");
    expect(selectedName()).toBe("Create to-do “buy milk”");
  });

  it("with no other match, Create leads and Enter files it, chips and all", async () => {
    renderPalette();
    search("buy milk tomorrow");
    expect(optionNames()[0]).toBe("Create to-do “buy milk”");
    expect(selectedName()).toBe("Create to-do “buy milk”");
    expect(screen.getByRole("button", { name: "Keep “tomorrow” in the title" })).toBeTruthy();

    pressEnter();
    await waitFor(async () => expect(await getDb().todos.count()).toBe(1));
    const [created] = await getDb().todos.toArray();
    expect(created.title).toBe("buy milk");
    expect(created.scheduledDate).not.toBeNull();
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

  it("shows the folded word as a dismissible chip", () => {
    renderPalette();
    const input = enterNewTodoMode();
    fireEvent.change(input, { target: { value: "Buy milk tomorrow " } });
    expect(screen.getByRole("button", { name: "Keep “tomorrow” in the title" })).toBeTruthy();
  });

  it("dismissing the chip puts the word back in the title (EI-375)", () => {
    renderPalette();
    const input = enterNewTodoMode();
    fireEvent.change(input, { target: { value: "Buy milk tomorrow " } });
    fireEvent.mouseDown(screen.getByRole("button", { name: "Keep “tomorrow” in the title" }));
    expect(screen.queryByRole("button", { name: /^Keep “/ })).toBeNull();
    expect(input).toHaveProperty("value", "Buy milk tomorrow");
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

/**
 * EI-375 in the palette: the year on a date outside this year, a date chip
 * that can be dismissed, a typed-out "@list" that files, and a toast that
 * says where. Clock pinned to the day it was seen: Wed 2026-10-14.
 */
describe("CommandPalette — quick-add never misfiles silently (EI-375)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T12:00:00.000Z"));
    vi.mocked(announceQuickAdd).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const NEW_TODO = "What needs doing?";
  const openNewTodo = () => fireEvent.click(screen.getByText("New to-do"));
  const type = (text: string) =>
    fireEvent.change(screen.getByPlaceholderText(NEW_TODO), { target: { value: text } });
  const submit = () => fireEvent.keyDown(screen.getByPlaceholderText(NEW_TODO), { key: "Enter" });
  const onlyTodo = async () => {
    await waitFor(async () => expect(await getDb().todos.count()).toBe(1));
    return (await getDb().todos.toArray())[0];
  };

  it("shows the year when the date is not this year", () => {
    renderPalette();
    search("renew passport oct 1");
    expect(screen.getByText("Fri Oct 1, 2027")).toBeTruthy();
  });

  it("a dismissed date chip leaves the word in the title, unscheduled", async () => {
    renderPalette();
    openNewTodo();
    type("Call the dentist about Thursday");
    expect(screen.getByText("Thu Oct 15")).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("button", { name: "Keep “Thursday” in the title" }));
    expect(screen.queryByText("Thu Oct 15")).toBeNull();
    submit();

    const created = await onlyTodo();
    expect(created.title).toBe("Call the dentist about Thursday");
    expect(created.scheduledDate).toBeNull();
    expect(announceQuickAdd).toHaveBeenCalledWith(created.id, "Call the dentist about Thursday", {
      message: "Added to Backlog",
      note: null,
    });
  });

  it("files a typed-out @to-read into To Read, and says so", async () => {
    renderPalette({ lists: [...LISTS, list("l3", "To Read")] });
    openNewTodo();
    type("@to-read Dune thu");
    submit();

    const created = await onlyTodo();
    expect(created.title).toBe("Dune");
    expect(created.listId).toBe("l3");
    expect(announceQuickAdd).toHaveBeenCalledWith(created.id, "Dune", {
      message: "Added to Thu, Oct 15 · To Read",
      note: null,
    });
  });

  it("keeps an unmatched @mention in the title, shows it dashed, and says why", async () => {
    renderPalette();
    openNewTodo();
    type("@novels Dune");
    expect(screen.getByText("@novels · no list")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create a list called “novels”" })).toBeTruthy();
    submit();

    const created = await onlyTodo();
    expect(created.title).toBe("@novels Dune");
    expect(created.listId).toBe("l1");
    expect(announceQuickAdd).toHaveBeenCalledWith(created.id, "@novels Dune", {
      message: "Added to Backlog",
      note: "No list is called @novels, so it stayed in the title.",
    });
  });

  it("EI-379: two dates — the first applies, the other stays in the title as 'not used'", async () => {
    renderPalette();
    openNewTodo();
    type("Call about Thursday oct 1");
    expect(screen.getByText("Thu Oct 15")).toBeTruthy();
    expect(screen.getByText("oct 1 · not used")).toBeTruthy();
    submit();

    const created = await onlyTodo();
    expect(created.title).toBe("Call about oct 1");
    expect(created.scheduledDate).toBe("2026-10-15");
  });

  it("EI-379: a date at the start applies, the same as one at the end", async () => {
    renderPalette();
    openNewTodo();
    type("oct 1 renew passport");
    expect(screen.getByText("Fri Oct 1, 2027")).toBeTruthy();
    submit();

    const created = await onlyTodo();
    expect(created.title).toBe("renew passport");
    expect(created.scheduledDate).toBe("2027-10-01");
  });
});

/**
 * EI-387: a search hit shows what the board card shows about the same to-do —
 * its roll (↳), its Overflow age, and the year on a date outside this one.
 * Clock pinned to Wed 2026-10-14; `settings.overflowAfterDays` is 3.
 */
describe("CommandPalette — result rows say what the board says (EI-387)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const rowFor = (id: string) => document.body.querySelector<HTMLElement>(`[data-todo-id="${id}"]`)!;

  it("shows the ↳ marker on a rolled to-do, and says the roll in the row's name", () => {
    // Scheduled Mon Oct 12: rolled to Oct 13 and Oct 14, two of three rolls.
    renderPalette({ todos: [todo({ id: "r1", title: "Call dentist", scheduledDate: "2026-10-12" })] });

    search("dentist");

    const row = rowFor("r1");
    expect(row.querySelector("[data-rollover-marker]")).not.toBeNull();
    expect(row.querySelector("[data-overflow-age]")).toBeNull();
    expect(
      screen.getByRole("option", {
        name: "Call dentist, Rolled from Oct 12, 2 days ago, Overflow in 2 days, Scheduled Oct 12, Unfiled",
      }),
    ).toBeTruthy();
  });

  it("shows an Overflow to-do's age as the board does, and names Overflow in the row's name (EI-390)", () => {
    // Scheduled Oct 1: rolled Oct 2–4, crossed into Overflow Oct 5, nine
    // calendar days before today.
    renderPalette({ todos: [todo({ id: "o1", title: "Renew visa", scheduledDate: "2026-10-01" })] });

    search("visa");

    const row = rowFor("o1");
    expect(row.querySelector("[data-rollover-marker]")).toBeNull();
    expect(row.querySelector("[data-overflow-age]")?.textContent).toBe("since Oct 5 · 9 days");
    expect(
      screen.getByRole("option", {
        name: "Renew visa, Scheduled Oct 1, In Overflow since Oct 5, 9 days, Unfiled",
      }),
    ).toBeTruthy();
  });

  it("shows neither for a to-do that is not due yet", () => {
    renderPalette({ todos: [todo({ id: "f1", title: "Book flights", scheduledDate: "2026-10-20" })] });

    search("flights");

    const row = rowFor("f1");
    expect(row.querySelector("[data-rollover-marker]")).toBeNull();
    expect(row.querySelector("[data-overflow-age]")).toBeNull();
  });

  it("names the year on a scheduled date in another year, and not in this one", () => {
    renderPalette({
      todos: [
        todo({ id: "y1", title: "Renew passport 2027", scheduledDate: "2027-10-01" }),
        todo({ id: "y2", title: "Renew passport soon", scheduledDate: "2026-10-30" }),
      ],
    });

    search("renew passport");

    expect(rowFor("y1").textContent).toContain("Oct 1, 2027");
    expect(rowFor("y2").textContent).toContain("Oct 30");
    expect(rowFor("y2").textContent).not.toContain("2026");
    expect(
      screen.getByRole("option", { name: "Renew passport 2027, Scheduled Oct 1, 2027, Unfiled" }),
    ).toBeTruthy();
  });
});

/**
 * EI-391: a search hit's name says what state the to-do is in and when, and
 * a deadline clause starts with the words its badge shows. Clock pinned to
 * Wed 2026-10-14, noon UTC; the settings' timezone is UTC.
 */
describe("CommandPalette — result names speak their state (EI-391)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("names a done hit with its completion stamp, and keeps the planned date as Scheduled", () => {
    renderPalette({
      todos: [
        todo({
          id: "d1",
          title: "Pick up dry cleaning",
          status: "done",
          scheduledDate: "2026-10-12",
          completedAt: "2026-10-14T00:30:00.000Z",
        }),
      ],
    });

    search("dry cleaning");

    expect(
      screen.getByRole("option", {
        name: "Pick up dry cleaning, Completed Oct 14, 12:30 AM, Scheduled Oct 12, Unfiled",
      }),
    ).toBeTruthy();
  });

  it("names a Won't do hit with its stamp — the name is the only place the word is", () => {
    renderPalette({
      todos: [
        todo({
          id: "w1",
          title: "Pick up dry cleaning",
          status: "dropped",
          scheduledDate: "2026-10-14",
          completedAt: "2026-10-14T00:30:00.000Z",
        }),
      ],
    });

    search("dry cleaning");

    expect(
      screen.getByRole("option", {
        name: "Pick up dry cleaning, Marked won’t do Oct 14, 12:30 AM, Scheduled Oct 14, Unfiled",
      }),
    ).toBeTruthy();
    // Dim only, no visible word (owner decision 2026-10-15).
    expect(document.body.querySelector('[data-todo-id="w1"]')!.textContent).not.toMatch(/won.t do/i);
  });

  it("starts a missed deadline's clause with the badge's visible words", () => {
    renderPalette({ todos: [todo({ id: "m1", title: "File taxes", deadline: "2026-10-12" })] });

    search("taxes");

    expect(document.body.querySelector('[data-todo-id="m1"]')!.textContent).toContain("Deadline Oct 12");
    expect(
      screen.getByRole("option", { name: "File taxes, Deadline Oct 12, overdue by 2 days, Unfiled" }),
    ).toBeTruthy();
  });

  it("starts an upcoming deadline's clause with Deadline too", () => {
    renderPalette({ todos: [todo({ id: "u1", title: "File taxes", deadline: "2026-10-19" })] });

    search("taxes");

    expect(
      screen.getByRole("option", { name: "File taxes, Deadline Oct 19, due in 5 days, Unfiled" }),
    ).toBeTruthy();
  });
});
