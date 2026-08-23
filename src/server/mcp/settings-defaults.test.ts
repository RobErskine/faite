import { describe, expect, it } from "vitest";
import { settingsOrDefault } from "./settings-defaults";

describe("settingsOrDefault", () => {
  it("REGRESSION: parses a null row without throwing on `updatedAt`", () => {
    // Caught live: settingsSchema.parse({ ownerId }) alone throws "expected
    // string, received undefined" on updatedAt, since it's one of only two
    // fields (with ownerId) that carry no Zod default.
    expect(() => settingsOrDefault(null, "user-1")).not.toThrow();
  });

  it("fills every field with its schema default when no row exists", () => {
    const settings = settingsOrDefault(null, "user-1");
    expect(settings.ownerId).toBe("user-1");
    expect(settings.timezone).toBe("UTC");
    expect(settings.displayName).toBe("");
    expect(settings.workdaysOnly).toBe(false);
    expect(settings.overflowAfterDays).toBe(3);
  });

  it("stamps `updatedAt` from the injected clock, not a fixed value", () => {
    const settings = settingsOrDefault(null, "user-1", () => "2026-01-01T00:00:00.000Z");
    expect(settings.updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("passes a real row straight through the schema, untouched by the fallback", () => {
    const row = {
      ownerId: "user-1",
      timezone: "America/Los_Angeles",
      workdaysOnly: true,
      workdays: [1, 2, 3, 4, 5],
      overflowAfterDays: 5,
      visibleDays: 3,
      visibleStatuses: ["open"],
      visibleEventKinds: ["created"],
      showWeekends: false,
      fontPairing: "hyperlegible",
      theme: "dark",
      displayName: "Rob",
      avatarKind: "initials",
      avatarInitials: "RE",
      avatarEmoji: "",
      avatarImage: "",
      activeTabId: null,
      backlogWidth: null,
      backlogCollapsed: false,
      overflowWidth: null,
      overflowCollapsed: false,
      splitRatio: null,
      splitCollapsed: "none",
      reminderPresetsSeeded: true,
      overdriveMinTodos: 5,
      overdriveAutoConfirmMs: 0,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const settings = settingsOrDefault(row, "user-1");
    expect(settings.timezone).toBe("America/Los_Angeles");
    expect(settings.displayName).toBe("Rob");
    expect(settings.overflowAfterDays).toBe(5);
  });
});
