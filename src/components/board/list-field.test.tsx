// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ListField } from "./list-field";
import type { List, Tab, Todo } from "@/lib/schema";

beforeAll(() => {
  // Base UI's Select positioner reaches for this, same as every other
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

const trigger = () => document.getElementById("todo-list")!;

describe("ListField — closed trigger label", () => {
  it("shows '{tabName} > {listName}' for a list that belongs to a tab", () => {
    render(
      <ListField
        todo={todo({ listId: BRAIN_DUMP.id })}
        lists={[BACKLOG, BRAIN_DUMP, PROJECT_1]}
        tabs={[MY_LISTS, WORK]}
        onSave={vi.fn()}
      />,
    );
    expect(trigger().textContent).toContain("My Lists > Brain Dump");
  });

  it("shows just the name for Backlog — pinned into every tab, owned by none", () => {
    render(
      <ListField
        todo={todo({ listId: BACKLOG.id })}
        lists={[BACKLOG, BRAIN_DUMP]}
        tabs={[MY_LISTS]}
        onSave={vi.fn()}
      />,
    );
    expect(trigger().textContent).toContain("Backlog");
  });

  it("shows 'None' when the todo has no list", () => {
    render(<ListField todo={todo({ listId: null })} lists={[BACKLOG]} tabs={[MY_LISTS]} onSave={vi.fn()} />);
    expect(trigger().textContent).toContain("None");
  });

  it("shows 'Archived list' rather than the raw id for a dangling reference", () => {
    // Archiving a list (unlike deleting one) never reassigns the todos that
    // pointed at it, and useLists()-style hooks exclude archived rows — so
    // `lists` here genuinely has no entry for this id, the same shape as the
    // reported bug (a seed slug or UUID rendered verbatim).
    render(
      <ListField
        todo={todo({ listId: "seed:list:brain-dump" })}
        lists={[BACKLOG]}
        tabs={[MY_LISTS]}
        onSave={vi.fn()}
      />,
    );
    expect(trigger().textContent).toContain("Archived list");
    expect(trigger().textContent).not.toContain("seed:list");
  });
});

describe("ListField — grouped dropdown", () => {
  it("groups lists into sections by tab, with Backlog pinned ungrouped at the top", async () => {
    render(
      <ListField
        todo={todo({ listId: null })}
        lists={[BACKLOG, BRAIN_DUMP, PROJECT_1]}
        tabs={[MY_LISTS, WORK]}
        onSave={vi.fn()}
      />,
    );
    fireEvent.click(trigger());
    expect(await screen.findByRole("option", { name: "Backlog" })).toBeTruthy();
    expect(await screen.findByText("My Lists")).toBeTruthy();
    expect(await screen.findByRole("option", { name: "Brain Dump" })).toBeTruthy();
    expect(await screen.findByText("Work")).toBeTruthy();
    expect(await screen.findByRole("option", { name: "Project 1" })).toBeTruthy();
  });

  it("omits a tab's section entirely when it has no lists", async () => {
    const emptyTab = tab({ id: "tab-3", name: "Empty Tab" });
    render(
      <ListField
        todo={todo({ listId: null })}
        lists={[BACKLOG]}
        tabs={[MY_LISTS, emptyTab]}
        onSave={vi.fn()}
      />,
    );
    fireEvent.click(trigger());
    await screen.findByRole("option", { name: "Backlog" });
    expect(screen.queryByText("Empty Tab")).toBeNull();
  });
});

describe("ListField — writes", () => {
  it("saves the selected list's id", async () => {
    const onSave = vi.fn();
    render(
      <ListField
        todo={todo({ listId: null })}
        lists={[BACKLOG, BRAIN_DUMP]}
        tabs={[MY_LISTS]}
        onSave={onSave}
      />,
    );
    fireEvent.click(trigger());
    const option = await screen.findByRole("option", { name: "Brain Dump" });
    // Base UI's SelectItem only commits a REAL mouse click that started with
    // a pointerdown on the item itself (it distinguishes that from a
    // synthetic/assistive-tech click) — a bare fireEvent.click() alone is
    // treated as invalid and silently ignored.
    fireEvent.pointerDown(option, { pointerType: "mouse" });
    fireEvent.click(option);
    expect(onSave).toHaveBeenCalledWith("t1", { listId: BRAIN_DUMP.id });
  });

  it("saves null when 'None' is chosen", async () => {
    const onSave = vi.fn();
    render(
      <ListField
        todo={todo({ listId: BRAIN_DUMP.id })}
        lists={[BACKLOG, BRAIN_DUMP]}
        tabs={[MY_LISTS]}
        onSave={onSave}
      />,
    );
    fireEvent.click(trigger());
    const option = await screen.findByRole("option", { name: "None" });
    fireEvent.pointerDown(option, { pointerType: "mouse" });
    fireEvent.click(option);
    expect(onSave).toHaveBeenCalledWith("t1", { listId: null });
  });
});
