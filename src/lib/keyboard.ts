/**
 * The keyboard shortcut registry.
 *
 * Shortcuts are DATA, not a pile of listeners. One declarative table drives
 * three consumers — the key handler, the ⌘K palette hints, and the help sheet —
 * so a shortcut cannot exist without a label, and the help sheet cannot drift
 * from what is actually bound.
 *
 * That single source of truth is the reason this module exists.
 * `react-hotkeys-hook` handles combo matching underneath (see use-hotkeys.tsx)
 * but has no way to enumerate what it has registered, so the table would have
 * to be written by hand alongside it regardless.
 *
 * Everything here is pure and platform-agnostic — the DOM lives in
 * use-hotkeys.tsx. See docs/KEYBOARD.md.
 */

export type HotkeyGroup = "Board" | "Editing" | "Navigation";

export interface Hotkey {
  /** Stable identity. Used as the React key for the binding. */
  id: string;
  /**
   * Canonical combo: lowercase, `+`-separated, modifiers first.
   * `mod` resolves to ⌘ on macOS and Ctrl elsewhere.
   */
  combo: string;
  /** Shown in the help sheet and next to palette commands. */
  label: string;
  group: HotkeyGroup;
  /**
   * Guards, all defaulting to OFF — the safe direction. A shortcut has to opt
   * in to firing in a context that belongs to something else.
   * See docs/KEYBOARD.md §4.
   */
  allowDuringDrag?: boolean;
  allowInTextEntry?: boolean;
  allowWhenModalOpen?: boolean;
  run: () => void;
}

/** What the guards need to know about the app right now. */
export interface GuardContext {
  /** A card or column drag is in flight; dnd-kit's board snapshot is live. */
  dragging: boolean;
  /** The palette or the detail sheet is open and owns the keyboard. */
  modalOpen: boolean;
}

const MODIFIERS = new Set(["mod", "ctrl", "control", "shift", "alt", "option", "meta", "cmd"]);

export interface ParsedCombo {
  modifiers: Set<string>;
  /** The non-modifier key, e.g. "k". Empty if the combo is modifiers only. */
  key: string;
}

/** Split a combo into its modifiers and its single key. */
export function parseCombo(combo: string): ParsedCombo {
  const parts = combo
    .toLowerCase()
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);

  const modifiers = new Set<string>();
  let key = "";

  for (const part of parts) {
    if (MODIFIERS.has(part)) {
      // Normalise the aliases so comparison does not have to care.
      if (part === "control") modifiers.add("ctrl");
      else if (part === "option") modifiers.add("alt");
      else if (part === "cmd") modifiers.add("meta");
      else modifiers.add(part);
    } else {
      key = part;
    }
  }

  return { modifiers, key };
}

/** The modifier flags off a KeyboardEvent — narrowed so tests need no DOM. */
export interface ModifierState {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * True when the event's modifiers are EXACTLY the combo's, no extras.
 *
 * This is the §4.4 guard, and it is ours rather than the library's on purpose:
 * whether `react-hotkeys-hook` fires "mod+z" for ⇧⌘Z is undocumented, and
 * getting it wrong means pressing redo silently performs an undo. Checking it
 * here makes the answer ours, testable, and independent of the dependency.
 *
 * `mod` is satisfied by either Ctrl or Meta, but only one of them — holding
 * both is a different chord than the one that was registered.
 */
export function hasExactModifiers(combo: string, event: ModifierState): boolean {
  const { modifiers } = parseCombo(combo);

  const wantsShift = modifiers.has("shift");
  const wantsAlt = modifiers.has("alt");
  if (wantsShift !== event.shiftKey) return false;
  if (wantsAlt !== event.altKey) return false;

  if (modifiers.has("mod")) {
    // Exactly one of Ctrl/Meta, never both.
    return event.ctrlKey !== event.metaKey;
  }

  return (
    modifiers.has("ctrl") === event.ctrlKey && modifiers.has("meta") === event.metaKey
  );
}

/** Whether a hotkey may fire given what else is going on. */
export function isEligible(hotkey: Hotkey, context: GuardContext): boolean {
  if (context.dragging && !hotkey.allowDuringDrag) return false;
  if (context.modalOpen && !hotkey.allowWhenModalOpen) return false;
  return true;
}

export type Platform = "mac" | "other";

/**
 * macOS renders modifiers as glyphs in a fixed order and with no separator;
 * everywhere else spells them out joined by `+`. Getting the order wrong is
 * the kind of detail that makes a shortcut sheet look wrong without anyone
 * being able to say why.
 */
const MAC_ORDER = ["ctrl", "alt", "shift", "mod", "meta"];
const MAC_GLYPH: Record<string, string> = {
  ctrl: "⌃",
  alt: "⌥",
  shift: "⇧",
  mod: "⌘",
  meta: "⌘",
};
const OTHER_ORDER = ["ctrl", "mod", "alt", "shift", "meta"];
const OTHER_LABEL: Record<string, string> = {
  ctrl: "Ctrl",
  mod: "Ctrl",
  alt: "Alt",
  shift: "Shift",
  meta: "Win",
};

/** Keys whose display form is not just an uppercased letter. */
const KEY_LABEL: Record<string, string> = {
  escape: "Esc",
  enter: "Enter",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  " ": "Space",
  space: "Space",
  slash: "/",
  comma: ",",
  period: ".",
};

/** Render a combo for display, e.g. "mod+shift+z" → "⇧⌘Z" on macOS. */
export function formatCombo(combo: string, platform: Platform): string {
  const { modifiers, key } = parseCombo(combo);
  const isMac = platform === "mac";
  const order = isMac ? MAC_ORDER : OTHER_ORDER;
  const table = isMac ? MAC_GLYPH : OTHER_LABEL;

  const rendered = order.filter((m) => modifiers.has(m)).map((m) => table[m]);
  const keyLabel = KEY_LABEL[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  if (keyLabel) rendered.push(keyLabel);

  return isMac ? rendered.join("") : rendered.join("+");
}

/**
 * Best-effort platform sniff for DISPLAY ONLY.
 *
 * Never gate behaviour on this — `mod` already resolves to whichever of
 * Ctrl/Meta the user actually pressed, so a wrong guess here costs a cosmetic
 * glyph rather than a dead shortcut.
 */
export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)
    ? "mac"
    : "other";
}
