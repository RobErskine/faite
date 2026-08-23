import type { Settings, TodoStatus } from "./schema";
import { formatCombo, type Platform } from "./keyboard";

/**
 * The command palette's root-menu registry — EI-77.
 *
 * Before this, every root-menu row in `command-palette.tsx` was inline JSX
 * with an inline `onSelect`: nothing could enumerate, filter, or reuse the
 * command list programmatically (see `docs/COMMAND-PALETTE.md` §7.1). This
 * module is a plain, framework-agnostic data structure instead — an array of
 * `PaletteCommand`s the palette renders from, and a planned `/capture`
 * quick-add window (separate effort) can import without pulling in `cmdk` or
 * any of the palette's dialog/DOM machinery.
 *
 * Deliberately in scope: the "Create" entry-mode switches, the create-from-
 * query fallback, "Manage", and "View". Deliberately OUT of scope — these
 * stay bespoke renders in `command-palette.tsx`, not registry entries:
 *   - to-do search results and the Tabs switcher (existing entities, not
 *     commands — see docs/COMMAND-PALETTE.md §4's own Create/Tabs split)
 *   - the delete-list/delete-tab picker bodies (same reason: they list
 *     existing entities to act on, one CommandItem per entity)
 *   - the multi-step entry modes themselves (new-list, new-todo, …) — a
 *     command here only *switches into* one via `enterMode`; the mode body
 *     (the text input + its Enter-to-create row) is a distinct concept from
 *     a single-shot command, per the EI-77 brief, and stays in the component.
 *
 * Every side effect (persistence, toasts, navigation) is injected through
 * `PaletteCommandCtx` rather than imported here — this module never touches
 * `mutateSettings`/`createTodo`/etc directly, so it stays pure and reusable
 * by a consumer with different persistence wiring.
 */

/** The multi-step / picker modes a root command can switch the palette into. */
export type PaletteEntryMode =
  | "new-todo"
  | "new-list"
  | "new-label"
  | "new-tab"
  | "delete-list"
  | "delete-tab";

export interface PaletteCommandCtx {
  /** Root search box text, trimmed. */
  query: string;
  /** True once there's something `createFromQuery` could file — a live query
   * or a quick-add match already folded into a chip (`foldQuickAddDraft`
   * can empty `query` while a chip still needs to save). */
  hasQuery: boolean;
  /** The parsed title `createFromQuery` will actually save — may differ from
   * `query` once folded matches are reappended (`quickAddDraftToString`). */
  quickAddTitle: string;
  settings: Settings | undefined;
  overflowCount: number;
  platform: Platform;
  enterMode: (kind: PaletteEntryMode) => void;
  createFromQuery: () => void | Promise<void>;
  openHelp: () => void;
  openOverdrive: () => void;
  openActivity: () => void;
  close: () => void;
  setVisibleDays: (days: number) => void | Promise<void>;
  setVisibleStatuses: (next: TodoStatus[]) => void | Promise<void>;
  toggleWeekends: () => void | Promise<void>;
  toggleWorkdaysOnly: () => void | Promise<void>;
}

export const COMMAND_GROUPS = ["Create", "Manage", "View"] as const;
export type PaletteCommandGroup = (typeof COMMAND_GROUPS)[number];

export interface PaletteCommand {
  id: string;
  group: PaletteCommandGroup;
  label: (ctx: PaletteCommandCtx) => string;
  /** Overrides cmdk's default match value (which falls back to the rendered
   * label) — only the create-from-query fallback needs this, so its value
   * stays anchored to the raw query rather than the quoted preview text. */
  value?: (ctx: PaletteCommandCtx) => string;
  shortcut?: (ctx: PaletteCommandCtx) => string | undefined;
  /** Omit to always show. */
  when?: (ctx: PaletteCommandCtx) => boolean;
  disabled?: (ctx: PaletteCommandCtx) => boolean;
  className?: string;
  run: (ctx: PaletteCommandCtx) => void | Promise<void>;
}

const VIEW_DAY_OPTIONS = [1, 3, 5, 7] as const;

/**
 * Same vocabulary and order as the DateNav control's status checkboxes
 * (`view-settings.tsx`) — one wording for one setting, whichever surface you
 * reach it through.
 */
const STATUS_FILTERS: ReadonlyArray<{ value: TodoStatus; label: string }> = [
  { value: "open", label: "todo items" },
  { value: "done", label: "completed items" },
  { value: "dropped", label: "items marked as won't do" },
];

const CREATE_COMMANDS: PaletteCommand[] = [
  {
    id: "create-from-query",
    group: "Create",
    when: (ctx) => ctx.hasQuery,
    value: (ctx) => `Create to-do ${ctx.query}`,
    label: (ctx) => `Create to-do “${ctx.quickAddTitle}”`,
    run: (ctx) => ctx.createFromQuery(),
  },
  { id: "create-new-todo", group: "Create", label: () => "New to-do", run: (ctx) => ctx.enterMode("new-todo") },
  { id: "create-new-list", group: "Create", label: () => "New list", run: (ctx) => ctx.enterMode("new-list") },
  { id: "create-new-label", group: "Create", label: () => "New label", run: (ctx) => ctx.enterMode("new-label") },
  { id: "create-new-tab", group: "Create", label: () => "New tab", run: (ctx) => ctx.enterMode("new-tab") },
];

