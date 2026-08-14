import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "./quick-add";
import type { ReminderPreset } from "./schema";

// A Wednesday, chosen to make weekday wraparound cases unambiguous.
const TODAY = "2026-08-12";

describe("parseQuickAdd", () => {
  it("parses the worked example: title + priority + scheduled date + reminder time", () => {
    const result = parseQuickAdd("buy milk p2 fri 2pm", TODAY);
    expect(result.title).toBe("buy milk");
    expect(result.priority).toBe(2);
    expect(result.scheduledDate).toBe("2026-08-14"); // next Friday from a Wednesday
    expect(result.deadline).toBeNull();
    expect(result.reminderTime).toBe("14:00");
    expect(result.matches.map((m) => m.kind)).toEqual(["priority", "date", "time"]);
  });

  it("parses a leading priority", () => {
    const result = parseQuickAdd("p2 buy milk", TODAY);
    expect(result.title).toBe("buy milk");
    expect(result.priority).toBe(2);
    expect(result.matches).toEqual([{ raw: "p2", kind: "priority", label: "P2" }]);
  });

  it("does not treat a mid-string priority word as a token", () => {
    const result = parseQuickAdd("call mom about p1 stuff", TODAY);
    expect(result.title).toBe("call mom about p1 stuff");
    expect(result.priority).toBeNull();
    expect(result.matches).toEqual([]);
  });

  it("does not treat a leading date word as a token (leading run is priority-only)", () => {
    const result = parseQuickAdd("today I need to call mom", TODAY);
    expect(result.title).toBe("today I need to call mom");
    expect(result.scheduledDate).toBeNull();
    expect(result.matches).toEqual([]);
  });

  it("does not parse a bare number as a time", () => {
    const result = parseQuickAdd("meet at 5 people", TODAY);
    expect(result.title).toBe("meet at 5 people");
    expect(result.reminderTime).toBeNull();
  });

  it("passes plain text through untouched", () => {
    const result = parseQuickAdd("write the quarterly report", TODAY);
    expect(result.title).toBe("write the quarterly report");
    expect(result.priority).toBeNull();
    expect(result.scheduledDate).toBeNull();
    expect(result.deadline).toBeNull();
    expect(result.reminderTime).toBeNull();
    expect(result.matches).toEqual([]);
  });

  it("bails entirely when the whole input is tokens", () => {
    const result = parseQuickAdd("p2 fri 2pm", TODAY);
    expect(result.title).toBe("p2 fri 2pm");
    expect(result.priority).toBeNull();
    expect(result.scheduledDate).toBeNull();
    expect(result.reminderTime).toBeNull();
    expect(result.matches).toEqual([]);
  });

  it("a weekday that IS today resolves to today", () => {
    // TODAY is a Wednesday.
    const result = parseQuickAdd("standup wed", TODAY);
    expect(result.scheduledDate).toBe(TODAY);
  });

  it("wraps a weekday forward to next week when it already passed", () => {
    // TODAY is Wednesday; Monday has already happened this week.
    const result = parseQuickAdd("gym mon", TODAY);
    expect(result.scheduledDate).toBe("2026-08-17");
  });

  it("`next <weekday>` skips a full week past the plain occurrence", () => {
    const plain = parseQuickAdd("gym fri", TODAY);
    const next = parseQuickAdd("gym next fri", TODAY);
    expect(plain.scheduledDate).toBe("2026-08-14");
    expect(next.scheduledDate).toBe("2026-08-21");
  });

  it("parses relative day words", () => {
    expect(parseQuickAdd("pay rent today", TODAY).scheduledDate).toBe("2026-08-12");
    expect(parseQuickAdd("pay rent tomorrow", TODAY).scheduledDate).toBe("2026-08-13");
  });

  it("parses month-day and rolls to next year when the date already passed", () => {
    expect(parseQuickAdd("plan trip aug 14", TODAY).scheduledDate).toBe("2026-08-14");
    expect(parseQuickAdd("plan trip jan 1", TODAY).scheduledDate).toBe("2027-01-01");
  });

  it("parses slash dates with and without an explicit year", () => {
    expect(parseQuickAdd("renew passport 8/14", TODAY).scheduledDate).toBe("2026-08-14");
    expect(parseQuickAdd("renew passport 8/14/27", TODAY).scheduledDate).toBe("2027-08-14");
    expect(parseQuickAdd("renew passport 8/14/2027", TODAY).scheduledDate).toBe("2027-08-14");
  });

  it("parses an ISO date", () => {
    expect(parseQuickAdd("file taxes 2027-04-15", TODAY).scheduledDate).toBe("2027-04-15");
  });

  it("a `!`-prefixed date sets deadline instead of scheduledDate", () => {
    const result = parseQuickAdd("buy milk !fri", TODAY);
    expect(result.title).toBe("buy milk");
    expect(result.scheduledDate).toBeNull();
    expect(result.deadline).toBe("2026-08-14");
    expect(result.matches).toEqual([{ raw: "!fri", kind: "deadline", label: "Due Fri Aug 14" }]);
  });

  it("`!` works with the two-word month-day and next-weekday forms", () => {
    expect(parseQuickAdd("renew !aug 14", TODAY).deadline).toBe("2026-08-14");
    expect(parseQuickAdd("gym !next fri", TODAY).deadline).toBe("2026-08-21");
  });

  it("parses meridiem and 24-hour time forms", () => {
    expect(parseQuickAdd("call 2pm", TODAY).reminderTime).toBe("14:00");
    expect(parseQuickAdd("call 2:30pm", TODAY).reminderTime).toBe("14:30");
    expect(parseQuickAdd("call 9a", TODAY).reminderTime).toBe("09:00");
    expect(parseQuickAdd("call 14:00", TODAY).reminderTime).toBe("14:00");
    expect(parseQuickAdd("call 9:05", TODAY).reminderTime).toBe("09:05");
  });

  it("formats a time chip label in 12-hour form", () => {
    const result = parseQuickAdd("call 14:00", TODAY);
    expect(result.matches).toEqual([{ raw: "14:00", kind: "time", label: "2:00 PM" }]);
  });

  it("duplicate tokens of the same kind: the earliest in the string wins", () => {
    const result = parseQuickAdd("p1 buy milk p3", TODAY);
    expect(result.title).toBe("buy milk");
    expect(result.priority).toBe(1);
  });

  it("scheduledDate and deadline can both be set in one input", () => {
    const result = parseQuickAdd("buy milk fri !mon", TODAY);
    expect(result.title).toBe("buy milk");
    expect(result.scheduledDate).toBe("2026-08-14");
    expect(result.deadline).toBe("2026-08-17");
  });

  it("returns the input unchanged for an empty string", () => {
    const result = parseQuickAdd("", TODAY);
    expect(result.title).toBe("");
    expect(result.matches).toEqual([]);
  });
});

