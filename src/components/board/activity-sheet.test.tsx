// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivitySheet, PAGE_SIZE } from "./activity-sheet";
import type { List, Settings, Tab, TodoEvent, Todo } from "@/lib/schema";
import type { PlacementContext } from "@/lib/scheduling";

/**
 * Mocked for the same reason as `day-sheet.test.tsx`/`view-settings.test.tsx`:
 * the filter tests assert PATCH SHAPE, invisible once Dexie round-trips it.
 */
const mutateSettings = vi.fn();
vi.mock("@/lib/store/mutate", () => ({
  mutateSettings: (...args: unknown[]) => mutateSettings(...args),
}));

/**
 * `ActivitySheet` reads the log through `useGlobalEvents`/`useTodoTitles`
 * (`lib/store/hooks.ts`), both thin Dexie live-queries — mocked here so each
 * test controls exactly what the feed sees, the same trade `DaySheet`'s
 * tests make by taking `todos` as a prop instead of querying Dexie directly.
 *
 * The mock reproduces the real hook's two-step shape — a raw newest-first
 * fetch capped at `shown`, THEN an `alive()` filter — rather than filtering
 * first and slicing second, specifically so a test can put a tombstoned
 * event inside the fetched window and assert `hasMore` still reflects the
 * raw fetch, not the post-filter count (the bug `useGlobalEvents`'s own
 * `GlobalEventsPage.hasMore` doc comment explains).
 */
let eventsFixture: TodoEvent[] = [];
let titlesFixture: ReadonlyMap<string, { title: string; deleted: boolean }> = new Map();
vi.mock("@/lib/store/hooks", () => ({
  useGlobalEvents: (shown: number) => {
    const raw = [...eventsFixture].sort((a, b) => b.at.localeCompare(a.at)).slice(0, shown);
    return { events: raw.filter((e) => !e.deletedAt), hasMore: raw.length === shown };
  },
  useTodoTitles: () => titlesFixture,
}));

beforeEach(() => {
  mutateSettings.mockClear();
  eventsFixture = [];
  titlesFixture = new Map();
});
afterEach(cleanup);

const DAY = "2026-08-10";

const ctx: PlacementContext = {
  today: DAY,
  visibleWindow: [DAY],
  workdaysOnly: false,
  workdays: [1, 2, 3, 4, 5],
  overflowAfterDays: 3,
};

function event(overrides: Partial<TodoEvent> & Pick<TodoEvent, "todoId" | "kind" | "at">): TodoEvent {
  return {
    id: overrides.id ?? `event-${overrides.todoId}-${overrides.at}-${overrides.kind}`,
    ownerId: "local-user",
    createdAt: overrides.at,
    updatedAt: overrides.at,
    deletedAt: null,
    payload: null,
    ...overrides,
  };
}

function todo(id: string, overrides: Partial<Todo> = {}): Todo {
  return {
    id,
    ownerId: "local-user",
    createdAt: `${DAY}T00:00:00.000Z`,
    updatedAt: `${DAY}T00:00:00.000Z`,
    deletedAt: null,
    title: id,
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
  };
}

const settings = (over: Partial<Settings> = {}): Settings => ({
  ownerId: "local-user",
  timezone: "UTC",
  workdaysOnly: false,
  workdays: [1, 2, 3, 4, 5],
  overflowAfterDays: 3,
  visibleDays: 7,
  visibleStatuses: ["open"],
  visibleEventKinds: ["created", "scheduled", "done", "dropped"],
  visibleActivityKinds: [
    "created",
    "scheduled",
    "unscheduled",
    "moved",
    "done",
    "dropped",
    "reopened",
    "edited",
    "deleted",
    "rolledOver",
    "overflowed",
  ],
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
  overdriveMinTodos: 5,
  overdriveAutoConfirmMs: 0,
  updatedAt: "2026-08-03T00:00:00.000Z",
  ...over,
});

const LISTS_BY_ID: ReadonlyMap<string, List> = new Map();
const TABS_BY_ID: ReadonlyMap<string, Tab> = new Map();

function list(id: string, overrides: Partial<List> = {}): List {
  return {
    id,
    ownerId: "local-user",
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    name: id,
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
  };
}

