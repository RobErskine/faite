import type { Hotkey } from "@/lib/keyboard";

/**
 * The full shortcut catalog for the help sheet (EI-75) — a hybrid, and
 * honest about being one.
 *
 * **Global** entries are DERIVED from the `Hotkey[]` registry
 * (`use-board-ui-state.ts`), so they cannot drift: a test
 * (`shortcuts.test.ts`) asserts every registry entry appears here. That
 * registry only has a couple of entries by design (docs/KEYBOARD.md §2 —
 * "prefer local") — most shortcuts are local `onKeyDown` handlers with no
 * central table to derive from.
 *
 * **Local** entries are hand-authored below, each with a `source` pointing
 * at the file that actually owns the behaviour. There is no mechanism that
 * keeps these in sync with the code the way the derived half is — that's
 * the real gap this catalog has, not a hidden one. See docs/KEYBOARD.md §5:
 * adding a new shortcut means adding it here too.
 */

export interface ShortcutEntry {
  /** Stable identity — the React key in the help sheet. */
  id: string;
  /** Same canonical combo format as `Hotkey.combo` — fed to `formatCombo`. */
  combo: string;
  label: string;
  scope:
    | "Global"
    | "Board navigation"
    | "To-do card"
    | "To-do sheet"
    | "Command palette"
    | "Overdrive"
    | "Quick add & mentions"
    | "Rails & split"
    | "Editor";
  /** Where this behaviour actually lives, for whoever edits it next. */
  source?: string;
}

/** Global entries, derived — never hand-duplicated. */
export function globalShortcuts(hotkeys: Hotkey[]): ShortcutEntry[] {
  return hotkeys.map((h) => ({
    id: h.id,
    combo: h.combo,
    label: h.label,
    scope: "Global",
  }));
}

