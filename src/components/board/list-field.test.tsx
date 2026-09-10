// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ListField } from "./list-field";
import type { List, Tab, Todo } from "@/lib/schema";

beforeAll(() => {
  // Base UI's Combobox positioner reaches for this, same as every other
  // floating-ui-backed popup stubbed elsewhere in this suite.
  Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

const todo = (overrides: Partial<Todo> = {}): Todo => ({
  id: "t1",
  ownerId: "local-user",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  title: "Timesheets",
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

const list = (overrides: Partial<List> & { id: string }): List => ({
  ownerId: "local-user",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  name: "Untitled",
  isBacklog: false,
  archivedAt: null,
  archivedWithTabId: null,
  position: "a0",
  tabId: null,
  defaultReminderPresetId: null,
  description: null,
  color: null,
  emoji: null,
  iconUrl: null,
  ...overrides,
});

const tab = (overrides: Partial<Tab> & { id: string }): Tab => ({
  ownerId: "local-user",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  name: "Untitled",
  description: null,
  isDefault: false,
  archivedAt: null,
  position: "a0",
  color: null,
  emoji: null,
  iconUrl: null,
  ...overrides,
});

const BACKLOG = list({ id: "seed:list:backlog", name: "Backlog", isBacklog: true });
const MY_LISTS = tab({ id: "tab-1", name: "My Lists", isDefault: true });
const WORK = tab({ id: "tab-2", name: "Work" });
const BRAIN_DUMP = list({ id: "seed:list:brain-dump", name: "Brain Dump", tabId: "tab-1" });
const PROJECT_1 = list({ id: "list-p1", name: "Project 1", tabId: "tab-2" });

const input = () => document.getElementById("todo-list") as HTMLInputElement;

/** `fireEvent.change` never opens the popup — see docs/PICKERS.md §4. */
function type(el: HTMLElement, value: string) {
  fireEvent.input(el, { target: { value }, inputType: "insertText" });
}

/** `openOnInputClick` listens for the pointer sequence, not a synthetic
 * `click` on its own — the same reason `pick` below needs a pointerdown. */
/**
 * ArrowDown, not a click. A synthetic `fireEvent.click` never opens a Base UI
 * Combobox under happy-dom — `openOnInputClick` wants a pointer sequence the
 * event helpers do not reproduce — so the popup silently stays empty and the
 * assertion fails on a component that is perfectly fine. ArrowDown is the
 * combobox's own open key and works. See docs/PICKERS.md §4.
 */
function open() {
  input().focus();
  fireEvent.keyDown(input(), { key: "ArrowDown" });
}

/** Base UI's Item only commits a real click that started with a pointerdown
 * on the item itself — a bare `fireEvent.click()` alone is ignored. */
function pick(option: HTMLElement) {
  fireEvent.pointerDown(option, { pointerType: "mouse" });
  fireEvent.click(option);
}

function setup(props: Partial<Parameters<typeof ListField>[0]> = {}) {
  const onSave = vi.fn();
  render(
    <ListField
      todo={todo()}
      lists={[BACKLOG, BRAIN_DUMP, PROJECT_1]}
      tabs={[MY_LISTS, WORK]}
      onSave={onSave}
      {...props}
    />,
  );
  return { onSave };
}

/**
 * The resting label is load-bearing beyond this component: the sheet's
 * derived Tab field was deleted (EI-318) precisely because this says which
 * tab a to-do is in. If it stops doing that, nothing else does.
 */
describe("ListField — what it says at rest", () => {
  it("shows '{tabName} > {listName}' for a list that belongs to a tab", () => {
    setup({ todo: todo({ listId: BRAIN_DUMP.id }) });
    expect(input().placeholder).toBe("My Lists > Brain Dump");
  });

  it("names the tab for every tab, not just the default one", () => {
    setup({ todo: todo({ listId: PROJECT_1.id }) });
    expect(input().placeholder).toBe("Work > Project 1");
  });

  it("shows Backlog unprefixed — it is pinned into every tab, owned by none", () => {
    setup({ todo: todo({ listId: BACKLOG.id }) });
    expect(input().placeholder).toBe("Backlog");
  });

  it("shows 'None' for an unfiled to-do", () => {
    setup();
    expect(input().placeholder).toBe("None");
  });

  it("shows 'Archived list' for a dangling listId, never a blank field", () => {
    // Archiving a list leaves every to-do's `listId` pointing at it while
    // `lists` here excludes archived rows, so the id resolves to nothing.
    setup({ todo: todo({ listId: "list-archived" }) });
    expect(input().placeholder).toBe("Archived list");
  });

  it("includes the emoji when the list has one", () => {
    const groceries = list({ id: "list-g", name: "Groceries", tabId: "tab-1", emoji: "🥕" });
    setup({
      todo: todo({ listId: groceries.id }),
      lists: [BACKLOG, groceries],
    });
    expect(input().placeholder).toBe("My Lists > 🥕 Groceries");
  });
});

describe("ListField — searching", () => {
  it("offers every list plus None when the field is resting", async () => {
    setup();
    open();
    expect(await screen.findByRole("option", { name: "None" })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Backlog/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Brain Dump/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Project 1/ })).toBeTruthy();
  });

  it("narrows on a list name", async () => {
    setup();
    open();
    type(input(), "brain");
    expect(await screen.findByRole("option", { name: /Brain Dump/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Project 1/ })).toBeNull();
  });

  it("narrows on a TAB name, surfacing every list in it", async () => {
    // The whole reason the tab is on the row rather than in a header: you
    // often know the tab and not the list.
    setup();
    open();
    type(input(), "work");
    expect(await screen.findByRole("option", { name: /Project 1/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Brain Dump/ })).toBeNull();
  });

  it("is case-insensitive", async () => {
    setup();
    open();
    type(input(), "PROJECT");
    expect(await screen.findByRole("option", { name: /Project 1/ })).toBeTruthy();
  });

  it("drops None while searching — unfiling is not a search result", async () => {
    setup();
    open();
    type(input(), "n");
    // "n" matches "Brain Dump", and must NOT also offer to unfile the to-do.
    expect(await screen.findByRole("option", { name: /Brain Dump/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "None" })).toBeNull();
  });

  it("says so when nothing matches, rather than closing the popup", async () => {
    // The empty state is always mounted for a second reason: without it,
    // Escape bubbles past the popup and closes the whole sheet.
    setup();
    open();
    type(input(), "zzzz");
    expect(await screen.findByText("No lists match.")).toBeTruthy();
  });
});

describe("ListField — writing", () => {
  it("files the to-do into the list picked", async () => {
    const { onSave } = setup();
    open();
    type(input(), "project");
    pick(await screen.findByRole("option", { name: /Project 1/ }));
    expect(onSave).toHaveBeenCalledWith("t1", { listId: PROJECT_1.id });
  });

  it("unfiles the to-do when None is picked", async () => {
    const { onSave } = setup({ todo: todo({ listId: PROJECT_1.id }) });
    open();
    pick(await screen.findByRole("option", { name: "None" }));
    expect(onSave).toHaveBeenCalledWith("t1", { listId: null });
  });

  it("clears the query after a pick, so the placeholder shows again", async () => {
    setup();
    open();
    type(input(), "project");
    pick(await screen.findByRole("option", { name: /Project 1/ }));
    expect(input().value).toBe("");
  });

  it("keeps a list whose tab was archived reachable", async () => {
    // Otherwise the only way out of that list is to know its name by heart.
    const orphan = list({ id: "list-o", name: "Old Project", tabId: "tab-gone" });
    const { onSave } = setup({ lists: [BACKLOG, orphan], tabs: [MY_LISTS] });
    open();
    pick(await screen.findByRole("option", { name: /Old Project/ }));
    expect(onSave).toHaveBeenCalledWith("t1", { listId: orphan.id });
  });
});