function Harness({
  todos = [],
  settingsOverride = settings(),
  onOpenTodo = () => {},
  listsByIdOverride = LISTS_BY_ID,
}: {
  todos?: Todo[];
  settingsOverride?: Settings;
  onOpenTodo?: (id: string) => void;
  listsByIdOverride?: ReadonlyMap<string, List>;
}) {
  return (
    <ActivitySheet
      open
      onOpenChange={() => {}}
      todos={todos}
      ctx={ctx}
      timezone="UTC"
      settings={settingsOverride}
      listsById={listsByIdOverride}
      tabsById={TABS_BY_ID}
      onOpenTodo={onOpenTodo}
    />
  );
}

function openFilterMenu() {
  fireEvent.click(screen.getByRole("button", { name: /which activity to show/i }));
}

const lastPatch = () => mutateSettings.mock.calls.at(-1)?.[1];

describe("mounting", () => {
  it("renders without throwing when the feed is empty", () => {
    expect(() => render(<Harness />)).not.toThrow();
    expect(screen.getByText("Nothing's happened yet.")).toBeTruthy();
  });
});

describe("ordering and grouping", () => {
  it("renders events newest-first under a day header", () => {
    titlesFixture = new Map([
      ["todo-a", { title: "Older task", deleted: false }],
      ["todo-b", { title: "Newer task", deleted: false }],
    ]);
    eventsFixture = [
      event({ todoId: "todo-a", kind: "created", at: `${DAY}T09:00:00.000Z` }),
      event({ todoId: "todo-b", kind: "created", at: `${DAY}T10:00:00.000Z` }),
    ];
    render(<Harness />);

    const titles = screen.getAllByText(/Older task|Newer task/).map((el) => el.textContent);
    expect(titles).toEqual(["Newer task", "Older task"]);
    expect(screen.getByText("Today")).toBeTruthy();
  });
});

describe("deleted todos", () => {
  it("shows a deleted todo's title but not as a clickable button", () => {
    titlesFixture = new Map([["todo-a", { title: "Ghost task", deleted: true }]]);
    eventsFixture = [event({ todoId: "todo-a", kind: "moved", at: `${DAY}T09:00:00.000Z` })];
    render(<Harness />);

    expect(screen.getByText("Ghost task")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ghost task" })).toBeNull();
  });

  it("opens a live todo's sheet when its title is clicked", () => {
    titlesFixture = new Map([["todo-a", { title: "Live task", deleted: false }]]);
    eventsFixture = [event({ todoId: "todo-a", kind: "done", at: `${DAY}T09:00:00.000Z` })];
    const onOpenTodo = vi.fn();
    render(<Harness onOpenTodo={onOpenTodo} />);

    fireEvent.click(screen.getByRole("button", { name: "Live task" }));
    expect(onOpenTodo).toHaveBeenCalledWith("todo-a");
  });
});

describe("unrecognized kinds", () => {
  it("falls back to 'Updated' rather than throwing", () => {
    titlesFixture = new Map([["todo-a", { title: "Task", deleted: false }]]);
    eventsFixture = [event({ todoId: "todo-a", kind: "frobnicated", at: `${DAY}T09:00:00.000Z` })];
    expect(() => render(<Harness />)).not.toThrow();
    expect(screen.getByText("Updated")).toBeTruthy();
  });
});

describe("rollups", () => {
  it("collapses N rolled-over todos into one expandable row", () => {
    // Scheduled the day before `ctx.today`, one eligible day elapsed.
    const rolled = todo("rolled-a", { scheduledDate: "2026-08-09", title: "Rolled task" });
    render(<Harness todos={[rolled]} />);

    expect(screen.getByText("Rolled over")).toBeTruthy();
    expect(screen.getByText("1 to-do")).toBeTruthy();
    expect(screen.queryByText("Rolled task")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "1 to-do" }));
    expect(screen.getByText("Rolled task")).toBeTruthy();
  });

  it("expands into a task/list/days grid, opens the todo on click", () => {
    const errands = list("list-errands", { name: "Errands" });
    const rolled = todo("rolled-a", {
      scheduledDate: "2026-08-09",
      title: "Rolled task",
      listId: "list-errands",
    });
    const onOpenTodo = vi.fn();
    render(
      <Harness
        todos={[rolled]}
        listsByIdOverride={new Map([["list-errands", errands]])}
        onOpenTodo={onOpenTodo}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "1 to-do" }));

    const table = screen.getByRole("table", { name: /Rolled over to-dos/i });
    expect(table).toBeTruthy();
    expect(screen.getByText("Task")).toBeTruthy();
    expect(screen.getByText("List")).toBeTruthy();
    expect(screen.getByText("Days")).toBeTruthy();
    expect(screen.getByText("Errands")).toBeTruthy();
    // One eligible day elapsed (scheduled the day before `ctx.today`).
    expect(screen.getByText("1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Rolled task" }));
    expect(onOpenTodo).toHaveBeenCalledWith("rolled-a");
  });

  it("shows Backlog when the rolled todo has no list", () => {
    const rolled = todo("rolled-a", { scheduledDate: "2026-08-09", title: "Rolled task", listId: null });
    render(<Harness todos={[rolled]} />);

    fireEvent.click(screen.getByRole("button", { name: "1 to-do" }));
    expect(screen.getByText("Backlog")).toBeTruthy();
  });
});