export const LOCAL_SHORTCUTS: ShortcutEntry[] = [
  // --- Board navigation ---------------------------------------------------
  {
    id: "grid-nav",
    combo: "arrowdown",
    label: "Move focus between cards, group headers, and quick-add fields (any arrow key)",
    scope: "Board navigation",
    source: "lib/column-nav.ts, docs/KEYBOARD.md §11",
  },
  {
    id: "column-filter-focus",
    combo: "slash",
    label: "Focus this column's filter field",
    scope: "Board navigation",
    source: "board-column.tsx",
  },
  {
    id: "column-filter-clear",
    combo: "escape",
    label: "Clear the column filter, then blur it on the next press",
    scope: "Board navigation",
    source: "board-column.tsx",
  },
  {
    id: "expand-rail",
    combo: "enter",
    label: "Expand a collapsed Overflow or Backlog rail",
    scope: "Board navigation",
    source: "board-column.tsx",
  },
  {
    id: "group-toggle",
    combo: "enter",
    label: "Collapse or expand a list group within a day column",
    scope: "Board navigation",
    source: "board-column.tsx",
  },
  {
    id: "expand-split-strip",
    combo: "enter",
    label: "Expand a collapsed calendar/planning half",
    scope: "Board navigation",
    source: "split-strip.tsx",
  },
  {
    id: "expand-weekend",
    combo: "enter",
    label: "Expand a collapsed weekend strip",
    scope: "Board navigation",
    source: "weekend-column.tsx",
  },
  {
    id: "column-drag",
    combo: "space",
    label: "Lift, move, and drop a card or column for keyboard drag-and-drop",
    scope: "Board navigation",
    source: "dnd-kit KeyboardSensor — todo-card.tsx / board-column.tsx grips",
  },

  // --- To-do card -----------------------------------------------------------
  {
    id: "open-todo",
    combo: "enter",
    label: "Open the focused to-do",
    scope: "To-do card",
    source: "todo-card.tsx",
  },
  {
    id: "toggle-done",
    combo: "space",
    label: "Toggle the focused to-do done",
    scope: "To-do card",
    source: "todo-card.tsx",
  },

  // --- To-do sheet ------------------------------------------------------
  {
    id: "sheet-mark-done",
    combo: "mod+enter",
    label: "Mark done and close the sheet",
    scope: "To-do sheet",
    source: "todo-sheet.tsx",
  },
  {
    id: "sheet-wont-do",
    combo: "mod+backspace",
    label: "Mark won't-do and close the sheet",
    scope: "To-do sheet",
    source: "todo-sheet.tsx",
  },
  {
    id: "sheet-delete",
    combo: "mod+shift+backspace",
    label: "Delete the to-do (or skip this occurrence) and close the sheet",
    scope: "To-do sheet",
    source: "todo-sheet.tsx",
  },
  {
    id: "sheet-title-commit",
    combo: "enter",
    label: "Commit the title (blurs — no newline)",
    scope: "To-do sheet",
    source: "todo-sheet.tsx",
  },

  // --- Command palette ----------------------------------------------------
  {
    id: "palette-toggle-done",
    combo: "mod+enter",
    label: "Toggle done/open on the highlighted to-do",
    scope: "Command palette",
    source: "command-palette.tsx",
  },
  {
    id: "palette-wont-do",
    combo: "mod+backspace",
    label: "Mark the highlighted to-do won't-do",
    scope: "Command palette",
    source: "command-palette.tsx",
  },
  {
    id: "palette-delete",
    combo: "mod+shift+backspace",
    label: "Delete the highlighted to-do",
    scope: "Command palette",
    source: "command-palette.tsx",
  },
  {
    id: "palette-entry-submit",
    combo: "enter",
    label: "Submit an entry mode (e.g. a new list name)",
    scope: "Command palette",
    source: "command-palette.tsx",
  },
  {
    id: "palette-back",
    combo: "escape",
    label: "Return to the palette root",
    scope: "Command palette",
    source: "command-palette.tsx",
  },

  // --- Overdrive ------------------------------------------------------------
  {
    id: "overdrive-wont-do",
    combo: "arrowleft",
    label: "Won't-do the current card (unstages first if a day is picked)",
    scope: "Overdrive",
    source: "overdrive-overlay.tsx, docs/OVERDRIVE.md §9",
  },
  {
    id: "overdrive-done",
    combo: "arrowup",
    label: "Mark the current card done",
    scope: "Overdrive",
    source: "overdrive-overlay.tsx",
  },
  {
    id: "overdrive-to-list",
    combo: "arrowdown",
    label: "Send back to the card's own list",
    scope: "Overdrive",
    source: "overdrive-overlay.tsx",
  },
  {
    id: "overdrive-to-backlog",
    combo: "shift+arrowdown",
    label: "Force back to Backlog, regardless of the card's list",
    scope: "Overdrive",
    source: "overdrive-overlay.tsx",
  },
  {
    id: "overdrive-ramp",
    combo: "arrowright",
    label: "Stage a schedule day, one day further each press",
    scope: "Overdrive",
    source: "overdrive-overlay.tsx",
  },
  {
    id: "overdrive-ramp-week",
    combo: "shift+arrowright",
    label: "Stage a schedule day, one week further each press",
    scope: "Overdrive",
    source: "overdrive-overlay.tsx",
  },
  {
    id: "overdrive-confirm",
    combo: "enter",
    label: "Confirm the staged schedule day",
    scope: "Overdrive",
    source: "overdrive-overlay.tsx",
  },
  {
    id: "overdrive-date-picker",
    combo: "d",
    label: "Open the date picker",
    scope: "Overdrive",
    source: "overdrive-overlay.tsx",
  },
  {
    id: "overdrive-back",
    combo: "backspace",
    label: "Step back one verdict",
    scope: "Overdrive",
    source: "overdrive-overlay.tsx",
  },
  {
    id: "overdrive-cancel",
    combo: "escape",
    label: "Clear a staged day, then exit once nothing is staged",
    scope: "Overdrive",
    source: "overdrive-overlay.tsx",
  },

  // --- Quick add & mentions -------------------------------------------------
  {
    id: "quick-add-commit",
    combo: "enter",
    label: "Create the to-do from the quick-add draft",
    scope: "Quick add & mentions",
    source: "board-column.tsx",
  },
  {
    id: "quick-add-clear",
    combo: "escape",
    label: "Clear the quick-add draft, including any @list or #label mention",
    scope: "Quick add & mentions",
    source: "board-column.tsx",
  },
  {
    id: "mention-accept",
    combo: "enter",
    label: "Accept the highlighted @list or #label mention",
    scope: "Quick add & mentions",
    source: "mention-menu.tsx — quick-add, the to-do sheet title, and the palette all share this",
  },
  {
    id: "mention-dismiss",
    combo: "escape",
    label: "Dismiss the mention popover, keeping the typed text",
    scope: "Quick add & mentions",
    source: "mention-menu.tsx",
  },

  // --- Rails & split --------------------------------------------------------
  {
    id: "rail-resize",
    combo: "arrowleft",
    label: "Shrink the focused rail (Backlog/Overflow) by 16px",
    scope: "Rails & split",
    source: "use-rail-resize.ts",
  },
  {
    id: "rail-collapse",
    combo: "enter",
    label: "Collapse the focused rail",
    scope: "Rails & split",
    source: "use-rail-resize.ts",
  },
  {
    id: "split-resize",
    combo: "arrowup",
    label: "Move the calendar/planning split by 16px",
    scope: "Rails & split",
    source: "use-split-resize.ts",
  },
  {
    id: "split-collapse",
    combo: "enter",
    label: "Collapse whichever half is currently smaller",
    scope: "Rails & split",
    source: "use-split-resize.ts",
  },

  // --- Editor -----------------------------------------------------------
  {
    id: "editor-formatting",
    combo: "mod+b",
    label: "Rich-text formatting, lists, and markdown shortcuts (BlockNote's own keymap)",
    scope: "Editor",
    source: "ui/markdown-editor.tsx — day notes and to-do descriptions",
  },
];

/** Every entry, global first — global is derived, so pass the live registry. */
export function shortcutCatalog(hotkeys: Hotkey[]): ShortcutEntry[] {
  return [...globalShortcuts(hotkeys), ...LOCAL_SHORTCUTS];
}
