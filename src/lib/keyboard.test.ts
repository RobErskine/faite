import { describe, expect, it } from "vitest";
import {
  formatCombo,
  hasExactModifiers,
  isEligible,
  parseCombo,
  type GuardContext,
  type Hotkey,
} from "./keyboard";

/**
 * Only the pure layer is tested. Binding to the DOM is `react-hotkeys-hook`'s
 * job, and per docs/KEYBOARD.md §9 the useful thing to test is the combo maths
 * and the guard rules — which need no DOM at all.
 */

const mods = (over: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {}) => ({
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
});

describe("parseCombo", () => {
  it("splits modifiers from the key", () => {
    const { modifiers, key } = parseCombo("mod+shift+z");
    expect([...modifiers].sort()).toEqual(["mod", "shift"]);
    expect(key).toBe("z");
  });

  it("normalises aliases", () => {
    expect([...parseCombo("cmd+k").modifiers]).toEqual(["meta"]);
    expect([...parseCombo("control+k").modifiers]).toEqual(["ctrl"]);
    expect([...parseCombo("option+k").modifiers]).toEqual(["alt"]);
  });

  it("is case and whitespace insensitive", () => {
    expect(parseCombo(" MOD + K ")).toEqual(parseCombo("mod+k"));
  });
});

describe("hasExactModifiers", () => {
  it("accepts mod as either Ctrl or Meta", () => {
    expect(hasExactModifiers("mod+z", mods({ metaKey: true }))).toBe(true);
    expect(hasExactModifiers("mod+z", mods({ ctrlKey: true }))).toBe(true);
  });

  it("rejects an extra modifier the combo did not ask for", () => {
    // The load-bearing case: ⇧⌘Z is redo. If "mod+z" matched it, pressing redo
    // would silently perform an undo.
    expect(hasExactModifiers("mod+z", mods({ metaKey: true, shiftKey: true }))).toBe(
      false,
    );
    expect(hasExactModifiers("mod+z", mods({ metaKey: true, altKey: true }))).toBe(
      false,
    );
  });

  it("rejects Ctrl and Meta held together for a mod combo", () => {
    expect(
      hasExactModifiers("mod+z", mods({ ctrlKey: true, metaKey: true })),
    ).toBe(false);
  });

  it("requires the modifier to be present at all", () => {
    expect(hasExactModifiers("mod+z", mods())).toBe(false);
  });

  it("matches a multi-modifier combo exactly", () => {
    expect(
      hasExactModifiers("mod+shift+z", mods({ metaKey: true, shiftKey: true })),
    ).toBe(true);
    expect(hasExactModifiers("mod+shift+z", mods({ metaKey: true }))).toBe(false);
  });

  it("distinguishes an explicit ctrl combo from meta", () => {
    expect(hasExactModifiers("ctrl+k", mods({ ctrlKey: true }))).toBe(true);
    expect(hasExactModifiers("ctrl+k", mods({ metaKey: true }))).toBe(false);
  });
});

describe("isEligible", () => {
  const hotkey = (over: Partial<Hotkey> = {}): Hotkey => ({
    id: "x",
    combo: "mod+x",
    label: "Test",
    group: "Board",
    run: () => {},
    ...over,
  });
  const ctx = (over: Partial<GuardContext> = {}): GuardContext => ({
    dragging: false,
    modalOpen: false,
    ...over,
  });

  it("allows a plain shortcut when nothing else is happening", () => {
    expect(isEligible(hotkey(), ctx())).toBe(true);
  });

  it("blocks during a drag unless opted in", () => {
    // dnd-kit holds a board snapshot mid-drag; a write would invalidate it.
    expect(isEligible(hotkey(), ctx({ dragging: true }))).toBe(false);
    expect(
      isEligible(hotkey({ allowDuringDrag: true }), ctx({ dragging: true })),
    ).toBe(true);
  });

  it("blocks behind a modal unless opted in", () => {
    expect(isEligible(hotkey(), ctx({ modalOpen: true }))).toBe(false);
    expect(
      isEligible(hotkey({ allowWhenModalOpen: true }), ctx({ modalOpen: true })),
    ).toBe(true);
  });

  it("requires every relevant opt-in when several guards apply at once", () => {
    const both = ctx({ dragging: true, modalOpen: true });
    expect(isEligible(hotkey({ allowDuringDrag: true }), both)).toBe(false);
    expect(
      isEligible(
        hotkey({ allowDuringDrag: true, allowWhenModalOpen: true }),
        both,
      ),
    ).toBe(true);
  });
});

describe("formatCombo", () => {
  it("renders macOS glyphs with no separator", () => {
    expect(formatCombo("mod+k", "mac")).toBe("⌘K");
  });

  it("spells modifiers out elsewhere", () => {
    expect(formatCombo("mod+k", "other")).toBe("Ctrl+K");
  });

  it("uses the macOS modifier order regardless of how the combo is written", () => {
    // ⌃⌥⇧⌘ is the platform convention; writing it any other way looks wrong.
    expect(formatCombo("shift+mod+z", "mac")).toBe("⇧⌘Z");
    expect(formatCombo("mod+shift+z", "mac")).toBe("⇧⌘Z");
    expect(formatCombo("mod+alt+ctrl+shift+a", "mac")).toBe("⌃⌥⇧⌘A");
  });

  it("names non-letter keys", () => {
    expect(formatCombo("escape", "mac")).toBe("Esc");
    expect(formatCombo("mod+enter", "other")).toBe("Ctrl+Enter");
    expect(formatCombo("slash", "mac")).toBe("/");
    expect(formatCombo("mod+arrowup", "mac")).toBe("⌘↑");
  });

  it("handles a bare key with no modifiers", () => {
    expect(formatCombo("k", "mac")).toBe("K");
  });
});