const MANAGE_COMMANDS: PaletteCommand[] = [
  {
    id: "manage-delete-list",
    group: "Manage",
    label: () => "Delete a list…",
    run: (ctx) => ctx.enterMode("delete-list"),
  },
  {
    id: "manage-delete-tab",
    group: "Manage",
    label: () => "Delete a tab…",
    run: (ctx) => ctx.enterMode("delete-tab"),
  },
  {
    id: "manage-keyboard-shortcuts",
    group: "Manage",
    label: () => "Keyboard shortcuts",
    shortcut: (ctx) => formatCombo("shift+slash", ctx.platform),
    run: (ctx) => {
      ctx.openHelp();
      ctx.close();
    },
  },
  {
    id: "manage-activity-feed",
    group: "Manage",
    label: () => "Activity feed",
    shortcut: (ctx) => formatCombo("mod+shift+a", ctx.platform),
    run: (ctx) => {
      ctx.openActivity();
      ctx.close();
    },
  },
];

const VIEW_DAYS_COMMANDS: PaletteCommand[] = VIEW_DAY_OPTIONS.map((days) => ({
  id: `view-days-${days}`,
  group: "View",
  className: "nums",
  label: (ctx: PaletteCommandCtx) =>
    `Show ${days} day${days > 1 ? "s" : ""}${ctx.settings?.visibleDays === days ? " (current)" : ""}`,
  run: (ctx: PaletteCommandCtx) => ctx.setVisibleDays(days),
}));

const VIEW_STATUS_COMMANDS: PaletteCommand[] = STATUS_FILTERS.map((option) => ({
  id: `view-status-${option.value}`,
  group: "View" as const,
  label: (ctx: PaletteCommandCtx) => {
    const current = ctx.settings?.visibleStatuses ?? ["open"];
    return `${current.includes(option.value) ? "Hide" : "Show"} ${option.label}`;
  },
  disabled: (ctx: PaletteCommandCtx) => {
    const current = ctx.settings?.visibleStatuses ?? ["open"];
    return current.includes(option.value) && current.length <= 1;
  },
  run: (ctx: PaletteCommandCtx) => {
    const current = ctx.settings?.visibleStatuses ?? ["open"];
    const on = current.includes(option.value);
    // Turning one off keeps the rest; turning one on restores it into the
    // fixed STATUS_FILTERS order rather than appending, so the setting's
    // array order never depends on click order.
    const next = on
      ? current.filter((s) => s !== option.value)
      : STATUS_FILTERS.filter((o) => o.value === option.value || current.includes(o.value)).map((o) => o.value);
    if (next.length === 0) return;
    return ctx.setVisibleStatuses(next);
  },
}));

const VIEW_MISC_COMMANDS: PaletteCommand[] = [
  {
    id: "view-toggle-weekends",
    group: "View",
    label: (ctx) => (ctx.settings?.showWeekends === false ? "Show weekends" : "Hide weekends"),
    run: (ctx) => ctx.toggleWeekends(),
  },
  {
    id: "view-toggle-workdays-only",
    group: "View",
    label: (ctx) =>
      ctx.settings?.workdaysOnly ? "Roll over on every day" : "Roll over on workdays only",
    run: (ctx) => ctx.toggleWorkdaysOnly(),
  },
  {
    id: "view-overdrive",
    group: "View",
    label: (ctx) =>
      ctx.overflowCount > 0 ? `Open Overdrive (${ctx.overflowCount})` : "Overdrive — Overflow is empty",
    disabled: (ctx) => ctx.overflowCount === 0,
    run: (ctx) => {
      ctx.openOverdrive();
      ctx.close();
    },
  },
];

/** Every root-menu command, in render order. */
export const ROOT_COMMANDS: PaletteCommand[] = [
  ...CREATE_COMMANDS,
  ...MANAGE_COMMANDS,
  ...VIEW_DAYS_COMMANDS,
  ...VIEW_STATUS_COMMANDS,
  ...VIEW_MISC_COMMANDS,
];

/**
 * `ROOT_COMMANDS` filtered by `when` and bucketed by group, in
 * `COMMAND_GROUPS` order — what the palette (or any future consumer) maps
 * over to render. A group with no visible commands still gets an entry (an
 * empty array), so callers don't need `?? []`.
 */
export function commandsByGroup(ctx: PaletteCommandCtx): Map<PaletteCommandGroup, PaletteCommand[]> {
  const map = new Map<PaletteCommandGroup, PaletteCommand[]>(COMMAND_GROUPS.map((g) => [g, []]));
  for (const command of ROOT_COMMANDS) {
    if (command.when && !command.when(ctx)) continue;
    map.get(command.group)!.push(command);
  }
  return map;
}