function preset(id: string, name: string, time: string, emoji: string | null = null): ReminderPreset {
  return {
    id,
    ownerId: "u",
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    name,
    time,
    position: "a0",
    color: null,
    emoji,
    iconUrl: null,
  };
}

describe("parseQuickAdd — preset-name vocabulary (EI-106 P4)", () => {
  const MORNING = preset("p1", "In the morning", "08:00", "🌅");
  const LUNCH = preset("p2", "Lunchtime", "12:30", "🥪");
  const PRESETS = [MORNING, LUNCH];

  it("resolves a trailing word to a preset whose name contains it", () => {
    const result = parseQuickAdd("gym tomorrow morning", TODAY, PRESETS);
    expect(result.title).toBe("gym");
    expect(result.scheduledDate).toBe("2026-08-13");
    expect(result.reminderTime).toBe("08:00");
  });

  it("chip label is the preset's own emoji + name, not a formatted clock time", () => {
    const result = parseQuickAdd("gym tomorrow morning", TODAY, PRESETS);
    const timeChip = result.matches.find((m) => m.kind === "time");
    expect(timeChip?.label).toBe("🌅 In the morning");
  });

  it("matches case-insensitively", () => {
    expect(parseQuickAdd("gym LUNCH", TODAY, PRESETS).reminderTime).toBe("12:30");
  });

  it("still resolves an ordinary numeric time when no preset matches", () => {
    const result = parseQuickAdd("call 2pm", TODAY, PRESETS);
    expect(result.reminderTime).toBe("14:00");
  });

  it("leaves reminderTime unset when the trailing word matches no preset and isn't a time", () => {
    const result = parseQuickAdd("call about the budget", TODAY, PRESETS);
    expect(result.reminderTime).toBeNull();
    expect(result.title).toBe("call about the budget");
  });

  it("does not resolve an ambiguous word matching more than one preset", () => {
    const AM = preset("p3", "AM check-in", "09:00");
    const PM = preset("p4", "PM check-in", "17:00");
    const result = parseQuickAdd("call check-in", TODAY, [AM, PM]);
    expect(result.reminderTime).toBeNull();
    // Falls through to plain title text, exactly like any other failed token.
    expect(result.title).toBe("call check-in");
  });

  it("defaults to no presets when the third argument is omitted — backward compatible", () => {
    const result = parseQuickAdd("gym tomorrow morning", TODAY);
    expect(result.reminderTime).toBeNull();
    expect(result.title).toBe("gym tomorrow morning");
  });
});

