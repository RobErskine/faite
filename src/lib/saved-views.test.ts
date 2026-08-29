// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applySavedView,
  captureSavedView,
  readSavedViews,
  useSavedViews,
  type SavedView,
} from "./saved-views";
import type { Settings } from "./schema";

const settings = (over: Partial<Settings> = {}): Settings => ({
  ownerId: "local-user",
  timezone: "UTC",
  workdaysOnly: false,
  workdays: [1, 2, 3, 4, 5],
  overflowAfterDays: 3,
  visibleDays: 7,
  visibleStatuses: ["open"],
  visibleEventKinds: ["created", "scheduled", "done", "dropped"],
  visibleActivityKinds: ["created", "scheduled", "unscheduled", "moved", "done", "dropped", "reopened", "edited", "deleted", "rolledOver", "overflowed"],
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
  ...over,
});

beforeEach(() => {
  localStorage.clear();
});

describe("captureSavedView", () => {
  it("snapshots the four view fields, with a generated id and timestamp", () => {
    const view = captureSavedView(
      "Work",
      settings({ activeTabId: "tab-1", visibleStatuses: ["open", "done"], visibleDays: 5, showWeekends: false }),
    );
    expect(view.name).toBe("Work");
    expect(view.activeTabId).toBe("tab-1");
    expect(view.visibleStatuses).toEqual(["open", "done"]);
    expect(view.visibleDays).toBe(5);
    expect(view.showWeekends).toBe(false);
    expect(view.id).toBeTruthy();
    expect(view.createdAt).toBeTruthy();
  });
});

describe("applySavedView", () => {
  it("produces exactly the four-field settings patch, nothing else", () => {
    const view: SavedView = {
      id: "v1",
      name: "Weekend cleanup",
      createdAt: "2026-08-10T00:00:00.000Z",
      activeTabId: "tab-2",
      visibleStatuses: ["open", "dropped"],
      visibleDays: 3,
      showWeekends: true,
    };
    expect(applySavedView(view)).toEqual({
      activeTabId: "tab-2",
      visibleStatuses: ["open", "dropped"],
      visibleDays: 3,
      showWeekends: true,
    });
  });

  it("carries a null activeTabId through rather than dropping it", () => {
    const view: SavedView = {
      id: "v1",
      name: "No tab",
      createdAt: "2026-08-10T00:00:00.000Z",
      activeTabId: null,
      visibleStatuses: ["open"],
      visibleDays: 7,
      showWeekends: true,
    };
    expect(applySavedView(view).activeTabId).toBeNull();
  });
});

describe("readSavedViews", () => {
  it("returns an empty array when nothing has been persisted", () => {
    expect(readSavedViews()).toEqual([]);
  });

  it("falls back to an empty array on unparseable stored data", () => {
    localStorage.setItem("faite:saved-views", "not-json");
    expect(readSavedViews()).toEqual([]);
  });

  it("drops rows that don't look like a SavedView rather than crashing", () => {
    localStorage.setItem(
      "faite:saved-views",
      JSON.stringify([{ id: "v1" /* missing everything else */ }, { not: "a view" }]),
    );
    expect(readSavedViews()).toEqual([]);
  });
});

describe("useSavedViews", () => {
  it("starts from whatever is already persisted", () => {
    const view = captureSavedView("Existing", settings());
    localStorage.setItem("faite:saved-views", JSON.stringify([view]));

    const { result } = renderHook(() => useSavedViews());
    expect(result.current[0]).toEqual([view]);
  });

  it("round-trips a write through localStorage", () => {
    const { result } = renderHook(() => useSavedViews());
    const view = captureSavedView("New", settings());

    act(() => {
      result.current[1]((prev) => [...prev, view]);
    });

    expect(result.current[0]).toEqual([view]);
    expect(readSavedViews()).toEqual([view]);
  });

  it("supports deleting by filtering the updater", () => {
    const view = captureSavedView("Deletable", settings());
    const { result } = renderHook(() => useSavedViews());
    act(() => {
      result.current[1](() => [view]);
    });
    act(() => {
      result.current[1]((prev) => prev.filter((v) => v.id !== view.id));
    });
    expect(result.current[0]).toEqual([]);
    expect(readSavedViews()).toEqual([]);
  });
});