describe("kind filter", () => {
  it("writes visibleActivityKinds, not visibleEventKinds", async () => {
    titlesFixture = new Map([["todo-a", { title: "Task", deleted: false }]]);
    eventsFixture = [event({ todoId: "todo-a", kind: "created", at: `${DAY}T09:00:00.000Z` })];
    render(<Harness />);

    openFilterMenu();
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Created" }));

    const patch = lastPatch();
    expect(patch).toHaveProperty("visibleActivityKinds");
    expect(patch).not.toHaveProperty("visibleEventKinds");
  });

  it("shows the hidden-by-filter notice when the filter empties the page", () => {
    titlesFixture = new Map([["todo-a", { title: "Task", deleted: false }]]);
    eventsFixture = [event({ todoId: "todo-a", kind: "created", at: `${DAY}T09:00:00.000Z` })];
    render(<Harness settingsOverride={settings({ visibleActivityKinds: ["done"] })} />);

    expect(screen.getByText(/hidden by the view filter/)).toBeTruthy();
  });
});

/** N synthetic `created` events for todo-a, each a minute apart, newest at index 0. */
function manyEvents(n: number, startOffsetMinutes = 0): TodoEvent[] {
  return Array.from({ length: n }, (_, i) =>
    event({
      id: `evt-${String(i + startOffsetMinutes).padStart(4, "0")}`,
      todoId: "todo-a",
      kind: "created",
      at: new Date(Date.parse(`${DAY}T12:00:00.000Z`) - (i + startOffsetMinutes) * 60_000).toISOString(),
    }),
  );
}

describe("pagination", () => {
  beforeEach(() => {
    titlesFixture = new Map([["todo-a", { title: "Task", deleted: false }]]);
  });

  it("shows Load more when the page is exactly full, hides it once exhausted", () => {
    eventsFixture = manyEvents(PAGE_SIZE + 10);
    render(<Harness />);

    expect(screen.getByRole("button", { name: `Load ${PAGE_SIZE} more` })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: `Load ${PAGE_SIZE} more` }));
    expect(screen.queryByRole("button", { name: `Load ${PAGE_SIZE} more` })).toBeNull();
  });

  it("hides Load more immediately when there are fewer than one page's worth", () => {
    eventsFixture = manyEvents(5);
    render(<Harness />);
    expect(screen.queryByRole("button", { name: `Load ${PAGE_SIZE} more` })).toBeNull();
  });

  it("REGRESSION: still shows Load more when a tombstoned event falls inside the fetched window", () => {
    // Exactly PAGE_SIZE real (alive) events, plus a handful of undo-
    // tombstoned ones interleaved among the most recent PAGE_SIZE by `at` —
    // the raw fetch returns PAGE_SIZE rows, of which some are filtered out,
    // so the post-filter count alone would read as "not a full page" even
    // though PAGE_SIZE raw rows — and more beyond them — genuinely exist.
    const alive = manyEvents(PAGE_SIZE, 5);
    const tombstoned = manyEvents(5, 0).map((e) => ({ ...e, deletedAt: `${DAY}T00:00:00.000Z` }));
    eventsFixture = [...tombstoned, ...alive];
    render(<Harness />);

    expect(screen.getByRole("button", { name: `Load ${PAGE_SIZE} more` })).toBeTruthy();
  });
});
