import { describe, expect, it } from "vitest";
import { COLUMNS_BY_KIND, fromColumnValue, sanitizePatch, TABLE_NAME_BY_KIND, toColumnValue } from "./columns";

describe("TABLE_NAME_BY_KIND / COLUMNS_BY_KIND", () => {
  it("maps every sync kind to its physical table name", () => {
    expect(TABLE_NAME_BY_KIND).toEqual({
      todo: "todos",
      list: "lists",
      label: "labels",
      project: "projects",
      tab: "tabs",
      dayNote: "day_notes",
      place: "places",
      todoEvent: "todo_events",
      reminderPreset: "reminder_presets",
      settings: "settings",
    });
  });

  it("knows the real columns for todos, including sql name and coercion", () => {
    const columns = COLUMNS_BY_KIND.todo;
    expect(columns.ownerId).toEqual({ sqlName: "owner_id", dataType: "string", notNull: true, hasDefault: false });
    expect(columns.labelIds.dataType).toBe("json");
    expect(columns.version).toEqual({ sqlName: "version", dataType: "number", notNull: true, hasDefault: false });
  });

  it("knows lists.isBacklog is a boolean column with a default", () => {
    expect(COLUMNS_BY_KIND.list.isBacklog).toEqual({
      sqlName: "is_backlog",
      dataType: "boolean",
      notNull: true,
      hasDefault: true,
    });
  });

  it("settings has no id column, and workdays is JSON-encoded", () => {
    expect(COLUMNS_BY_KIND.settings.id).toBeUndefined();
    expect(COLUMNS_BY_KIND.settings.ownerId).toEqual({
      sqlName: "owner_id",
      dataType: "string",
      notNull: true,
      hasDefault: false,
    });
    expect(COLUMNS_BY_KIND.settings.workdays.dataType).toBe("json");
  });
});

describe("sanitizePatch", () => {
  it("drops version, id, and ownerId even when present in the patch", () => {
    const result = sanitizePatch("todo", { title: "A", version: 99, id: "x", ownerId: "attacker" });
    expect(result).toEqual({ title: "A" });
  });

  it("drops unknown keys", () => {
    const result = sanitizePatch("todo", { title: "A", notARealColumn: 1 });
    expect(result).toEqual({ title: "A" });
  });

  it("drops __proto__ and constructor rather than letting them through", () => {
    const patch = JSON.parse('{"title":"A","__proto__":{"polluted":true},"constructor":{}}');
    const result = sanitizePatch("todo", patch);
    expect(result).toEqual({ title: "A" });
    expect(Object.hasOwn(result, "__proto__")).toBe(false);
    expect(Object.hasOwn(result, "constructor")).toBe(false);
  });

  it("keeps every legitimate field of a full-row create patch", () => {
    const patch = { id: "x", title: "A", status: "open", labelIds: ["l1"], position: "a0" };
    const result = sanitizePatch("todo", patch);
    expect(result).toEqual({ title: "A", status: "open", labelIds: ["l1"], position: "a0" });
  });

  it("drops activeTabId for settings even though it's a real column", () => {
    const result = sanitizePatch("settings", { fontPairing: "hyperlegible", activeTabId: "tab-1" });
    expect(result).toEqual({ fontPairing: "hyperlegible" });
  });

  it("keeps every allow-listed settings field", () => {
    const patch = { timezone: "America/Chicago", theme: "dark", displayName: "Rob" };
    expect(sanitizePatch("settings", patch)).toEqual(patch);
  });
});

describe("toColumnValue / fromColumnValue", () => {
  it("round-trips labelIds (json) through the SQL boundary", () => {
    const stored = toColumnValue("todo", "labelIds", ["a", "b"]);
    expect(stored).toBe('["a","b"]');
    expect(fromColumnValue("todo", "labelIds", stored)).toEqual(["a", "b"]);
  });

  it("round-trips isBacklog (boolean) through the SQL boundary", () => {
    expect(toColumnValue("list", "isBacklog", true)).toBe(1);
    expect(toColumnValue("list", "isBacklog", false)).toBe(0);
    expect(fromColumnValue("list", "isBacklog", 1)).toBe(true);
    expect(fromColumnValue("list", "isBacklog", 0)).toBe(false);
  });

  it("passes strings through unchanged", () => {
    expect(toColumnValue("todo", "title", "Buy milk")).toBe("Buy milk");
    expect(fromColumnValue("todo", "title", "Buy milk")).toBe("Buy milk");
  });

  it("maps null/undefined to a null bind value", () => {
    expect(toColumnValue("todo", "description", null)).toBeNull();
    expect(toColumnValue("todo", "description", undefined)).toBeNull();
  });
});
