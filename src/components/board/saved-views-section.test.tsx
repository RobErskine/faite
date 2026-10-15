// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SavedViewsSection } from "./saved-views-section";
import type { Settings } from "@/lib/schema";

const mutateSettings = vi.fn();
vi.mock("@/lib/store/mutate", () => ({
  mutateSettings: (...args: unknown[]) => mutateSettings(...args),
}));

const settings = (over: Partial<Settings> = {}): Settings => ({
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
  activeTabId: "tab-1",
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
  ...over,
});

const lastPatch = () => mutateSettings.mock.calls.at(-1)?.[1];

/** The section renders inside a menu its caller owns (the View menu). */
function SavedViewsMenu({ settings }: { settings: Settings }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>Open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <SavedViewsSection settings={settings} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
}

beforeEach(() => {
  localStorage.clear();
  mutateSettings.mockClear();
});
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

describe("SavedViewsSection — empty state", () => {
  it("says there are no saved views yet", () => {
    render(<SavedViewsMenu settings={settings()} />);
    openMenu();
    expect(screen.getByText("No saved views yet")).toBeTruthy();
  });
});

describe("SavedViewsSection — saving", () => {
  it("captures the current settings under the typed name", async () => {
    render(<SavedViewsMenu settings={settings({ visibleDays: 3, showWeekends: false })} />);
    openMenu();

    const input = screen.getByRole("textbox", { name: "New saved view name" });
    fireEvent.change(input, { target: { value: "Focus mode" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Focus mode")).toBeTruthy();
    expect(localStorage.getItem("faite:saved-views")).toContain("Focus mode");
    expect(localStorage.getItem("faite:saved-views")).toContain('"visibleDays":3');
  });

  it("submits on Enter as well as the Save button", async () => {
    render(<SavedViewsMenu settings={settings()} />);
    openMenu();
    const input = screen.getByRole("textbox", { name: "New saved view name" });
    fireEvent.change(input, { target: { value: "Via Enter" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("Via Enter")).toBeTruthy();
  });

  it("refuses to save a blank name", () => {
    render(<SavedViewsMenu settings={settings()} />);
    openMenu();
    expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("SavedViewsSection — applying", () => {
  it("writes the saved view's patch to settings when clicked", async () => {
    localStorage.setItem(
      "faite:saved-views",
      JSON.stringify([
        {
          id: "v1",
          name: "Weekend cleanup",
          createdAt: "2026-08-10T00:00:00.000Z",
          activeTabId: "tab-2",
          visibleStatuses: ["open", "dropped"],
          visibleDays: 3,
          showWeekends: true,
        },
      ]),
    );
    render(<SavedViewsMenu settings={settings()} />);
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Weekend cleanup" }));

    expect(lastPatch()).toEqual({
      activeTabId: "tab-2",
      visibleStatuses: ["open", "dropped"],
      visibleDays: 3,
      showWeekends: true,
    });
  });
});

describe("SavedViewsSection — deleting", () => {
  it("removes a view without applying it", async () => {
    localStorage.setItem(
      "faite:saved-views",
      JSON.stringify([
        {
          id: "v1",
          name: "Delete me",
          createdAt: "2026-08-10T00:00:00.000Z",
          activeTabId: null,
          visibleStatuses: ["open"],
          visibleDays: 7,
          showWeekends: true,
        },
      ]),
    );
    render(<SavedViewsMenu settings={settings()} />);
    openMenu();
    fireEvent.click(await screen.findByRole("button", { name: "Delete Delete me" }));

    expect(mutateSettings).not.toHaveBeenCalled();
    expect(screen.getByText("No saved views yet")).toBeTruthy();
    expect(localStorage.getItem("faite:saved-views")).toBe("[]");
  });
});

describe("SavedViewsSection — typing in the name field (EI-392)", () => {
  /**
   * The field shares the View menu with checkbox items, and the menu's own
   * React keydown handlers (typeahead, arrow roving) sit above it. A React
   * `onKeyDown` above the section stands in for them.
   */
  it("keeps the menu's typeahead from taking the keys, but not Escape", () => {
    const menuSaw = vi.fn();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <div onKeyDown={(e) => menuSaw(e.key)}>
            <SavedViewsSection settings={settings()} />
          </div>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    openMenu();
    const input = screen.getByRole("textbox", { name: "New saved view name" });
    fireEvent.keyDown(input, { key: "C" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(menuSaw).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(menuSaw).toHaveBeenCalledWith("Escape");
  });
});