describe("parseQuickAdd — preset matching is word-bounded, not a bare substring", () => {
  // The real seeded defaults (repositories.ts's SEED_REMINDER_PRESETS) —
  // this reproduces the exact false-positive words a code review turned up
  // against them: "on" inside "Afternoon", "mo" inside "Morning", "it"
  // inside "Lunchtime".
  const MORNING = preset("p1", "Morning", "08:00");
  const LUNCHTIME = preset("p2", "Lunchtime", "12:30");
  const AFTERNOON = preset("p3", "Afternoon", "15:00");
  const END_OF_DAY = preset("p4", "End of day", "17:00");
  const EVENING = preset("p5", "Evening", "20:00");
  const SEEDED = [MORNING, LUNCHTIME, AFTERNOON, END_OF_DAY, EVENING];

  it("does not match a short word that is merely contained in a preset name", () => {
    expect(parseQuickAdd("note on", TODAY, SEEDED).reminderTime).toBeNull();
    expect(parseQuickAdd("note on", TODAY, SEEDED).title).toBe("note on");

    expect(parseQuickAdd("call mo", TODAY, SEEDED).reminderTime).toBeNull();
    expect(parseQuickAdd("buy it", TODAY, SEEDED).reminderTime).toBeNull();
  });

  it("does not strip the last word of a title just because it's a substring of a preset name", () => {
    const result = parseQuickAdd("prep for evening", TODAY, SEEDED);
    // "evening" is a genuine whole-word match here — this SHOULD resolve.
    expect(result.title).toBe("prep for");
    expect(result.reminderTime).toBe("20:00");
  });

  it("still matches a prefix of a preset's own word", () => {
    expect(parseQuickAdd("gym morn", TODAY, SEEDED).reminderTime).toBe("08:00");
    expect(parseQuickAdd("gym lunch", TODAY, SEEDED).reminderTime).toBe("12:30");
  });

  it("matches a whole word inside a multi-word preset name", () => {
    // "day" is a real, standalone word in "End of day" — a defensible match,
    // unlike "on" hiding mid-word inside "Afternoon".
    expect(parseQuickAdd("ship it end", TODAY, SEEDED).reminderTime).toBe("17:00");
  });

  it("floors out the shortest common words before they can equal a short preset word", () => {
    // Below PRESET_WORD_MIN_LENGTH — never even reaches the name comparison.
    expect(parseQuickAdd("call at", TODAY, SEEDED).reminderTime).toBeNull();
    expect(parseQuickAdd("meet in", TODAY, SEEDED).reminderTime).toBeNull();
  });
});
