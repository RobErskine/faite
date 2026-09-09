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

  /**
   * REGRESSION (EI-314). `splitRatio` had been stored as a FRACTION since the
   * resize seam shipped — `clampSplit` returns `(topPx / totalPx) * 100` and
   * never rounds — while the schema said `.int()`. Nothing validated it: the
   * client writes to Dexie without this schema, `sanitizePatch` is a column
   * whitelist, and SQLite's `integer` type is advisory.
   *
   * `/api/v1/profile` was the first code to actually parse a settings row,
   * and it 500'd for every account that had ever dragged the divider — while
   * not even exposing `splitRatio`, which is device-local.
   */
  it("accepts the fractional splitRatio the board actually writes", () => {
    const settings = settingsOrDefault(
      { ownerId: "u1", updatedAt: "2026-09-09T00:00:00.000Z", splitRatio: 52.734375, timezone: "America/New_York" },
      "u1",
    );

    expect(settings.splitRatio).toBe(52.734375);
    expect(settings.timezone).toBe("America/New_York");
  });

  /**
   * The structural half of the same fix. A settings row is a wide bag of
   * mostly-cosmetic preferences; a reader that wants `timezone` should not
   * fail because a pane divider is out of spec.
   */
  it("drops a field that cannot parse and keeps everything that can", () => {
    const settings = settingsOrDefault(
      {
        ownerId: "u1",
        updatedAt: "2026-09-09T00:00:00.000Z",
        timezone: "America/New_York",
        overflowAfterDays: 5,
        splitRatio: "not a number",
      },
      "u1",
    );

    // The good fields survive...
    expect(settings.timezone).toBe("America/New_York");
    expect(settings.overflowAfterDays).toBe(5);
    // ...and the bad one falls back to its schema default rather than throwing.
    expect(settings.splitRatio).toBeNull();
  });

  it("survives several bad fields at once", () => {
    const settings = settingsOrDefault(
      {
        ownerId: "u1",
        updatedAt: "2026-09-09T00:00:00.000Z",
        timezone: "Europe/London",
        splitRatio: "nope",
        overflowAfterDays: "also nope",
        visibleDays: {},
      },
      "u1",
    );

    expect(settings.timezone).toBe("Europe/London");
    expect(settings.overflowAfterDays).toBe(3);
    expect(settings.visibleDays).toBe(7);
  });

  it("falls back entirely for a row too corrupt to repair", () => {
    const settings = settingsOrDefault({ timezone: 42, splitRatio: "x" } as Record<string, unknown>, "u1");

    expect(settings.ownerId).toBe("u1");
    expect(settings.timezone).toBe("UTC");
  });

});