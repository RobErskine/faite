import { describe, expect, it } from "vitest";
import type { ReminderPreset } from "@/lib/schema";
import { formatReminderTime, parsePresetQuery, reminderLabelFor } from "./reminder-presets";

function preset(overrides: Partial<ReminderPreset> & { id: string }): ReminderPreset {
  return {
    ownerId: "u",
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    name: overrides.id,
    time: "08:00",
    position: "a0",
    color: null,
    emoji: null,
    iconUrl: null,
    ...overrides,
  };
}

const MORNING = preset({ id: "p1", name: "In the morning", time: "08:00", emoji: "🌅" });
const LUNCH = preset({ id: "p2", name: "Lunchtime", time: "12:30", emoji: "🥪" });
const NO_EMOJI = preset({ id: "p3", name: "9", time: "09:00", emoji: null });
const PRESETS = [MORNING, LUNCH, NO_EMOJI];

describe("formatReminderTime", () => {
  it("formats an ordinary afternoon time", () => {
    expect(formatReminderTime("14:00")).toBe("2:00 PM");
  });

  it("formats midnight as 12:00 AM", () => {
    expect(formatReminderTime("00:00")).toBe("12:00 AM");
  });

  it("formats noon as 12:00 PM", () => {
    expect(formatReminderTime("12:00")).toBe("12:00 PM");
  });
});

describe("reminderLabelFor", () => {
  it("renders emoji + name for a matching preset", () => {
    expect(reminderLabelFor("08:00", PRESETS)).toBe("🌅 In the morning");
  });

  it("renders just the name when the preset has no emoji", () => {
    expect(reminderLabelFor("09:00", PRESETS)).toBe("9");
  });

  it("falls back to a formatted clock time with no matching preset", () => {
    expect(reminderLabelFor("15:45", PRESETS)).toBe("3:45 PM");
  });
});

describe("parsePresetQuery", () => {
  it("lists every preset on an empty query", () => {
    expect(parsePresetQuery("", PRESETS)).toEqual({ kind: "match", presets: PRESETS });
  });

  it("matches presets by name substring, case-insensitively", () => {
    expect(parsePresetQuery("morn", PRESETS)).toEqual({ kind: "match", presets: [MORNING] });
  });

  it("parses a bare time as 'time', not 'create'", () => {
    expect(parsePresetQuery("9:30am", PRESETS)).toEqual({ kind: "time", time: "09:30" });
  });

  it("parses 24-hour notation the same way", () => {
    expect(parsePresetQuery("14:00", PRESETS)).toEqual({ kind: "time", time: "14:00" });
  });

  it("parses a name followed by a time as 'create'", () => {
    expect(parsePresetQuery("gym 9:30am", PRESETS)).toEqual({
      kind: "create",
      name: "gym",
      time: "09:30",
    });
  });

  it("treats a name that is ALSO a time-shaped word as a plain name match, not a time", () => {
    // "9" alone does not match matchTime's grammar (no am/pm, no colon), so
    // this falls through to a name-substring match against the NO_EMOJI preset.
    expect(parsePresetQuery("9", PRESETS)).toEqual({ kind: "match", presets: [NO_EMOJI] });
  });

  it("returns 'none' when nothing matches and it isn't a time", () => {
    expect(parsePresetQuery("xyz", PRESETS)).toEqual({ kind: "none" });
  });

  it("returns 'none' for a multi-word query with no trailing time and no name match", () => {
    expect(parsePresetQuery("totally unrelated words", PRESETS)).toEqual({ kind: "none" });
  });
});
