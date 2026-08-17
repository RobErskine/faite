"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { civilDateSchema, type CivilDate, type List, type Tab, type Todo } from "@/lib/schema";
import { LOCAL_OWNER_ID } from "@/lib/store/repositories";
import { mutateSettings } from "@/lib/store/mutate";
import { undoLast } from "@/lib/undo";
import type { Hotkey } from "@/lib/keyboard";

/**
 * Pass B of the `board.tsx` extraction (docs/ARCHITECTURE.md, mobile plan
 * P2) — every local `useState`, plus the handful of callbacks that only ever
 * touch this file's own state and nothing from `useBoardData`/
 * `useBoardActions`.
 *
 * Deliberately NOT self-contained for `guardContext`: `modalOpen` needs to
 * know whether `openTodoId` currently resolves to a real todo
 * (`data.openTodo`), which this file cannot compute — it only owns the id.
 * `computeModalOpen` below is exported as a pure function precisely so the
 * caller (the `Board` shell, which has both this hook's state AND `data`)
 * can combine them without either hook reaching into the other.
 */

/** Every piece of overlay state `computeModalOpen` needs to decide whether a
 * modal currently owns the keyboard. `openTodoExists`, not `openTodoId`: an
 * id that no longer resolves (a virtual recurrence occurrence whose series
 * was just deleted, the case that found this) must not keep hotkeys
 * blocked once the sheet itself has gone blank. */
export interface BoardOverlayState {
  paletteOpen: boolean;
  openTodoExists: boolean;
  infoListId: string | null;
  infoTabId: string | null;
  archivedOpen: boolean;
  settingsOpen: boolean;
  openDay: CivilDate | null;
  /** Overdrive (EI-97). Its own keydown handler needs undo and every other
   * board hotkey held off exactly like every sheet above it. */
  overdriveOpen: boolean;
  /** The keyboard-shortcut help sheet (EI-75). Same as every other sheet: a
   * board hotkey firing behind it would edit the board out of sight. */
  helpSheetOpen: boolean;
}

/**
 * Whether a modal currently owns the keyboard — see `GuardContext` in
 * `lib/keyboard.ts`. Every field independently drives this true; the guard
 * test in `board-guards.test.ts` asserts exactly that, so a new overlay
 * added to `BoardOverlayState` without being wired in here fails a test
 * instead of silently disabling undo (docs/KEYBOARD.md's documented
 * footgun).
 */
export function computeModalOpen(state: BoardOverlayState): boolean {
  return (
    state.paletteOpen ||
    state.openTodoExists ||
    !!state.infoListId ||
    !!state.infoTabId ||
    state.archivedOpen ||
    state.settingsOpen ||
    // The day sheet holds a rich-text editor, so board hotkeys — undo
    // especially — must not fire while someone is typing a journal entry.
    !!state.openDay ||
    state.overdriveOpen ||
    state.helpSheetOpen
  );
}

const TODO_PARAM = "todo";
const DAY_PARAM = "day";

/**
 * Reads `?todo=<id>` / `?day=<date>` off the current URL — the deep-link
 * half of EI-149. Follows `readLayoutOverride`'s convention in
 * `use-viewport.ts`: read straight off `window.location.search`, not
 * through Next's router, since `/board` is a single client-only route
 * (`ssr:false`) with no server render to reconcile against.
 *
 * `day` is validated against `civilDateSchema` so a malformed value
 * degrades to "no day" rather than reaching `setOpenDay` with garbage.
 * `todo` is deliberately NOT validated against anything here — whether it
 * names a real todo is `data.openTodo`'s job (`board.tsx`), and
 * `computeModalOpen` already treats an id that doesn't resolve as closed
 * (`openTodoExists`). Setting `openTodoId` to a dead id via this path is
 * exactly as safe as any other caller of `setOpenTodoId` doing the same.
 *
 * Mutually exclusive by convention, matching `board.tsx`'s day-sheet-to-
 * todo-sheet handoff (which always closes the day sheet before opening a
 * todo): a `todo` param wins over a `day` param if a URL somehow carries
 * both.
 */
function readDeepLinkParams(): { todoId: string | null; day: CivilDate | null } {
  if (typeof window === "undefined") return { todoId: null, day: null };
  const params = new URLSearchParams(window.location.search);
  const todoId = params.get(TODO_PARAM);
  if (todoId) return { todoId, day: null };
  const rawDay = params.get(DAY_PARAM);
  const day = rawDay && civilDateSchema.safeParse(rawDay).success ? rawDay : null;
  return { todoId: null, day };
}

