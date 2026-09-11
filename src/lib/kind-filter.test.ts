import { describe, expect, it } from "vitest";
import {
  ACTIVITY_KIND_GENERATIONS,
  DAY_SHEET_KIND_GENERATIONS,
  HISTORY_KIND_GENERATIONS,
  resolveHiddenKinds,
  toggleHiddenKind,
} from "./kind-filter";
import { activityEventKindSchema, dayEventKindSchema } from "./schema";

/** The 11-kind array every activity-feed row held before EI-318 (migration 17). */
const ACTIVITY_BEFORE_EI_318 = [
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
];

describe("resolveHiddenKinds", () => {
  it("returns the stored hidden set once there is one, ignoring the old field", () => {
    expect(resolveHiddenKinds(["edited"], ["done"], ACTIVITY_KIND_GENERATIONS)).toEqual(["edited"]);
  });

  it("treats an empty stored hidden set as a real answer, not as unset", () => {
    expect(resolveHiddenKinds([], ["done"], ACTIVITY_KIND_GENERATIONS)).toEqual([]);
  });

  it("hides nothing when neither field is set", () => {
    expect(resolveHiddenKinds(null, null, ACTIVITY_KIND_GENERATIONS)).toEqual([]);
    expect(resolveHiddenKinds(undefined, undefined, ACTIVITY_KIND_GENERATIONS)).toEqual([]);
  });

  it("EI-320: an activity filter saved before EI-318 does not hide attached/detached", () => {
    expect(resolveHiddenKinds(null, ACTIVITY_BEFORE_EI_318, ACTIVITY_KIND_GENERATIONS)).toEqual([]);
  });

  it("keeps a real choice made in the old filter", () => {
    const withoutEdited = ACTIVITY_BEFORE_EI_318.filter((k) => k !== "edited");
    expect(resolveHiddenKinds(null, withoutEdited, ACTIVITY_KIND_GENERATIONS)).toEqual(["edited"]);
  });

  it("EI-320: the day sheet's 4-kind server default does not hide the Faite Loop rows", () => {
    expect(
      resolveHiddenKinds(null, ["created", "scheduled", "done", "dropped"], DAY_SHEET_KIND_GENERATIONS),
    ).toEqual([]);
  });

  it("counts a later kind as hidden when the array proves that build offered it", () => {
    // Naming `rolledOver` means the menu listed `overflowed` beside it, so
    // leaving `overflowed` out was a choice.
    expect(
      resolveHiddenKinds(
        null,
        ["created", "scheduled", "done", "dropped", "rolledOver"],
        DAY_SHEET_KIND_GENERATIONS,
      ),
    ).toEqual(["overflowed"]);
  });

  it("reads an empty old array as 'hide the original kinds', never the later ones", () => {
    expect(resolveHiddenKinds(null, [], DAY_SHEET_KIND_GENERATIONS)).toEqual([
      "created",
      "scheduled",
      "done",
      "dropped",
    ]);
  });

  it("a to-do's History had its whole vocabulary from the start", () => {
    expect(resolveHiddenKinds(null, ["done"], HISTORY_KIND_GENERATIONS)).toHaveLength(12);
  });
});

describe("toggleHiddenKind", () => {
  it("adds a kind when it is unchecked, and removes it when checked", () => {
    expect(toggleHiddenKind([], "edited", false)).toEqual(["edited"]);
    expect(toggleHiddenKind(["edited", "moved"], "edited", true)).toEqual(["moved"]);
  });

  it("never stores a kind twice", () => {
    expect(toggleHiddenKind(["edited"], "edited", false)).toEqual(["edited"]);
  });
});

describe("generations", () => {
  // The old fields are never written again, so these lists are history and
  // need no new entries. This only checks they name real kinds.
  it("name only kinds that exist", () => {
    for (const kind of DAY_SHEET_KIND_GENERATIONS.flat()) {
      expect(dayEventKindSchema.options).toContain(kind);
    }
    for (const kind of [...ACTIVITY_KIND_GENERATIONS, ...HISTORY_KIND_GENERATIONS].flat()) {
      expect(activityEventKindSchema.options).toContain(kind);
    }
  });
});
