import { describe, expect, it } from "vitest";
import { isHeldDuplicate } from "./duplicates";

describe("isHeldDuplicate", () => {
  it("never holds a to-do that is not flagged, whatever the setting", () => {
    expect(isHeldDuplicate({ duplicateOf: null, duplicateHeld: true }, true)).toBe(false);
  });

  it("holds only server-held matches by default", () => {
    expect(isHeldDuplicate({ duplicateOf: "a", duplicateHeld: true }, false)).toBe(true);
    expect(isHeldDuplicate({ duplicateOf: "a", duplicateHeld: false }, false)).toBe(false);
    expect(isHeldDuplicate({ duplicateOf: "a", duplicateHeld: null }, false)).toBe(false);
  });

  it("holds every match when holdAllDuplicates is on", () => {
    expect(isHeldDuplicate({ duplicateOf: "a", duplicateHeld: false }, true)).toBe(true);
  });
});
