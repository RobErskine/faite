import { describe, expect, it, vi } from "vitest";
import { commandsByGroup, ROOT_COMMANDS, type PaletteCommandCtx } from "./command-registry";
import type { Settings } from "./schema";

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
  reminderPresetsSeeded: false,
  overdriveMinTodos: 5,
  overdriveAutoConfirmMs: 0,
  updatedAt: "2026-08-03T00:00:00.000Z",
};

function makeCtx(overrides: Partial<PaletteCommandCtx> = {}): PaletteCommandCtx {
  return {
    query: "",
    hasQuery: false,
    quickAddTitle: "",
    settings,
    overflowCount: 0,
    platform: "mac",
    enterMode: vi.fn(),
    createFromQuery: vi.fn(),
    openHelp: vi.fn(),
    openOverdrive: vi.fn(),
    close: vi.fn(),
    setVisibleDays: vi.fn(),
    setVisibleStatuses: vi.fn(),
    toggleWeekends: vi.fn(),
    toggleWorkdaysOnly: vi.fn(),
    ...overrides,
  };
}

describe("ROOT_COMMANDS", () => {
  it("has unique ids", () => {
    const ids = ROOT_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("commandsByGroup", () => {
  it("hides the create-from-query fallback when there's nothing to create", () => {
    const groups = commandsByGroup(makeCtx({ hasQuery: false }));
    expect(groups.get("Create")!.some((c) => c.id === "create-from-query")).toBe(false);
  });

  it("shows the fallback, quoting the parsed title, once there's a query", () => {
    const ctx = makeCtx({ hasQuery: true, query: "milk", quickAddTitle: "milk" });
    const groups = commandsByGroup(ctx);
    const fallback = groups.get("Create")!.find((c) => c.id === "create-from-query")!;
    expect(fallback.label(ctx)).toBe("Create to-do “milk”");
    // cmdk's match value stays anchored to the raw query, not the quoted
    // label — see the doc comment on `PaletteCommand.value`.
    expect(fallback.value?.(ctx)).toBe("Create to-do milk");
  });

  it("always offers every New-X entry-mode switch, in Create", () => {
    const groups = commandsByGroup(makeCtx());
    const ids = groups.get("Create")!.map((c) => c.id);
    expect(ids).toEqual([
      "create-new-todo",
      "create-new-list",
      "create-new-label",
      "create-new-project",
      "create-new-tab",
    ]);
  });

  it("marks the current day count and disables nothing there", () => {
    const ctx = makeCtx({ settings: { ...settings, visibleDays: 5 } });
    const groups = commandsByGroup(ctx);
    const five = groups.get("View")!.find((c) => c.id === "view-days-5")!;
    const seven = groups.get("View")!.find((c) => c.id === "view-days-7")!;
    expect(five.label(ctx)).toBe("Show 5 days (current)");
    expect(seven.label(ctx)).toBe("Show 7 days");
  });

  it("disables the last remaining visible status, so the board can't go empty", () => {
    const ctx = makeCtx({ settings: { ...settings, visibleStatuses: ["open"] } });
    const groups = commandsByGroup(ctx);
    const openCmd = groups.get("View")!.find((c) => c.id === "view-status-open")!;
    expect(openCmd.disabled?.(ctx)).toBe(true);
  });

  it("re-enables a status toggle once more than one status is visible", () => {
    const ctx = makeCtx({ settings: { ...settings, visibleStatuses: ["open", "done"] } });
    const groups = commandsByGroup(ctx);
    const openCmd = groups.get("View")!.find((c) => c.id === "view-status-open")!;
    expect(openCmd.disabled?.(ctx)).toBe(false);
  });

  it("turning a status back on restores STATUS_FILTERS order, not click order", async () => {
    const setVisibleStatuses = vi.fn();
    const ctx = makeCtx({ settings: { ...settings, visibleStatuses: ["dropped"] }, setVisibleStatuses });
    const groups = commandsByGroup(ctx);
    const openCmd = groups.get("View")!.find((c) => c.id === "view-status-open")!;
    await openCmd.run(ctx);
    expect(setVisibleStatuses).toHaveBeenCalledWith(["open", "dropped"]);
  });

  it("disables Overdrive when Overflow is empty, and labels it with the count otherwise", () => {
    const empty = makeCtx({ overflowCount: 0 });
    const withItems = makeCtx({ overflowCount: 3 });
    const emptyCmd = commandsByGroup(empty).get("View")!.find((c) => c.id === "view-overdrive")!;
    const withItemsCmd = commandsByGroup(withItems).get("View")!.find((c) => c.id === "view-overdrive")!;
    expect(emptyCmd.disabled?.(empty)).toBe(true);
    expect(emptyCmd.label(empty)).toBe("Overdrive — Overflow is empty");
    expect(withItemsCmd.label(withItems)).toBe("Open Overdrive (3)");
  });

  it("routes Manage entries to enterMode/openHelp+close", () => {
    const enterMode = vi.fn();
    const openHelp = vi.fn();
    const close = vi.fn();
    const ctx = makeCtx({ enterMode, openHelp, close });
    const manage = commandsByGroup(ctx).get("Manage")!;

    manage.find((c) => c.id === "manage-delete-list")!.run(ctx);
    expect(enterMode).toHaveBeenCalledWith("delete-list");

    manage.find((c) => c.id === "manage-keyboard-shortcuts")!.run(ctx);
    expect(openHelp).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
});