/**
 * Mirrors `openTodoId`/`openDay` back onto the URL — `history.replaceState`
 * only, never `pushState`, so opening a sheet never adds a back-button stop
 * (every card click would otherwise pollute history). Every other query
 * param (`?layout=`, etc.) passes through untouched. A no-op write (the URL
 * already matches) skips the `replaceState` call entirely, since it's
 * called on every render where either input changed, including the initial
 * one where the URL is often already correct (it's where the values came
 * from in the first place).
 */
function writeDeepLinkParams(todoId: string | null, day: CivilDate | null): void {
  const params = new URLSearchParams(window.location.search);
  params.delete(TODO_PARAM);
  params.delete(DAY_PARAM);
  if (todoId) params.set(TODO_PARAM, todoId);
  else if (day) params.set(DAY_PARAM, day);
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) {
    window.history.replaceState(window.history.state, "", next);
  }
}

export function useBoardUiState() {
  const [activeTodo, setActiveTodo] = useState<Todo | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  /** Lazy initializer, not an effect: reading `?todo=`/`?day=` (EI-149) here
   * means the very first render already reflects the URL, with no flash of
   * a closed sheet followed by it snapping open. See `readDeepLinkParams`. */
  const [openTodoId, setOpenTodoId] = useState<string | null>(
    () => readDeepLinkParams().todoId,
  );
  /**
   * The day whose timeline the open todo sheet was reached from, if any —
   * powers the sheet's "Back to Aug 11" affordance. Null for every other way
   * of opening a todo (a board card, the palette, Overflow), which is what
   * keeps a stale origin from following the sheet there.
   */
  const [todoOriginDay, setTodoOriginDay] = useState<CivilDate | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** The list whose settings dialog is open, if any. */
  const [infoListId, setInfoListId] = useState<string | null>(null);
  /** The tab whose settings dialog is open, if any. */
  const [infoTabId, setInfoTabId] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** The day whose details sheet is open, if any. Same lazy-initializer
   * reasoning as `openTodoId` above — see `readDeepLinkParams`. */
  const [openDay, setOpenDay] = useState<CivilDate | null>(() => readDeepLinkParams().day);
  /** Overdrive (EI-97). */
  const [overdriveOpen, setOverdriveOpen] = useState(false);
  /** The keyboard-shortcut help sheet (EI-75), opened by `?`. */
  const [helpSheetOpen, setHelpSheetOpen] = useState(false);

  /**
   * Which page the phone shell's bottom bar shows (`phone-board.tsx`, P3).
   *
   * Deliberately plain React state, NOT `settings.splitCollapsed` — the
   * mobile plan's original sketch called for reusing that enum ("no new
   * schema"), but `splitCollapsed` is in `SETTINGS_SYNCED_FIELDS`
   * (lib/sync/wire.ts): writing it from a phone-only control would sync a
   * phone session's Days/Lists choice into a desktop session's split state
   * on next pull, silently collapsing a desktop half nobody asked to
   * collapse there. That's precisely the failure mode Decision 1 in
   * docs/MOBILE.md warns about, just via a shared field rather than a
   * missing read-time guard. Resets to "days" on reload — a real UX rough
   * edge, but a far smaller one than corrupting another device's layout.
   */
  const [phoneView, setPhoneView] = useState<"days" | "lists">("days");

  const selectTab = useCallback((tabId: string) => {
    void mutateSettings(LOCAL_OWNER_ID, { activeTabId: tabId });
  }, []);

  /**
   * The todo currently in flight from the cursor to its new slot.
   *
   * One id covers two different DOM nodes. Between release and the write
   * landing, it hides the *source* row — `isDragging` has already cleared, so
   * without this the ghost row would flick back to full opacity and then
   * vanish. After the write it hides the *destination* row, which now exists
   * but must not appear until the flying overlay has arrived. Rendering it at
   * zero opacity rather than removing it keeps column heights settled.
   */
  const [landingTodoId, setLandingTodoId] = useState<string | null>(null);
  const landingRectRef = useRef<DOMRect | null>(null);

  /** The list column being dragged to reorder, if any. Never set with `activeTodo`. */
  const [activeList, setActiveList] = useState<List | null>(null);

  /** The tab being dragged to reorder. The third mutually exclusive drag. */
  const [activeTab, setActiveTab] = useState<Tab | null>(null);

  const handleUndo = useCallback(async () => {
    // A card may still be flying to the slot it was just dropped in. Clearing
    // this reveals it in its restored position immediately, rather than
    // leaving it at zero opacity until the landing backstop times out.
    setLandingTodoId(null);
    const entry = await undoLast();
    if (entry) toast.success("Undone", { description: entry.label, duration: 2500 });
  }, []);

  /**
   * The board's global shortcuts. See docs/KEYBOARD.md.
   *
   * Declared as data so the same table can drive the help sheet and the
   * palette's chord hints. Guards default to OFF, so each entry states exactly
   * where it is allowed to fire.
   */
  const hotkeys = useMemo<Hotkey[]>(
    () => [
      {
        id: "command-palette",
        combo: "mod+k",
        label: "Open the command palette",
        group: "Navigation",
        // Exempt from every guard: the palette is how you get *out* of a
        // dead end, so it has to work from wherever the user currently is —
        // including while it is already open, where it toggles closed.
        allowDuringDrag: true,
        allowInTextEntry: true,
        allowWhenModalOpen: true,
        run: () => setPaletteOpen((o) => !o),
      },
      {
        id: "undo",
        combo: "mod+z",
        label: "Undo the last action",
        group: "Board",
        // No opt-ins, deliberately. Native text undo wins inside a field;
        // mid-drag dnd-kit's board snapshot would go stale; and behind a
        // modal an undo would rewrite the board out of sight. The sheet also
        // holds title/description as local drafts a store write cannot reach.
        run: () => void handleUndo(),
      },
      {
        id: "help-sheet",
        combo: "shift+slash",
        label: "Show keyboard shortcuts",
        group: "Navigation",
        // Same "no opt-ins" reasoning as undo: dead in text fields (where
        // "?" must still type a literal question mark), mid-drag, and
        // behind another modal (the help sheet doesn't stack on top of one).
        run: () => setHelpSheetOpen((o) => !o),
      },
    ],
    [handleUndo],
  );

  /**
   * List keys whose day-column groups are collapsed, across the WHOLE calendar
   * half rather than per day.
   *
   * Day columns are transient — 30 rendered, a 365 cap, and the track scrolls —
   * so per-(day, list) state would be hundreds of entries needing garbage
   * collection as `today` advances. "Collapse To Buy" also reads as being about
   * the list rather than about Tuesday. Each header still shows its own column's
   * count, so one flag reads correctly everywhere.
   *
   * Not persisted yet: this resets on reload. Making it stick is a settings field
   * and a schema migration, deliberately staged after the feature.
   */
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  /**
   * Weekend strips the user has opened, by `weekendColumnId`.
   *
   * Unpersisted, like `collapsedGroups` above and for the same reason — and
   * additionally because opening one is a peek, not a preference: the setting
   * that survives a reload is `showWeekends`, and a strip that stayed open
   * would quietly make that setting a lie.
   *
   * Nothing ever REMOVES an id here, including on drag end. A column vanishing
   * from under a card the moment you release it is indistinguishable from the
   * drop having gone somewhere unexpected; re-collapsing is the strip's own
   * job, via the toggle.
   */
  const [expandedWeekends, setExpandedWeekends] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const expandWeekend = useCallback((id: string) => {
    setExpandedWeekends((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  /**
   * In-column filter text, by droppable column id (`list:<id>`, `day:<id>`,
   * `day:overflow`). Unpersisted, like `collapsedGroups` above — a filter
   * surviving reload would hide cards with no visible cause.
   */
  const [columnFilters, setColumnFilters] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );

  const setColumnFilter = useCallback((columnId: string, query: string) => {
    setColumnFilters((prev) => {
      if ((prev.get(columnId) ?? "") === query) return prev;
      const next = new Map(prev);
      if (query) next.set(columnId, query);
      else next.delete(columnId);
      return next;
    });
  }, []);

  /**
   * How many day columns to render — see `useBoardData`'s `renderedDays` for
   * the full derivation. `horizon` grows on scroll (`loadMoreDays`) and
   * `cap` is the ceiling the date picker can raise (see `onExtend` in
   * `board.tsx`'s `useDayTrack` wiring).
   */
  const [horizon, setHorizon] = useState(DEFAULT_RENDERED_DAYS);
  const [cap, setCap] = useState(DEFAULT_DAY_CAP);
  const loadMoreDays = useCallback(
    () => setHorizon((h) => Math.min(cap, h + LOAD_MORE_STEP)),
    [cap],
  );

  /**
   * The single door into the todo sheet. `originDay` is set ONLY by the day
   * sheet's timeline — every other opener (a board card, the palette,
   * Overflow) passes none, so the sheet shows no "Back to ..." affordance for
   * them.
   */
  const openTodoSheet = useCallback((id: string, originDay: CivilDate | null = null) => {
    setOpenTodoId(id);
    setTodoOriginDay(originDay);
  }, []);

  const closeTodoSheet = useCallback(() => {
    setOpenTodoId(null);
    setTodoOriginDay(null);
  }, []);

  /** Return to the day the open todo was reached from, closing the todo sheet. */
  const handleBackToDay = useCallback(() => {
    setOpenTodoId(null);
    setOpenDay(todoOriginDay);
    setTodoOriginDay(null);
  }, [todoOriginDay]);

  /**
   * `?todo=`/`?day=` deep links (EI-149), write direction. The initial read
   * happens in the `openTodoId`/`openDay` lazy initializers above; this
   * effect keeps the URL in sync as either changes thereafter — every sheet
   * open (a board card, the palette, a `faite://` link once the desktop
   * shell wires one up) and every close, via `replaceState` only (see
   * `writeDeepLinkParams` for why never `pushState`). Platform-agnostic
   * deliberately: this reads/writes `window.location` and nothing
   * Tauri-specific, so it behaves identically on myfaite.app and inside the
   * desktop shell's webview.
   */
  useEffect(() => {
    writeDeepLinkParams(openTodoId, openDay);
  }, [openTodoId, openDay]);

  /**
   * Back/forward support for the same deep links. `popstate` only fires for
   * history entries that already existed before this hook's own
   * `replaceState` calls above (which never create a new entry), so this
   * exclusively covers the user's browser back/forward buttons and anything
   * else that lands the app on a URL with different `?todo=`/`?day=`
   * params — never something the write-direction effect above just did.
   * Reads the URL fresh rather than trusting event details, matching
   * `readDeepLinkParams`'s single source of truth.
   */
  useEffect(() => {
    function onPopState() {
      const { todoId, day } = readDeepLinkParams();
      setOpenTodoId(todoId);
      setTodoOriginDay(null);
      setOpenDay(day);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return {
    activeTodo,
    setActiveTodo,
    overId,
    setOverId,
    openTodoId,
    setOpenTodoId,
    todoOriginDay,
    setTodoOriginDay,
    paletteOpen,
    setPaletteOpen,
    infoListId,
    setInfoListId,
    infoTabId,
    setInfoTabId,
    archivedOpen,
    setArchivedOpen,
    settingsOpen,
    setSettingsOpen,
    openDay,
    setOpenDay,
    overdriveOpen,
    setOverdriveOpen,
    helpSheetOpen,
    setHelpSheetOpen,
    phoneView,
    setPhoneView,
    landingTodoId,
    setLandingTodoId,
    landingRectRef,
    activeList,
    setActiveList,
    activeTab,
    setActiveTab,
    collapsedGroups,
    toggleGroup,
    expandedWeekends,
    expandWeekend,
    columnFilters,
    setColumnFilter,
    horizon,
    setHorizon,
    cap,
    setCap,
    loadMoreDays,
    openTodoSheet,
    closeTodoSheet,
    handleBackToDay,
    selectTab,
    hotkeys,
    // The other half of `GuardContext` — `modalOpen` needs `data.openTodo`
    // (see `computeModalOpen` above), but `dragging` only ever needs this
    // hook's own state, so it's computed here rather than left to the shell.
    dragging: !!activeTodo || !!activeList || !!activeTab,
  };
}

/**
 * How many days the calendar half renders on first load, before any scroll,
 * jump, or far-out scheduling. Wider than a screenful on purpose — the whole
 * point is that a track with nothing to scroll to reads as "this is all the
 * days there are," not as an invitation to scroll right.
 */
const DEFAULT_RENDERED_DAYS = 30;
/** How many more days each click of the "Load more" tile adds. */
const LOAD_MORE_STEP = 30;
/**
 * Starting ceiling on rendered day columns — about a year out. Bounds normal
 * scrolling and the Week/Month/Quarter buttons so the board does not
 * materialize an unbounded number of columns just from browsing forward;
 * dnd-kit re-measures every droppable on every drag move
 * (`MeasuringStrategy.Always` in `use-board-actions.ts`), so this is also
 * the ceiling on how many columns a single drag ever has to re-measure.
 *
 * NOT a hard limit, though: the date picker has no upper bound (a reminder a
 * year and a half out should be reachable directly), so picking a day past
 * this constant grows it to match — see `cap` state above.
 */
const DEFAULT_DAY_CAP = 365;

export type BoardUiState = ReturnType<typeof useBoardUiState>;
