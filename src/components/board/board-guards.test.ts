import { describe, expect, it } from "vitest";
import { isEligible, type GuardContext, type Hotkey } from "@/lib/keyboard";
import { computeModalOpen, type BoardOverlayState } from "./use-board-ui-state";

/**
 * `use-board-ui-state.ts`'s doc comment on `computeModalOpen` promises this
 * file: every field of `BoardOverlayState` independently drives it true, so
 * a new overlay added to the type without being wired into the function
 * fails a test instead of silently leaving ⌘Z live behind it
 * (docs/KEYBOARD.md's documented footgun). This file is that promise kept.
 *
 * Table-driven over `Object.keys(CLOSED)`, not a hand-written list of field
 * names — the point is that extending `CLOSED` for a new field is enough to
 * cover it here. A case that has to be added by hand is a case someone can
 * forget to add.
 */

const CLOSED: BoardOverlayState = {
  paletteOpen: false,
  openTodoExists: false,
  infoListId: null,
  infoTabId: null,
  archivedOpen: false,
  settingsOpen: false,
  openDay: null,
  overdriveOpen: false,
  helpSheetOpen: false,
};

/** The "open" value for each field — `true` for booleans, a sentinel string for the rest. */
const OPEN_VALUE: { [K in keyof BoardOverlayState]: BoardOverlayState[K] } = {
  paletteOpen: true,
  openTodoExists: true,
  infoListId: "list-1",
  infoTabId: "tab-1",
  archivedOpen: true,
  settingsOpen: true,
  openDay: "2026-08-13",
  overdriveOpen: true,
  helpSheetOpen: true,
};

describe("computeModalOpen", () => {
  it("is false when every overlay is closed", () => {
    expect(computeModalOpen(CLOSED)).toBe(false);
  });

  for (const key of Object.keys(CLOSED) as (keyof BoardOverlayState)[]) {
    it(`is true when only "${key}" is open`, () => {
      const state: BoardOverlayState = { ...CLOSED, [key]: OPEN_VALUE[key] };
      expect(computeModalOpen(state)).toBe(true);
    });
  }

  it("stays true with multiple overlays open at once", () => {
    expect(computeModalOpen({ ...CLOSED, paletteOpen: true, settingsOpen: true })).toBe(
      true,
    );
  });
});

/**
 * The guard contract `computeModalOpen` exists to defend: undo must not fire
 * behind a modal, and the palette must always be reachable regardless.
 * Asserting the boolean alone would miss a regression in `isEligible` itself.
 */
describe("modalOpen guards a real hotkey decision", () => {
  const undoHotkey: Hotkey = {
    id: "undo",
    combo: "mod+z",
    label: "Undo",
    group: "Board",
    run: () => {},
  };
  const paletteHotkey: Hotkey = {
    id: "command-palette",
    combo: "mod+k",
    label: "Open the command palette",
    group: "Navigation",
    allowDuringDrag: true,
    allowInTextEntry: true,
    allowWhenModalOpen: true,
    run: () => {},
  };

  it("blocks undo while a modal owns the keyboard", () => {
    const context: GuardContext = { dragging: false, modalOpen: computeModalOpen({
      ...CLOSED,
      openTodoExists: true,
    }) };
    expect(isEligible(undoHotkey, context)).toBe(false);
  });

  it("leaves the palette reachable regardless", () => {
    const context: GuardContext = { dragging: false, modalOpen: computeModalOpen({
      ...CLOSED,
      openTodoExists: true,
    }) };
    expect(isEligible(paletteHotkey, context)).toBe(true);
  });

  it("allows undo once every overlay is closed", () => {
    const context: GuardContext = { dragging: false, modalOpen: computeModalOpen(CLOSED) };
    expect(isEligible(undoHotkey, context)).toBe(true);
  });
});
