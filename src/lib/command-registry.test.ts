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

function makeCtx(overrides: Partial<PaletteCommandCtx> = {}): PaletteCommandCtx {
  return {
    query: "",
    hasQuery: false,
    quickAddTitle: "",
    settings,
    overflowCount: 0,
    backlogCount: 0,
    duplicateCount: 0,
    platform: "mac",
    enterMode: vi.fn(),
    createFromQuery: vi.fn(),
    openHelp: vi.fn(),
    openOverdrive: vi.fn(),
    openQuickSort: vi.fn(),
    openActivity: vi.fn(),
    openHistory: vi.fn(),
    openDuplicates: vi.fn(),
    openSettings: vi.fn(),
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
    // The row's cmdk value (its selection key) stays anchored to the raw
    // query, not the quoted label — see the doc comment on
    // `PaletteCommand.value`.
    expect(fallback.value?.(ctx)).toBe("Create to-do milk");
  });

  it("marks the create-from-query row, and only it, as the fallback (EI-389)", () => {
    // The palette renders `fallback` rows last and never scores them, so a
    // second one would sink a real command below every match.
    expect(ROOT_COMMANDS.filter((c) => c.fallback).map((c) => c.id)).toEqual(["create-from-query"]);
  });

  it("always offers every New-X entry-mode switch, in Create", () => {
    const groups = commandsByGroup(makeCtx());
    const ids = groups.get("Create")!.map((c) => c.id);
    expect(ids).toEqual([
      "create-new-todo",
      "create-new-list",
      "create-new-label",
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
    const withItemsCmd = commandsByGroup(withItems).get("Triage")!.find((c) => c.id === "view-overdrive")!;
    expect(emptyCmd.disabled?.(empty)).toBe(true);
    expect(emptyCmd.label(empty)).toBe("Overdrive — Overflow is empty");
    expect(withItemsCmd.label(withItems)).toBe("Open Overdrive (3)");
  });

  it("moves Overdrive to Triage, the first group, while Overflow has cards (EI-383)", () => {
    const withItems = commandsByGroup(makeCtx({ overflowCount: 3 }));
    expect([...withItems.keys()][0]).toBe("Triage");
    expect(withItems.get("Triage")!.map((c) => c.id)).toEqual(["view-overdrive"]);
    expect(withItems.get("View")!.some((c) => c.id === "view-overdrive")).toBe(false);

    const empty = commandsByGroup(makeCtx({ overflowCount: 0 }));
    expect(empty.get("Triage")).toEqual([]);
    expect(empty.get("View")!.some((c) => c.id === "view-overdrive")).toBe(true);
  });

  it("files Quick sort under Triage while Backlog has open to-dos, after Overdrive (EI-386)", () => {
    const both = commandsByGroup(makeCtx({ overflowCount: 3, backlogCount: 4 }));
    expect(both.get("Triage")!.map((c) => c.id)).toEqual(["view-overdrive", "view-quick-sort"]);
    expect(both.get("View")!.some((c) => c.id === "view-quick-sort")).toBe(false);

    const backlogOnly = makeCtx({ backlogCount: 4 });
    const triage = commandsByGroup(backlogOnly).get("Triage")!;
    expect(triage.map((c) => c.id)).toEqual(["view-quick-sort"]);
    expect(triage[0].label(backlogOnly)).toBe("Quick sort Backlog (4)");

    // Nothing to sort: back under View, disabled, same id.
    const empty = makeCtx({ backlogCount: 0 });
    const view = commandsByGroup(empty).get("View")!.find((c) => c.id === "view-quick-sort")!;
    expect(view.disabled?.(empty)).toBe(true);
    expect(commandsByGroup(empty).get("Triage")).toEqual([]);
  });

  it("opens Settings, and its Faite Loop and Design sections directly (EI-386)", () => {
    const openSettings = vi.fn();
    const close = vi.fn();
    const ctx = makeCtx({ openSettings, close });
    const manage = commandsByGroup(ctx).get("Manage")!;
    const byLabel = (label: string) => manage.find((c) => c.label(ctx) === label)!;

    byLabel("Open settings").run(ctx);
    expect(openSettings).toHaveBeenLastCalledWith();
    byLabel("Faite Loop settings").run(ctx);
    expect(openSettings).toHaveBeenLastCalledWith("loop");
    byLabel("Design settings").run(ctx);
    expect(openSettings).toHaveBeenLastCalledWith("design");
    expect(close).toHaveBeenCalledTimes(3);
  });

  it("puts the destructive Delete commands last, under their old ids (EI-383)", () => {
    const groups = commandsByGroup(makeCtx({ overflowCount: 3, query: "del", hasQuery: true }));
    expect([...groups.keys()].at(-1)).toBe("Delete");
    expect(groups.get("Delete")!.map((c) => c.id)).toEqual(["manage-delete-list", "manage-delete-tab"]);
    expect(groups.get("Manage")!.some((c) => c.id.startsWith("manage-delete"))).toBe(false);
    // The registry's own order agrees, for any consumer that reads it flat.
    expect(ROOT_COMMANDS.slice(-2).map((c) => c.id)).toEqual(["manage-delete-list", "manage-delete-tab"]);
  });

  it("offers Delete only once something is typed (EI-392)", () => {
    expect(commandsByGroup(makeCtx()).get("Delete")).toEqual([]);
    // A folded chip with an empty search box is not a search for "delete".
    expect(commandsByGroup(makeCtx({ hasQuery: true })).get("Delete")).toEqual([]);
    const typed = commandsByGroup(makeCtx({ query: "d", hasQuery: true }));
    expect(typed.get("Delete")!.map((c) => c.id)).toEqual(["manage-delete-list", "manage-delete-tab"]);
  });

  it("routes Manage and Delete entries to enterMode/openHelp+close", () => {
    const enterMode = vi.fn();
    const openHelp = vi.fn();
    const close = vi.fn();
    const ctx = makeCtx({ enterMode, openHelp, close, query: "delete", hasQuery: true });
    const groups = commandsByGroup(ctx);
    const manage = groups.get("Manage")!;

    groups.get("Delete")!.find((c) => c.id === "manage-delete-list")!.run(ctx);
    expect(enterMode).toHaveBeenCalledWith("delete-list");

    manage.find((c) => c.id === "manage-keyboard-shortcuts")!.run(ctx);
    expect(openHelp).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("routes the activity-feed entry to openActivity+close", () => {
    const openActivity = vi.fn();
    const close = vi.fn();
    const ctx = makeCtx({ openActivity, close });
    const manage = commandsByGroup(ctx).get("Manage")!;

    manage.find((c) => c.id === "manage-activity-feed")!.run(ctx);
    expect(openActivity).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("routes the History entry to openHistory+close (EI-322)", () => {
    const openHistory = vi.fn();
    const close = vi.fn();
    const ctx = makeCtx({ openHistory, close });
    const manage = commandsByGroup(ctx).get("Manage")!;

    manage.find((c) => c.id === "manage-history")!.run(ctx);
    expect(openHistory).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
});
