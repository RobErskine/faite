// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CommandPalette } from "./command-palette";
import { FONT_PAIRINGS } from "@/lib/fonts";
import type { List, Settings, Tab, Todo } from "@/lib/schema";

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

const LISTS = [list("l1", "Backlog", true), list("l2", "Grocery List")];

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
    settings,
    activeTabId: "tab1",
    onSelectTodo: () => {},
    onSelectTab: () => {},
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

  it("offers every font pairing, previewed in its own pairing", () => {
    renderPalette();

    for (const pairing of FONT_PAIRINGS) {
      const label = screen.getByText(pairing.label);
      // data-font on the item scopes the pairing's CSS vars to that row, which
      // is what makes each option render as a preview of itself.
      expect(label.closest("[data-font]")?.getAttribute("data-font")).toBe(
        pairing.id,
      );
    }
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
