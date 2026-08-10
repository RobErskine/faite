"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DropAnimationFunctionArguments,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { GripVertical, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { List, Tab, Todo } from "@/lib/schema";
import {
  buildBoard,
  parseColumnId,
  parseDayGroupId,
  parseListDragId,
  parseTabDragId,
  parseTabDropId,
  parseWeekendColumnId,
  planListDrop,
  planTabDrop,
  preferPreciseTarget,
  type TodoGroup,
} from "@/lib/board";
import {
  FLIGHT_MS,
  LIFTED,
  readLandingRect,
  runLandingDropAnimation,
} from "@/lib/drop-animation";
import { tint } from "@/lib/colors";
import { priorityRail } from "@/lib/priority";
import {
  NAV_LOAD_MORE,
  buildNavGrid,
  cardItems,
  navKeyOf,
  type NavGrid,
  type NavItem,
} from "@/lib/column-nav";
import { positionForIndex } from "@/lib/ordering";
import { OVERFLOW, daysBetween, formatDay, todayIn } from "@/lib/scheduling";
import {
  calendarSpanFor,
  groupWeekendRuns,
  weekendDaysFrom,
  type TrackSlot,
} from "./weekend-runs";
import { WeekendColumn } from "./weekend-column";
import { FONT_STORAGE_KEY } from "@/lib/fonts";
import {
  DARK_CLASS,
  PREFERS_DARK,
  THEME_STORAGE_KEY,
  normalizeTheme,
  resolveTheme,
} from "@/lib/theme";
import {
  useArchivedLists,
  useArchivedTabs,
  useBootstrap,
  useLabels,
  useLists,
  usePlacementContext,
  useProjects,
  useSettings,
  useTabs,
  useTodos,
} from "@/lib/store/hooks";
import {
  DEFAULT_TAB_ID,
  LOCAL_OWNER_ID,
  createTodo,
  deleteTodo,
  dayGroupPatch,
  listPatch,
  moveTodoToDayGroup,
  moveTodoToList,
  schedulePatch,
  scheduleTodo,
  setTodoStatus,
  statusPatch,
  toggleTodoLabel,
  updateList,
  updateTab,
  updateTodo,
} from "@/lib/store/repositories";
import { mutateSettings } from "@/lib/store/mutate";
import {
  createUndoStep,
  inversePatch,
  pushUndo,
  undoById,
  undoLast,
} from "@/lib/undo";
import type { GuardContext, Hotkey } from "@/lib/keyboard";
import { Hotkeys } from "@/components/hotkeys";
import { AppHeader } from "./app-header";
import { SessionProvider } from "@/components/auth/session-provider";
import { SyncProvider } from "@/components/sync/sync-provider";
import { SignedOutBanner } from "@/components/auth/signed-out-banner";
import { WelcomeDialog } from "@/components/auth/welcome-dialog";
import { SettingsSheet } from "@/components/settings/settings-sheet";
import { ArchivedListsSheet } from "./archived-lists-sheet";
import { BoardColumn } from "./board-column";
import { CreateListColumn } from "./create-list-column";
import { DateNav } from "./date-nav";
import { ListInfoDialog, type ListPatch } from "./list-info-dialog";
import { RailCollapseButton } from "./rail-collapse-button";
import { RailHandle } from "./rail-handle";
import {
  archiveListWithUndo,
  deleteListWithUndo,
  updateListWithUndo,
  restoreListWithUndo,
} from "./list-actions";
import { TabInfoDialog, type TabPatch } from "./tab-info-dialog";
import { TabStrip } from "./tab-strip";
import {
  archiveTabWithUndo,
  createTabWithUndo,
  deleteTabWithUndo,
  restoreTabWithUndo,
  updateTabWithUndo,
} from "./tab-actions";
import { TodoSheet } from "./todo-sheet";
import { CommandPalette } from "./command-palette";
import { useColumnNav } from "./use-column-nav";
import { useDayTrack } from "./use-day-track";

/**
 * How long a card must hover a tab before it focuses.
 *
 * Long enough that sweeping across the strip on the way somewhere else does
 * not cycle through every tab, short enough that it does not feel stuck. The
 * gesture is only discoverable once it fires, so erring long would hide it.
 */
const TAB_FOCUS_DWELL_MS = 600;

/**
 * How long a card must hover a collapsed weekend strip before it opens.
 *
 * Deliberately the same number as the tab dwell above, and for the same
 * reason: both are "hovering here reveals somewhere else to drop", and two
 * different delays for one idea would teach the hand two timings.
 */
const WEEKEND_EXPAND_DWELL_MS = TAB_FOCUS_DWELL_MS;

/** `settingsSchema.workdays`' default, for reads that land before Dexie does. */
const DEFAULT_WORKDAYS = [1, 2, 3, 4, 5];

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
 * (`MeasuringStrategy.Always` below), so this is also the ceiling on how many
 * columns a single drag ever has to re-measure.
 *
 * NOT a hard limit, though: the date picker has no upper bound (a reminder a
 * year and a half out should be reachable directly), so picking a day past
 * this constant grows it to match — see `cap` state below.
 */
const DEFAULT_DAY_CAP = 365;

/**
 * Wraps Overflow and Backlog: the one place a column gets its own opaque
 * surface rather than the shared transparent-column-over-tinted-half look.
 * Both are pinned fixed-width siblings of a scrolling track (`pinned` on
 * BoardColumn) — the border + shadow are what make that pinning *read*,
 * rather than just behave.
 *
 * `bg-card` over `bg-background`: identical to the page background in light
 * mode, but lighter than it in dark mode (see globals.css), so "raised" holds
 * in both themes without a variant. `--column-min` is scoped here rather than
 * left to inherit, so Overflow (calendar half) and Backlog (planning half)
 * land at the same width even though their halves set different floors for
 * everything else inside them.
 */
const PINNED_PANEL = cn(
  "relative z-10 flex shrink-0 flex-col bg-card px-4",
  "border-r border-border shadow-[2px_0_6px_-2px_rgb(0_0_0/0.08)]",
  "[--column-min:var(--list-column-min)]",
);

/**
 * Resolve the drop target from the POINTER, not the dragged element's box.
 *
 * closestCorners measures the dragged rect's corners against each droppable's
 * corners. The drag overlay is far wider than a column gutter, so when it
 * straddles a boundary its corners can be equidistant from two columns and the
 * winner flip-flops — or resolves to a column the cursor was never over. The
 * item then appears to hover between two zones, droppable in neither.
 *
 * pointerWithin asks the only question that matches the user's intent: what is
 * under the cursor? Columns fill their half's full height, so any point inside
 * one resolves to it.
 *
 * closestCorners stays as the fallback for two cases where there is no pointer
 * to consult: the few pixels of container padding that belong to no column,
 * and keyboard drags, which have no pointer coordinates at all. Without the
 * fallback, dragging with the keyboard would find no target whatsoever.
 */
const collisionDetection: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args);
  const collisions = underPointer.length > 0 ? underPointer : closestCorners(args);

  /**
   * A column drag wants the opposite answer to a card drag. The pointer is
   * inside a column *and* the cards within it, and for reordering columns the
   * cards are noise — only the column is a meaningful reference point.
   */
  if (parseListDragId(String(args.active.id))) {
    const column = collisions.find((c) => parseColumnId(String(c.id))?.kind === "list");
    return column ? [column] : [];
  }

  /**
   * A tab drag only ever means something over another tab. Filtering to the
   * strip is what keeps dragging a tab down across the columns a no-op instead
   * of resolving to whichever column happens to be under the pointer.
   */
  if (parseTabDragId(String(args.active.id))) {
    const pill = collisions.find((c) => parseTabDropId(String(c.id)));
    return pill ? [pill] : [];
  }

  const target = preferPreciseTarget(collisions);
  return target ? [target] : collisions;
};

export function Board() {
  const ready = useBootstrap();
  const todos = useTodos();
  const lists = useLists();
  const archivedLists = useArchivedLists();
  const tabs = useTabs();
  const archivedTabs = useArchivedTabs();
  const labels = useLabels();
  const projects = useProjects();
  const settings = useSettings();

  const [activeTodo, setActiveTodo] = useState<Todo | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [openTodoId, setOpenTodoId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** The list whose settings dialog is open, if any. */
  const [infoListId, setInfoListId] = useState<string | null>(null);
  /** The tab whose settings dialog is open, if any. */
  const [infoTabId, setInfoTabId] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  /**
   * Which tab the planning half is showing.
   *
   * Resolved against the live tabs rather than trusted from settings, so a
   * stored id that has since been archived or deleted falls back instead of
   * rendering an empty track. That fallback is also why nothing has to write
   * settings when a tab goes away.
   */
  const activeTabId = useMemo(() => {
    const stored = tabs.find((t) => t.id === settings?.activeTabId);
    if (stored) return stored.id;
    return tabs.find((t) => t.isDefault)?.id ?? tabs[0]?.id ?? DEFAULT_TAB_ID;
  }, [tabs, settings?.activeTabId]);

  const activeTabRecord = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [tabs, activeTabId],
  );

  const selectTab = useCallback((tabId: string) => {
    void mutateSettings(LOCAL_OWNER_ID, { activeTabId: tabId });
  }, []);

  /**
   * The open todo is DERIVED, never snapshotted.
   *
   * Holding the Todo object in state let the sheet drift from the store: an
   * edit made in the sheet, or an undo applied to it, left the fields showing
   * the values as of the moment it opened. Worse for undo — an entry built
   * from a stale object reverses stale values, so toggling two labels and
   * pressing ⌘Z once would strip both.
   */
  const openTodo = useMemo(
    () => todos.find((t) => t.id === openTodoId) ?? null,
    [todos, openTodoId],
  );

  /** Derived for the same reason as `openTodo` — a snapshot would go stale. */
  const infoList = useMemo(
    () => lists.find((l) => l.id === infoListId) ?? null,
    [lists, infoListId],
  );

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

  /**
   * The dragged to-do's priority rail, mirrored onto the overlay chip.
   *
   * The chip is hand-built rather than a rendered `TodoCard` (§4.7), so anything
   * the card shows has to be repeated here by hand or the lifted item stops
   * looking like the row it came from.
   */
  const activeRail = priorityRail(activeTodo?.priority ?? null);

  /** Derived for the same reason as `openTodo` — a snapshot would go stale. */
  const infoTab = useMemo(
    () => tabs.find((t) => t.id === infoTabId) ?? null,
    [tabs, infoTabId],
  );

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
    ],
    [handleUndo],
  );

  const guardContext = useMemo<GuardContext>(
    () => ({
      dragging: !!activeTodo || !!activeList || !!activeTab,
      modalOpen:
        paletteOpen ||
        !!openTodoId ||
        !!infoListId ||
        !!infoTabId ||
        archivedOpen ||
        settingsOpen,
    }),
    [
      activeTodo,
      activeList,
      activeTab,
      paletteOpen,
      openTodoId,
      infoListId,
      infoTabId,
      archivedOpen,
      settingsOpen,
    ],
  );

  /**
   * Push the stored font pairing onto <html>, and mirror it to localStorage.
   *
   * The mirror is what lets the inline script in the root layout apply the
   * pairing before first paint — IndexedDB is async, so without it every load
   * would flash the default pairing before settling.
   */
  useEffect(() => {
    const pairing = settings?.fontPairing;
    if (!pairing) return;
    document.documentElement.dataset.font = pairing;
    try {
      localStorage.setItem(FONT_STORAGE_KEY, pairing);
    } catch {
      // Private modes can refuse writes. Costs a flash next load, nothing more.
    }
  }, [settings?.fontPairing]);

  /**
   * Push the stored appearance onto <html>, mirror it to localStorage, and —
   * in "system" — keep listening.
   *
   * The mirror is what lets the inline script in the root layout resolve the
   * theme before first paint, exactly as it does for the font pairing.
   *
   * The extra job here is that "system" is a SUBSCRIPTION, not a value: the OS
   * can flip while the app is open (macOS auto-appearance does it at dusk),
   * and without the listener the board would sit in yesterday's palette until
   * reload. The listener is only attached in "system" — an explicit Light or
   * Dark is not something the OS gets a vote on.
   */
  const themeMode = settings ? normalizeTheme(settings.theme) : null;

  useEffect(() => {
    // Null until the store has been read. Applying the default here would
    // stomp whatever the pre-paint script correctly resolved, for one tick.
    if (!themeMode) return;

    try {
      localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    } catch {
      // Private modes can refuse writes. Costs a flash next load, nothing more.
    }

    const media = window.matchMedia(PREFERS_DARK);
    const apply = () =>
      document.documentElement.classList.toggle(
        DARK_CLASS,
        resolveTheme(themeMode, media.matches) === "dark",
      );

    apply();
    if (themeMode !== "system") return;

    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [themeMode]);

  const sensors = useSensors(
    /*
      MouseSensor rather than PointerSensor, and the split is load bearing.

      PointerSensor claims touch too, and `pointerdown` fires before
      `touchstart` — so it activates first, `activeRef` is then non-null, and
      dnd-kit's activator binding bails out of every later sensor. A TouchSensor
      added *alongside* a PointerSensor is unreachable code. Splitting them is
      the only way touch gets an activation rule of its own.

      4px keeps a mouse click distinguishable from a drag. Since the whole row
      is a drag surface (DRAG-AND-DROP §4.9), that threshold is what separates a
      click on a checkbox or a title from a lift.
    */
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    /*
      Long-press to lift on touch. Under 250ms, or a move of more than 8px
      inside it, the browser keeps the gesture and the column scrolls exactly as
      before — which is why nothing needs `touch-action: none` any more.
      TouchSensor.setup registers a non-passive `touchmove` so the sensor can
      preventDefault scrolling once it *does* activate; that listener is what
      the grip's `touch-none` used to stand in for, and it applies to the whole
      row rather than to one 12px control.
    */
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /**
   * To-dos belonging to an archived list are off the board entirely.
   *
   * Filtering has to happen HERE rather than inside buildBoard, because
   * buildBoard's "unknown list falls back to Backlog" rule (lib/board.ts) is
   * what makes a *deleted* list's orphans survive. Archived lists are absent
   * from `lists` for exactly the same reason, so without this their to-dos
   * would silently pile into Backlog — the one outcome archiving promises not
   * to produce.
   */
  const archivedListIds = useMemo(
    () => new Set(archivedLists.map((l) => l.id)),
    [archivedLists],
  );

  const visibleTodos = useMemo(
    () => todos.filter((t) => !(t.listId && archivedListIds.has(t.listId))),
    [todos, archivedListIds],
  );

  /**
   * How many day columns to render: always at least `DEFAULT_RENDERED_DAYS`,
   * always enough to hold the furthest-out scheduled todo — growing the
   * window as a SIDE EFFECT of scrolling would silently drain cards out of
   * their lists as the user looked further ahead, with no way back — and
   * always at least `settings.visibleDays` (the ⌘K toggle's floor). All three
   * are clamped to `cap`, past which `deriveColumn` in scheduling.ts falls
   * back to showing the todo dimmed in its list — the load-more tile at the
   * end of the day track is how the user reaches it from there.
   */
  const todayCivil = useMemo(
    () => (settings ? todayIn(settings.timezone) : null),
    [settings],
  );
  const furthestScheduledOffset = useMemo(() => {
    if (!todayCivil) return 0;
    let furthest: string | null = null;
    for (const t of visibleTodos) {
      if (t.status === "open" && t.scheduledDate && (!furthest || t.scheduledDate > furthest)) {
        furthest = t.scheduledDate;
      }
    }
    return furthest ? daysBetween(todayCivil, furthest) + 1 : 0;
  }, [visibleTodos, todayCivil]);

  /**
   * Which weekday numbers the weekend strip collapses, and how long a window
   * has to be to show `visibleDays` real columns.
   *
   * `visibleDays` counts COLUMNS YOU CAN SEE, not calendar days (see its
   * comment in lib/schema.ts). With weekends collapsed a strip is not a
   * column, so asking for 5 on a Friday needs a seven-day window: Fri, the
   * strip, then Mon–Thu. Weekend days stay IN that window — the strip hides
   * them from the eye, never from `buildBoard`, which is what keeps a
   * Saturday-scheduled todo on Saturday instead of exiling it to its list.
   */
  const weekendDays = useMemo(
    () => weekendDaysFrom(settings?.workdays ?? DEFAULT_WORKDAYS),
    [settings?.workdays],
  );
  const collapsingWeekends = settings?.showWeekends === false;
  const minDays = useMemo(() => {
    const wanted = settings?.visibleDays ?? 7;
    if (!collapsingWeekends || !todayCivil) return wanted;
    return calendarSpanFor(todayCivil, wanted, weekendDays);
  }, [settings?.visibleDays, collapsingWeekends, todayCivil, weekendDays]);

  const [horizon, setHorizon] = useState(DEFAULT_RENDERED_DAYS);
  /**
   * The rendering ceiling. Starts at `DEFAULT_DAY_CAP` and only ever grows —
   * normal scrolling and the load-more tile stay within it, but the date
   * picker in `date-nav.tsx` has no upper bound of its own: picking a day
   * past this raises it to match (see `onExtend` below), rather than the
   * picker refusing dates a deliberate "remind me in 18 months" pick needs.
   * Never reset by the ⌘K toggle — an explicitly unlocked longer horizon
   * should survive a temporary "show fewer days" collapse, not be forgotten.
   */
  const [cap, setCap] = useState(DEFAULT_DAY_CAP);
  const loadMoreDays = useCallback(
    () => setHorizon((h) => Math.min(cap, h + LOAD_MORE_STEP)),
    [cap],
  );

  /**
   * Collapses `horizon` back to exactly the ⌘K toggle's new value whenever
   * the user explicitly changes it — the toggle's original "show only N
   * days" meaning, preserved from before scrolling existed.
   *
   * Skips the FIRST time `settings.visibleDays` becomes defined: that
   * transition is Dexie's initial load resolving, not a user action, and
   * firing on it would collapse the default 30-day view down to 7 before
   * the user ever touched anything.
   *
   * Keyed on `visibleDays` and NOT on `minDays`, even though it now sets the
   * latter. Toggling weekends off changes the span (5 columns need 7 days on
   * a Friday) but is not a request to collapse a 30-day track back down to a
   * week — and `renderedDays` below already takes the max, so the window
   * grows to fit the new span on its own without this effect touching it.
   */
  const prevVisibleDaysRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (settings?.visibleDays === undefined) return;
    const prev = prevVisibleDaysRef.current;
    prevVisibleDaysRef.current = settings.visibleDays;
    if (prev === undefined) return; // Dexie's initial load, not a user action.
    if (settings.visibleDays !== prev) setHorizon(minDays);
    // `minDays` is read, not tracked: it is derived from the very value this
    // effect watches, and listing it would re-fire the collapse on a weekend
    // toggle — exactly what the note above says must not happen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.visibleDays]);

  const renderedDays = todayCivil
    ? Math.min(cap, Math.max(minDays, horizon, furthestScheduledOffset))
    : minDays;

  const ctx = usePlacementContext(settings, renderedDays);

  /** The day track's scroll container, threaded into `useDayTrack` below. */
  const dayTrackRef = useRef<HTMLDivElement>(null);

  /**
   * The two pinned panels, resized independently — see `PINNED_PANEL` and
   * `RailHandle` below. Read with a `null` fallback rather than a numeric
   * default so the CSS default (`--list-column-min`) stays the single source
   * of what "not yet resized" looks like.
   */
  const overflowPanelRef = useRef<HTMLDivElement>(null);
  const backlogPanelRef = useRef<HTMLDivElement>(null);
  const overflowWidth = settings?.overflowWidth ?? null;
  const overflowCollapsed = settings?.overflowCollapsed ?? false;
  const backlogWidth = settings?.backlogWidth ?? null;
  const backlogCollapsed = settings?.backlogCollapsed ?? false;
  // Resizing mid-drag would invalidate every droppable rect dnd-kit cached at
  // drag start (§4.2 of DRAG-AND-DROP.md) — same reasoning as `rejectsDrop`.
  const railDisabled = !!activeTodo || !!activeList;

  const {
    anchorIndex,
    visibleCount,
    canJumpBack,
    canJumpForward,
    jumpBy,
    jumpToIndex,
    jumpToToday,
  } = useDayTrack({
    trackRef: dayTrackRef,
    cap,
    /**
     * `jumpToIndex` (wired to the date picker) calls this with targets past
     * `cap` on purpose — see the comment on `cap` above. Growing both here,
     * together, is what makes an 18-months-out pick actually reachable
     * instead of silently clamped back to a year.
     */
    onExtend: (days) => {
      setCap((c) => Math.max(c, days));
      setHorizon((h) => Math.max(h, days));
    },
  });

  /**
   * The planning half's columns: the active tab's lists, plus Backlog.
   *
   * Backlog carries `tabId: null` and rides along with every tab. That is not
   * decoration — buildBoard falls back to "the Backlog column, or the first
   * one" for a todo whose list is gone, so a track without Backlog would start
   * quietly collecting other people's orphans in whatever column sorted first.
   * Keeping it here also means its contents are identical on every tab, which
   * is the point of having one shared inbox.
   */
  const tabLists = useMemo(
    () => lists.filter((l) => l.isBacklog || l.tabId === activeTabId),
    [lists, activeTabId],
  );

  /**
   * Live lists on OTHER tabs.
   *
   * Passed to buildBoard rather than filtered out of `visibleTodos` up here,
   * because tab membership must NOT reach the calendar half: a todo scheduled
   * to Thursday belongs to Thursday no matter which tab is open. Archiving is
   * different — it removes a list from both halves — which is why that filter
   * stays above and this one does not.
   *
   * Records rather than ids, because day columns group by list: a card scheduled
   * from another tab's list still shows on its day, and its group needs that
   * list's name and colour. With ids alone it would group under Backlog — and a
   * drop on that header would then rewrite its `listId`.
   */
  const hiddenLists = useMemo(
    () => lists.filter((l) => !l.isBacklog && l.tabId !== activeTabId),
    [lists, activeTabId],
  );

  const visibleStatuses = settings?.visibleStatuses;
  const board = useMemo(
    () =>
      ctx
        ? buildBoard(visibleTodos, tabLists, ctx, hiddenLists, { visibleStatuses })
        : null,
    [visibleTodos, tabLists, ctx, hiddenLists, visibleStatuses],
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
   * The day track as it is actually laid out: real columns, plus one slot per
   * collapsed weekend run.
   *
   * An EXPANDED run flattens back into ordinary day slots rather than carrying
   * an `expanded` flag, so everything downstream — the render below, the nav
   * grid, the pitch measurement — sees exactly what it sees when weekends are
   * shown, and none of them needs to know this feature exists.
   */
  const trackSlots = useMemo<TrackSlot[]>(() => {
    if (!board) return [];
    if (!collapsingWeekends) {
      return board.days.map((column) => ({ kind: "day" as const, column }));
    }
    return groupWeekendRuns(board.days, weekendDays).flatMap((slot) =>
      slot.kind === "weekend" && expandedWeekends.has(slot.id)
        ? slot.columns.map((column) => ({ kind: "day" as const, column }))
        : [slot],
    );
  }, [board, collapsingWeekends, weekendDays, expandedWeekends]);

  /**
   * Backlog rendered as a pinned sibling of the planning track, split out
   * here rather than in `buildBoard` — `board.lists` keeps carrying every
   * list, in position order, for `planListDrop` and the reorder logic, which
   * never learn a column moved out of the track.
   */
  const backlogColumn = useMemo(
    () => board?.lists.find((c) => c.list.isBacklog) ?? null,
    [board],
  );
  const otherListColumns = useMemo(
    () => board?.lists.filter((c) => !c.list.isBacklog) ?? [],
    [board],
  );

  /**
   * Every place the arrow keys can put focus, as a grid — see
   * `lib/column-nav.ts` and docs/KEYBOARD.md §11.
   *
   * A collapsed rail contributes nothing: its column renders as a 40px strip
   * with no cards and no quick-add, so there is nothing to focus in it.
   *
   * A grouped column's rows are its headers plus the cards under EXPANDED groups,
   * in rendered order. A collapsed group's cards are not in the DOM, so a stop for
   * one would resolve to a `data-nav-stop` that does not exist — `useColumnNav`
   * returns false and the arrow key dies silently mid-column.
   */
  const groupedItems = useCallback(
    (column: { todos: Todo[]; groups: TodoGroup[] }): NavItem[] =>
      column.groups.length > 0
        ? column.groups.flatMap((g) => [
            { kind: "group" as const, id: g.id },
            ...(collapsedGroups.has(g.key) ? [] : cardItems(g.todos.map((t) => t.id))),
          ])
        : cardItems(column.todos.map((t) => t.id)),
    [collapsedGroups],
  );

  const navGrid = useMemo<NavGrid>(
    () =>
      buildNavGrid({
        overflow:
          board && !overflowCollapsed
            ? { id: board.overflow.id, items: groupedItems(board.overflow) }
            : null,
        /*
          Slots, not `board.days`: a collapsed strip is a real thing on screen
          and has to be in the grid, or `→` steps from Friday to Monday past a
          control the user can see and never reaches it. It contributes one
          stop — itself — and no quick-add, since there is no single day it
          would add to.
        */
        days: trackSlots.map((slot) =>
          slot.kind === "day"
            ? { id: slot.column.id, items: groupedItems(slot.column) }
            : { id: slot.id, items: [], strip: true },
        ),
        hasLoadMore: renderedDays < cap,
        backlog:
          backlogColumn && !backlogCollapsed
            ? { id: backlogColumn.id, items: cardItems(backlogColumn.todos.map((t) => t.id)) }
            : null,
        lists: otherListColumns.map((c) => ({
          id: c.id,
          items: cardItems(c.todos.map((t) => t.id)),
        })),
      }),
    [
      board,
      trackSlots,
      overflowCollapsed,
      renderedDays,
      cap,
      backlogColumn,
      backlogCollapsed,
      otherListColumns,
      groupedItems,
    ],
  );

  /**
   * Every day column's id in DAY order, including ones hidden inside a
   * collapsed strip.
   *
   * `useColumnNav` uses `indexOf` on this to decide whether a focus target is
   * off screen and needs a jump, and `jumpToIndex` is day-indexed — so this
   * has to stay the full contiguous list rather than following `trackSlots`,
   * or every jump past a collapsed weekend would land short. A strip's own
   * key is not in here at all; `indexOf` returns -1 and the caller falls
   * through to `scrollIntoView`, which is the right behaviour for something
   * whose position is not a day.
   */
  const dayIds = useMemo(() => board?.days.map((c) => c.id) ?? [], [board]);

  /**
   * How many open to-dos are DUE on each date, keyed by civil date.
   *
   * Built from every visible todo rather than per column, because a deadline is
   * independent of placement (`lib/scheduling.ts`): something due Friday is very
   * often scheduled for Tuesday, and the day column's job here is to warn before
   * Friday arrives. Done and dropped items are excluded — a met deadline is not
   * a warning.
   */
  const deadlineCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const todo of visibleTodos) {
      if (!todo.deadline || todo.status !== "open") continue;
      counts.set(todo.deadline, (counts.get(todo.deadline) ?? 0) + 1);
    }
    return counts;
  }, [visibleTodos]);

  const navigate = useColumnNav({
    grid: navGrid,
    dayIds,
    dragging: !!activeTodo || !!activeList || !!activeTab,
    anchorIndex,
    visibleCount,
    jumpToIndex,
  });

  /**
   * `over` is either a column or a card. Only a card gives us a precise
   * insertion point; a column means "append to the end".
   *
   * The dragged card is excluded so the indicator never renders above the item
   * being moved, which would suggest a no-op drop.
   */
  const overTodoId = useMemo(() => {
    if (!overId || !activeTodo || overId === activeTodo.id) return null;
    if (parseColumnId(overId) || parseDayGroupId(overId)) return null;
    return overId;
  }, [overId, activeTodo]);

  /**
   * The group a release would land in, or null.
   *
   * Two cases, and they have to resolve the SAME WAY the write does, or the drop
   * animation flies the card to an indicator the write will not honour:
   *
   *   over is a group      → that group
   *   over is a day column → the group matching the DRAGGED CARD'S OWN list,
   *                          because that drop keeps the list and only sets the
   *                          date, so the card lands inside that group rather
   *                          than at the end of the column
   *
   * Null when the card's list has no group in that day yet — it is the first from
   * that list to land there, so there is nothing to point at and the column's own
   * end-of-column indicator stands. Honest: the group does not exist yet.
   */
  const overGroupId = useMemo(() => {
    if (!activeTodo || !overId || !board) return null;
    if (parseDayGroupId(overId)) return overId;

    const target = parseColumnId(overId);
    if (target?.kind !== "day") return null;
    const column = board.days.find((d) => d.day === target.day);
    const key = activeTodo.listId ?? backlogColumn?.list.id;
    return column?.groups.find((g) => g.key === key)?.id ?? null;
  }, [activeTodo, overId, board, backlogColumn]);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      // Three gestures share one DndContext. `active.id` is what tells them
      // apart: reorder handles carry the `listdrag:` and `tabdrag:` prefixes,
      // everything else is a card.
      const id = String(event.active.id);

      const tabId = parseTabDragId(id);
      if (tabId) {
        setActiveTab(tabs.find((t) => t.id === tabId) ?? null);
        return;
      }

      const listId = parseListDragId(id);
      if (listId) {
        setActiveList(lists.find((l) => l.id === listId) ?? null);
        return;
      }

      setActiveTodo(todos.find((t) => t.id === event.active.id) ?? null);
    },
    [todos, lists, tabs],
  );

  const handleDragOver = useCallback((event: DragOverEvent) => {
    setOverId(event.over ? String(event.over.id) : null);
  }, []);

  const handleDragCancel = useCallback(() => {
    setActiveTodo(null);
    setActiveList(null);
    setActiveTab(null);
    setOverId(null);
    landingRectRef.current = null;
  }, []);

  /**
   * Hovering a tab with a card in hand focuses that tab.
   *
   * This is what makes moving a to-do to another tab one gesture rather than a
   * drop, a click, and a second drag. The dwell exists because the strip sits
   * between the two halves: without it, dragging a card upward across the bar
   * would flip through every tab it passed over.
   *
   * The timer is keyed on `overId`, so leaving the pill before it fires
   * cancels — React tears down the effect on every change of target.
   */
  useEffect(() => {
    if (!activeTodo || !overId) return;
    const hovered = parseTabDropId(overId);
    if (!hovered || hovered === activeTabId) return;

    const timer = window.setTimeout(() => selectTab(hovered), TAB_FOCUS_DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [activeTodo, overId, activeTabId, selectTab]);

  /**
   * Hovering a collapsed weekend strip with a card in hand opens it.
   *
   * Without this, scheduling something for Saturday while weekends are hidden
   * means dropping the card somewhere, toggling weekends, dragging again, and
   * toggling back. The strip cannot simply accept the drop itself: it spans
   * two days and "the weekend" is not a date, so it reveals the real columns
   * and lets the user say which.
   *
   * Mounting a droppable mid-drag is only safe because `DndContext` measures
   * with `MeasuringStrategy.Always` (see below) — dnd-kit re-measures on every
   * move, so the two day columns that appear here are immediately valid
   * targets for the card already in flight. Same dwell, and the same
   * cancel-on-leave teardown, as the tab effect above.
   */
  useEffect(() => {
    if (!activeTodo || !overId) return;
    if (parseWeekendColumnId(overId) === null) return;
    const timer = window.setTimeout(
      () => expandWeekend(overId),
      WEEKEND_EXPAND_DWELL_MS,
    );
    return () => window.clearTimeout(timer);
  }, [activeTodo, overId, expandWeekend]);

  /**
   * Where the dragged column would land, recomputed as the pointer moves.
   *
   * Derived rather than stored so the indicator and the write cannot disagree:
   * `handleDragEnd` calls the same `planListDrop` with the same inputs.
   */
  const columnDrop = useMemo(() => {
    if (!activeList || !overId) return null;
    const target = parseColumnId(overId);
    if (target?.kind !== "list") return null;
    const plan = planListDrop(lists, activeList.id, target.listId);
    return plan ? { listId: target.listId, side: plan.side } : null;
  }, [activeList, overId, lists]);

  /**
   * The column that should visually read as the drop target.
   *
   * Backlog is pinned leftmost and can never move, so outlining it as "the
   * target" claims something false — there is no "before" for it to receive.
   * Hovering it means "as far left as allowed" (see `planListDrop`), which is
   * exactly what hovering the first movable column already means, so that
   * column takes the border instead. The landing position is unchanged —
   * this only redirects where the border is drawn, not where the drop lands.
   */
  const columnDropTargetId = useMemo(() => {
    if (!columnDrop) return null;
    if (backlogColumn && columnDrop.listId === backlogColumn.list.id) {
      return otherListColumns[0]?.list.id ?? null;
    }
    return columnDrop.listId;
  }, [columnDrop, backlogColumn, otherListColumns]);

  /** Same contract as `columnDrop`, one level up: derived from the same plan. */
  const tabDrop = useMemo(() => {
    if (!activeTab || !overId) return null;
    const overTabId = parseTabDropId(overId);
    if (!overTabId) return null;
    const plan = planTabDrop(tabs, activeTab.id, overTabId);
    return plan ? { tabId: overTabId, side: plan.side } : null;
  }, [activeTab, overId, tabs]);

  const dropAnimation = useCallback((args: DropAnimationFunctionArguments) => {
    // The ref is read here, when dnd-kit invokes the animation — not during
    // render. Handing a ref-reading closure to a factory at render time is what
    // the React Compiler warns about, and it is right to.
    return runLandingDropAnimation(args, {
      landingRect: landingRectRef.current,
      onLand: (id) => setLandingTodoId((current) => (current === id ? null : current)),
    });
  }, []);

  /**
   * Backstop. `onLand` is what normally reveals the row, but it only runs if
   * dnd-kit gets as far as invoking the drop animation — it bails early if the
   * overlay cannot be measured. A row stuck at zero opacity would look like
   * data loss, so time out well past the flight and reveal it regardless.
   */
  useEffect(() => {
    if (!landingTodoId) return;
    const timer = window.setTimeout(
      () => setLandingTodoId((current) => (current === landingTodoId ? null : current)),
      FLIGHT_MS + 250,
    );
    return () => window.clearTimeout(timer);
  }, [landingTodoId]);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;

      /**
       * Measure the drop indicator before anything else. dnd-kit calls this
       * handler inside `unstable_batchedUpdates` after its own dispatch, so
       * React has not committed yet and the indicator is still on screen — but
       * it will be gone after the first `await`.
       */
      const landingRect = readLandingRect();
      landingRectRef.current = null;

      const draggedListId = parseListDragId(String(active.id));
      const draggedTabId = parseTabDragId(String(active.id));

      setActiveTodo(null);
      setActiveList(null);
      setActiveTab(null);
      setOverId(null);
      if (!over) return;

      // Reordering a tab. Writes one tab's position and touches nothing else.
      if (draggedTabId) {
        const overTabId = parseTabDropId(String(over.id));
        if (!overTabId) return; // released off the strip
        const plan = planTabDrop(tabs, draggedTabId, overTabId);
        if (!plan) return; // dropped on itself
        landingRectRef.current = landingRect;

        const tab = tabs.find((t) => t.id === draggedTabId);
        if (tab) {
          pushUndo(`Moved “${short(tab.name)}”`, [
            {
              kind: "tab",
              entityId: tab.id,
              patch: inversePatch(tab, { position: plan.position }),
            },
          ]);
        }
        await updateTab(draggedTabId, { position: plan.position });
        return;
      }

      /**
       * A card released ON a tab pill writes nothing.
       *
       * Hovering one is a focus gesture — by the time the pointer comes up the
       * tab has already switched, and the card is meant to land in one of the
       * columns now showing. Falling through would look up the pill's id in
       * `todos`, find nothing, and return anyway; refusing here says so out
       * loud, and leaves the landing rect null so the card visibly returns
       * home rather than flying to the strip.
       */
      if (parseTabDropId(String(over.id))) return;

      // Reordering a list column. Separate from the card path below: it writes
      // one list's position and never touches a todo.
      if (draggedListId) {
        const target = parseColumnId(String(over.id));
        if (target?.kind !== "list") return; // dropped outside the planning half
        const plan = planListDrop(lists, draggedListId, target.listId);
        if (!plan) return; // dropped on itself
        landingRectRef.current = landingRect;

        const list = lists.find((l) => l.id === draggedListId);
        if (list) {
          pushUndo(`Moved “${short(list.name)}”`, [
            {
              kind: "list",
              entityId: list.id,
              patch: inversePatch(list, { position: plan.position }),
            },
          ]);
        }
        await updateList(draggedListId, { position: plan.position });
        return;
      }

      if (!board) return;

      const todo = todos.find((t) => t.id === active.id);
      if (!todo) return;

      /**
       * DROPPED ON A GROUP: "this belongs to list X, still scheduled for D."
       *
       * Resolved before `parseColumnId` because a group is not a column. Falling
       * through would take the append-to-a-day path and write only a date.
       */
      const dropped = parseDayGroupId(String(over.id));
      if (dropped) {
        // Overflow's groups register no droppable, so this is a guard rather than
        // a live case: Overflow refuses drops (see the `else` branch below).
        if (dropped.day === OVERFLOW) return;

        const column = board.days.find((d) => d.day === dropped.day);
        const group = column?.groups.find((g) => g.key === dropped.key);
        if (!group) return;

        /**
         * A card already in this group, already on this date, has nowhere to go:
         * order inside a group is COMPUTED, so there is no "move it up" for the
         * gesture to mean. Returning leaves the landing rect null and dnd-kit
         * flies the card home, which is the honest read for a no-op.
         *
         * `todo.scheduledDate === dropped.day` is the second half of the test and
         * is NOT redundant: a rolled-over todo renders in today's column while
         * still carrying last Friday's date, so dropping it on its own group there
         * is exactly how a user commits it to today. Comparing the RENDERED group
         * rather than `todo.listId` also handles a dangling listId, which renders
         * under Backlog while pointing at a list that is gone.
         */
        const current = findColumn(board, todo.id);
        if (
          current?.groupKey === dropped.key &&
          current.target.kind === "day" &&
          current.target.day === dropped.day &&
          todo.scheduledDate === dropped.day
        ) {
          return;
        }

        /*
          Last within the group. `position` is only a TIEBREAKER in this half —
          priority decides the band — but writing one keeps a dropped card off the
          middle of its band and gives the flight an end-of-group indicator to
          land on rather than a group rect it does not fill.
        */
        const ordered = group.todos.filter((t) => t.id !== todo.id);
        const groupPosition = positionForIndex(ordered, ordered.length);

        landingRectRef.current = landingRect;
        setLandingTodoId(todo.id);

        const forward = dayGroupPatch(dropped.key, dropped.day, groupPosition);
        pushUndo(`Moved “${short(todo.title)}”`, [
          { kind: "todo", entityId: todo.id, patch: inversePatch(todo, forward) },
        ]);
        await moveTodoToDayGroup(todo.id, dropped.key, dropped.day, groupPosition);
        return;
      }

      // `over` may be a column or another todo. Resolve the owning column.
      let target = parseColumnId(String(over.id));
      let siblings: Todo[] = [];
      let index = 0;

      if (!target) {
        const overTodo = todos.find((t) => t.id === over.id);
        if (!overTodo) return;
        const column = findColumn(board, overTodo.id);
        if (!column) return;
        target = column.target;
        siblings = column.todos;
        index = siblings.findIndex((t) => t.id === overTodo.id);
      } else {
        const column = columnByTarget(board, target);
        siblings = column ?? [];
        index = siblings.length;
      }

      // Exclude the dragged item so it cannot become its own neighbour.
      const ordered = siblings.filter((t) => t.id !== todo.id);
      const position = positionForIndex(ordered, index);

      if (target.kind === "list" || target.kind === "day") {
        // Only a committed move gets a landing. Everything else — a refusal, a
        // cancel, a release over nothing — leaves the rect null, and dnd-kit's
        // return-to-source animation stands. For a refusal that is the right
        // read: the item visibly goes back where it came from.
        landingRectRef.current = landingRect;
        setLandingTodoId(todo.id);
      }

      /**
       * Record before awaiting, so entry order matches the order the user
       * acted in even if two handlers overlap.
       *
       * Silent by design — no toast. The card visibly flies into its new slot,
       * so a notification would only restate what was just watched. ⌘Z still
       * reverses it.
       */
      if (target.kind === "list") {
        const forward = listPatch(target.listId, position);
        pushUndo(`Moved “${short(todo.title)}”`, [
          { kind: "todo", entityId: todo.id, patch: inversePatch(todo, forward) },
        ]);
        await moveTodoToList(todo.id, target.listId, position);
      } else if (target.kind === "day") {
        /*
          Empty space in a day column: schedule it here, keep its list, and write
          NO position. A day column's order is computed from priority, and the
          card's existing key still serves as its tiebreaker within whichever band
          it lands in. `positionForIndex` over a grouped array would be arithmetic
          on a sequence nothing orders by — meaningless, and it would silently
          reshuffle the card's tiebreaker for no visible effect.
        */
        const forward = schedulePatch(target.day);
        pushUndo(`Scheduled “${short(todo.title)}”`, [
          { kind: "todo", entityId: todo.id, patch: inversePatch(todo, forward) },
        ]);
        await scheduleTodo(todo.id, target.day);
      } else {
        // Dropping into Overflow is a triage gesture, not a schedule. Leave the
        // date alone so the item stays overdue rather than silently becoming
        // "due today" — the user still has to decide what to do with it.
        toast("Reschedule, complete, or move it to a list", {
          description: "Overflow is for deciding, not parking.",
        });
      }
    },
    [board, todos, lists, tabs],
  );

  const handleQuickAdd = useCallback(
    async (title: string, target: { listId?: string; day?: string }) => {
      // The only action that has to record AFTER the write, because the id it
      // needs to undo does not exist until then.
      const id = await createTodo({
        title,
        listId: target.listId ?? null,
        scheduledDate: target.day ?? null,
      });
      pushUndo(`Added “${short(title)}”`, [createUndoStep("todo", id)]);
    },
    [],
  );

  /**
   * Only open todos render as cards, so this is always a completion.
   *
   * Completing removes the card from the board entirely — buildBoard keeps
   * only `open` — and that invisibility is exactly what earns a toast. A change
   * the user can still see does not get one.
   */
  const handleToggle = useCallback((todo: Todo) => {
    const forward = statusPatch("done");
    const entryId = pushUndo(`Completed “${short(todo.title)}”`, [
      { kind: "todo", entityId: todo.id, patch: inversePatch(todo, forward) },
    ]);
    void setTodoStatus(todo.id, "done");
    toast.success(`Completed “${short(todo.title)}”`, {
      duration: 6000,
      action: { label: "Undo", onClick: () => void undoById(entryId) },
    });
  }, []);

  /**
   * The sheet's handlers all read the todo as it is RIGHT NOW to build an
   * inverse, which is why `openTodo` is derived from `todos` rather than held
   * in state — a snapshot would reverse whatever was true when it opened.
   */
  const handleSheetSave = useCallback(
    (id: string, patch: Partial<Todo>) => {
      const before = todos.find((t) => t.id === id);
      // Silent: the sheet is open, so the change is visible in the field the
      // user just left. One entry per field, so ⌘Z steps back one edit.
      if (before) {
        pushUndo(`Edited “${short(before.title)}”`, [
          { kind: "todo", entityId: id, patch: inversePatch(before, patch) },
        ]);
      }
      void updateTodo(id, patch);
    },
    [todos],
  );

  const handleSheetStatus = useCallback(
    (id: string, status: Todo["status"]) => {
      const before = todos.find((t) => t.id === id);
      if (!before) return;
      const forward = statusPatch(status);
      const entryId = pushUndo(`${STATUS_VERB[status]} “${short(before.title)}”`, [
        { kind: "todo", entityId: id, patch: inversePatch(before, forward) },
      ]);
      void setTodoStatus(id, status);
      // Same reasoning as the card checkbox: anything but `open` drops the
      // todo off the board, so there is nothing left on screen to confirm it.
      if (status !== "open") {
        toast.success(`${STATUS_VERB[status]} “${short(before.title)}”`, {
          duration: 6000,
          action: { label: "Undo", onClick: () => void undoById(entryId) },
        });
      }
    },
    [todos],
  );

  const handleToggleLabel = useCallback(
    (todoId: string, labelId: string) => {
      const before = todos.find((t) => t.id === todoId);
      if (!before) return;
      // toggleTodoLabel rewrites the whole array, so the inverse is simply the
      // array as it stands — no need to know which way the toggle went.
      pushUndo(`Labelled “${short(before.title)}”`, [
        { kind: "todo", entityId: todoId, patch: { labelIds: before.labelIds } },
      ]);
      void toggleTodoLabel(todoId, labelId);
    },
    [todos],
  );

  const handleDelete = useCallback(
    (id: string) => {
      const before = todos.find((t) => t.id === id);
      if (!before) return;
      const entryId = pushUndo(`Deleted “${short(before.title)}”`, [
        { kind: "todo", entityId: id, patch: { deletedAt: null } },
      ]);
      void deleteTodo(id);
      toast.success(`Deleted “${short(before.title)}”`, {
        duration: 8000,
        action: { label: "Undo", onClick: () => void undoById(entryId) },
      });
    },
    [todos],
  );

  /**
   * List settings. All three close the dialog: the write is instant and local,
   * so leaving it open would mean staring at a form describing a column that
   * has already changed — or, for archive and delete, one that has gone.
   */
  const handleSaveList = useCallback((list: List, patch: ListPatch) => {
    // The undo entry names what actually changed. A rename and a recolor are the
    // same write, and "Renamed" on a recolor is the sort of label that makes ⌘Z
    // look broken.
    const label =
      patch.name !== undefined
        ? `Renamed “${list.name}”`
        : `Recolored “${list.name}”`;
    updateListWithUndo(list, patch, label);
  }, []);

  const handleArchiveList = useCallback((list: List) => {
    setInfoListId(null);
    void archiveListWithUndo(list);
  }, []);

  const handleDeleteList = useCallback((list: List) => {
    setInfoListId(null);
    void deleteListWithUndo(list);
  }, []);

  /** Tab settings. Closed on every action, for the same reasons as lists. */
  const handleSaveTab = useCallback((tab: Tab, patch: TabPatch) => {
    updateTabWithUndo(tab, patch, `Edited “${short(tab.name)}”`);
  }, []);

  const handleArchiveTab = useCallback((tab: Tab) => {
    setInfoTabId(null);
    void archiveTabWithUndo(tab);
  }, []);

  const handleDeleteTab = useCallback((tab: Tab) => {
    setInfoTabId(null);
    void deleteTabWithUndo(tab);
  }, []);

  /** A new tab is worth looking at, so switch to it rather than just listing it. */
  const handleCreateTab = useCallback(
    async (name: string) => {
      selectTab(await createTabWithUndo(name));
    },
    [selectTab],
  );

  if (!ready || !ctx || !board || !settings) {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
        Loading your board…
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      /**
       * Re-measure droppables continuously, not once at drag start.
       *
       * Hovering a tab mid-drag swaps the whole column track: every droppable
       * in the planning half unmounts and a new set mounts. dnd-kit's default
       * measures once when the drag begins, so with the default the columns
       * that appear after a tab switch are invisible to the card already in
       * flight — it would hover them and drop into nothing, silently. This is
       * the line that makes carrying a to-do across tabs work at all.
       */
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <Hotkeys registry={hotkeys} context={guardContext} />

      <div className="flex h-dvh flex-col">
        <SignedOutBanner hasUserData={todos.length > 0} />

        <AppHeader
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          settings={settings}
        />

        <DateNav
          settings={settings}
          today={ctx.today}
          anchorIndex={anchorIndex}
          visibleCount={visibleCount}
          canJumpBack={canJumpBack}
          canJumpForward={canJumpForward}
          onJump={jumpBy}
          onJumpToDate={jumpToIndex}
          onToday={jumpToToday}
        />

        {/*
          Calendar half. Overflow sits OUTSIDE the scrolling track as a fixed
          sibling, so it stays reachable however far the day track scrolls —
          the whole point of pinning it. `position: sticky` was considered and
          rejected: dnd-kit caches each droppable's rect at drag start and
          corrects it by the scroll delta of its scrollable ancestors, so a
          sticky column's corrected rect would drift off screen and a drop
          "on" Overflow would silently resolve to whatever is underneath it.
        */}
        <div className="flex flex-1 border-b bg-border/40">
          <div
            ref={overflowPanelRef}
            className={cn(PINNED_PANEL, "pt-4")}
            style={
              overflowWidth != null
                ? ({ "--column-min": `${overflowWidth}px` } as CSSProperties)
                : undefined
            }
          >
            <BoardColumn
              id={board.overflow.id}
              title="Overflow"
              subtitle="Put off too long"
              todos={board.overflow.todos}
              labels={labels}
              ctx={ctx}
              // Grouped like a day column — the origin of a stale to-do is as
              // useful as anything here. `rejectsDrop` below means its groups
              // register no droppable, so they read but do not receive.
              groups={board.overflow.groups}
              collapsedGroups={collapsedGroups}
              onToggleGroup={toggleGroup}
              onToggle={handleToggle}
              onOpen={(todo) => setOpenTodoId(todo.id)}
              // No `onQuickAdd`, so no quick-add row: nothing can be scheduled
              // INTO Overflow, only out of it.
              onNavigate={navigate}
              emphasis
              isDragActive={!!activeTodo}
              overTodoId={overTodoId}
              landingTodoId={landingTodoId}
              rejectsDrop
              pinned
              collapsed={overflowCollapsed}
              onExpand={() => void mutateSettings(LOCAL_OWNER_ID, { overflowCollapsed: false })}
              actions={
                <RailCollapseButton
                  label="Overflow"
                  onCollapse={() => void mutateSettings(LOCAL_OWNER_ID, { overflowCollapsed: true })}
                />
              }
            />
            {!overflowCollapsed && (
              <RailHandle
                label="Overflow"
                panelRef={overflowPanelRef}
                storedWidth={overflowWidth}
                disabled={railDisabled}
                onWidthChange={(width) =>
                  void mutateSettings(LOCAL_OWNER_ID, { overflowWidth: width })
                }
                onCollapsedChange={(collapsed) =>
                  void mutateSettings(LOCAL_OWNER_ID, { overflowCollapsed: collapsed })
                }
              />
            )}
          </div>
          <div className="flex min-w-0 flex-1 gap-px px-4 pt-4">
            <div ref={dayTrackRef} className="column-track flex flex-1 gap-px">
              {trackSlots.map((slot) => {
                if (slot.kind === "weekend") {
                  return (
                    <WeekendColumn
                      key={slot.id}
                      id={slot.id}
                      columns={slot.columns}
                      isDragActive={!!activeTodo}
                      onExpand={() => expandWeekend(slot.id)}
                      onNavigate={navigate}
                    />
                  );
                }
                const { column } = slot;
                const { weekday, label } = formatDay(column.day);
                const isToday = column.day === ctx.today;
                return (
                  <BoardColumn
                    key={column.id}
                    id={column.id}
                    // Marks this as a full-width day column for `measurePitch`
                    // in use-day-track.ts, which must not measure a 40px
                    // weekend strip that happens to sort first.
                    dayTrackColumn
                    title={weekday}
                    // `subtitle` also carries prose on other columns, so the
                    // numeral face is applied here rather than in BoardColumn.
                    subtitle={<span className="num">{label}</span>}
                    todos={column.todos}
                    labels={labels}
                    ctx={ctx}
                    dueCount={deadlineCounts.get(column.day)}
                    groups={column.groups}
                    collapsedGroups={collapsedGroups}
                    onToggleGroup={toggleGroup}
                    overGroupId={overGroupId}
                    emphasis={isToday}
                    onToggle={handleToggle}
                    onOpen={(todo) => setOpenTodoId(todo.id)}
                    onQuickAdd={(title) => void handleQuickAdd(title, { day: column.day })}
                    onNavigate={navigate}
                    isDragActive={!!activeTodo}
                    overTodoId={overTodoId}
                    landingTodoId={landingTodoId}
                  />
                );
              })}
              {/*
                A tile at the end of whatever is currently loaded, exactly like
                CreateListColumn at the end of the planning track — growth is
                always an explicit click, never silent, so it never surprises a
                user mid-scroll with columns that weren't there a second ago.
                Gone once `cap` is reached; there is nothing further to load
                until the user picks a date past it (see `cap`'s definition).
              */}
              {renderedDays < cap && (
                <button
                  type="button"
                  data-nav-stop={NAV_LOAD_MORE}
                  onClick={loadMoreDays}
                  onKeyDown={(e) => {
                    const key = navKeyOf(e);
                    if (key && navigate(NAV_LOAD_MORE, key)) e.preventDefault();
                  }}
                  className={cn(
                    "flex flex-1 flex-col items-center justify-center rounded-md",
                    "min-w-(--column-min) max-w-(--column-max) border border-dashed border-border",
                    "px-2 text-center text-xs text-muted-foreground transition-colors",
                    "hover:border-foreground/30 hover:bg-background/60 hover:text-foreground",
                    "focus-visible:outline-2 focus-visible:outline-ring",
                  )}
                >
                  Load {LOAD_MORE_STEP} more days
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Planning half */}
        <div className="flex flex-[0.8] bg-muted/30">
          {backlogColumn && (
            <div
              ref={backlogPanelRef}
              className={cn(PINNED_PANEL, "pt-3")}
              style={
                backlogWidth != null
                  ? ({ "--column-min": `${backlogWidth}px` } as CSSProperties)
                  : undefined
              }
            >
              <BoardColumn
                id={backlogColumn.id}
                title={backlogColumn.list.name}
                todos={backlogColumn.todos}
                labels={labels}
                ctx={ctx}
                awayTodoIds={board.awayTodoIds}
                onToggle={handleToggle}
                onOpen={(todo) => setOpenTodoId(todo.id)}
                onQuickAdd={(title) =>
                  void handleQuickAdd(title, { listId: backlogColumn.list.id })
                }
                onNavigate={navigate}
                minRows={5}
                isDragActive={!!activeTodo}
                overTodoId={overTodoId}
                landingTodoId={landingTodoId}
                // Pinned leftmost, so it gets no reorder handle.
                reservesGripSlot
                // Backlog cannot be renamed, archived, or deleted, so its one
                // real action is collapsing the rail — see RailCollapseButton.
                isColumnDragActive={!!activeList}
                // Backlog belongs to no tab, so it stays neutral while the
                // columns around it carry the current tab's color. That
                // difference is also the clearest signal that it is shared.
                accentColor={null}
                pinned
                collapsed={backlogCollapsed}
                onExpand={() => void mutateSettings(LOCAL_OWNER_ID, { backlogCollapsed: false })}
                actions={
                  <RailCollapseButton
                    label="Backlog"
                    onCollapse={() => void mutateSettings(LOCAL_OWNER_ID, { backlogCollapsed: true })}
                  />
                }
              />
              {!backlogCollapsed && (
                <RailHandle
                  label="Backlog"
                  panelRef={backlogPanelRef}
                  storedWidth={backlogWidth}
                  disabled={railDisabled}
                  onWidthChange={(width) =>
                    void mutateSettings(LOCAL_OWNER_ID, { backlogWidth: width })
                  }
                  onCollapsedChange={(collapsed) =>
                    void mutateSettings(LOCAL_OWNER_ID, { backlogCollapsed: collapsed })
                  }
                />
              )}
            </div>
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <TabStrip
              tabs={tabs}
              activeTabId={activeTabId}
              archivedCount={archivedLists.length + archivedTabs.length}
              infoTabId={infoTabId}
              drop={tabDrop}
              isCardDragActive={!!activeTodo}
              onSelect={selectTab}
              onOpenInfo={setInfoTabId}
              onCreate={(name) => void handleCreateTab(name)}
              onOpenArchive={() => setArchivedOpen(true)}
            />
            <Separator />
            {/*
              The wider floor is set on the outer row, not on each column:
              every column inside reads `--column-min`, so overriding it here
              widens the whole track without threading a size prop through
              BoardColumn. Backlog carries the same override via
              PINNED_PANEL, so it lands at this width too even though it now
              sits in its own panel rather than this row.
            */}
            <div className="flex flex-1 gap-px bg-border/40 px-4 pt-3 [--column-min:var(--list-column-min)]">
              <div className="column-track flex flex-1 gap-px">
                {otherListColumns.map((column) => (
                  <BoardColumn
                    key={column.id}
                    id={column.id}
                    title={column.list.name}
                    todos={column.todos}
                    labels={labels}
                    ctx={ctx}
                    awayTodoIds={board.awayTodoIds}
                    onToggle={handleToggle}
                    onOpen={(todo) => setOpenTodoId(todo.id)}
                    onQuickAdd={(title) =>
                      void handleQuickAdd(title, { listId: column.list.id })
                    }
                    onNavigate={navigate}
                    minRows={5}
                    isDragActive={!!activeTodo}
                    overTodoId={overTodoId}
                    landingTodoId={landingTodoId}
                    reorderListId={column.list.id}
                    reservesGripSlot
                    onOpenListInfo={() => setInfoListId(column.list.id)}
                    isColumnDropTarget={columnDropTargetId === column.list.id}
                    isColumnDragActive={!!activeList}
                    // The list's own color wins, falling back to its tab's. A
                    // list you have deliberately colored should look colored in
                    // both halves — and the tab accent still covers every list
                    // you have not, so "these columns belong together" survives.
                    accentColor={column.list.color ?? activeTabRecord?.color}
                  />
                ))}
                <CreateListColumn tabId={activeTabId} onNavigate={navigate} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/*
        The overlay follows the cursor at a slight tilt and scale so the item
        reads as lifted off the board rather than sliding along it — then
        settles flat as it flies into its new slot on release.
      */}
      <DragOverlay dropAnimation={dropAnimation}>
        {activeTodo && (
          <div
            // The lift is inline rather than `rotate-2 scale-[1.02]` so the drop
            // animation knows exactly which properties it is unwinding. Given
            // classes, whether Tailwind emits `transform` or the individual
            // `rotate`/`scale` properties decides whether the animation
            // composites or doubles the tilt — not a thing to leave to chance.
            style={{
              ...LIFTED,
              // The card's rail, but riding the chip's existing border rather
              // than an absolutely positioned span: a standalone rounded box has
              // no column edge to keep true and no layout to shift, so a border
              // is simply the right form here. Both surfaces read their width
              // and colour from PRIORITY_RAILS, so they cannot drift in value.
              borderLeftWidth: activeRail?.width,
              borderLeftColor: activeRail?.color,
            }}
            className={cn(
              "flex max-w-xs cursor-grabbing items-center gap-1 rounded-md border",
              "bg-background px-2 py-1.5 text-sm shadow-xl ring-2 ring-primary/40",
            )}
          >
            <GripVertical className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            {activeTodo.location && (
              <MapPin className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            )}
            {/*
              Truncated, not wrapped like the card: the overlay wrapper has to
              keep a stable measurable box or the drop animation mis-measures its
              flight (§4.7), and a chip that changed height mid-drag would.
            */}
            <span className="truncate">{activeTodo.title}</span>
          </div>
        )}
        {activeList && (
          <div
            style={LIFTED}
            className={cn(
              "flex max-w-xs cursor-grabbing items-center gap-2 rounded-md border",
              "bg-background px-2 py-1.5 shadow-xl ring-2 ring-primary/40",
            )}
          >
            <GripVertical className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate font-heading text-sm font-bold uppercase tracking-tight">
              {activeList.name}
            </span>
          </div>
        )}
        {activeTab && (
          <div
            style={{ ...LIFTED, backgroundColor: tint(activeTab.color) }}
            className={cn(
              "flex max-w-xs cursor-grabbing items-center gap-2 rounded-md border",
              "bg-background px-2 py-1 text-xs shadow-xl ring-2 ring-primary/40",
            )}
          >
            <GripVertical className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate font-semibold">{activeTab.name}</span>
          </div>
        )}
      </DragOverlay>

      <TodoSheet
        todo={openTodo}
        lists={lists}
        labels={labels}
        projects={projects}
        onClose={() => setOpenTodoId(null)}
        onSave={handleSheetSave}
        onSetStatus={handleSheetStatus}
        onToggleLabel={handleToggleLabel}
        onDelete={handleDelete}
      />

      <ListInfoDialog
        list={infoList}
        onClose={() => setInfoListId(null)}
        onSave={handleSaveList}
        onArchive={handleArchiveList}
        onDelete={handleDeleteList}
      />

      <TabInfoDialog
        tab={infoTab}
        onClose={() => setInfoTabId(null)}
        onSave={handleSaveTab}
        onArchive={handleArchiveTab}
        onDelete={handleDeleteTab}
      />

      <ArchivedListsSheet
        open={archivedOpen}
        onOpenChange={setArchivedOpen}
        lists={archivedLists}
        tabs={archivedTabs}
        todos={todos}
        onRestore={restoreListWithUndo}
        onRestoreTab={(tab) => void restoreTabWithUndo(tab)}
      />

      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
      />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        lists={lists}
        // Archived lists are off the board, and so are their to-dos — search
        // must not be the one door left open to them.
        todos={visibleTodos}
        tabs={tabs}
        settings={settings}
        activeTabId={activeTabId}
        onSelectTodo={(todo) => setOpenTodoId(todo.id)}
        onSelectTab={selectTab}
      />

      <SessionProvider />
      <SyncProvider />
      <WelcomeDialog />
    </DndContext>
  );
}

/**
 * Titles are free text and can be a paragraph. Truncate before quoting one
 * into a toast or an undo label, so a long todo cannot push the Undo button
 * off the card.
 */
function short(title: string, max = 40): string {
  const trimmed = title.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

const STATUS_VERB: Record<Todo["status"], string> = {
  open: "Reopened",
  done: "Completed",
  dropped: "Dropped",
};

/** Locate which column currently holds a todo. */
function findColumn(
  board: NonNullable<ReturnType<typeof buildBoard>>,
  todoId: string,
) {
  for (const day of board.days) {
    // The group the card RENDERS in, which is not always the group its `listId`
    // names: a dangling listId renders under Backlog. The no-op test in
    // handleDragEnd needs the rendered answer.
    const group = day.groups.find((g) => g.todos.some((t) => t.id === todoId));
    if (group) {
      return {
        target: { kind: "day" as const, day: day.day },
        todos: day.todos,
        groupKey: group.key,
      };
    }
    // Degenerate no-lists path, where a column falls back to a flat array.
    if (day.todos.some((t) => t.id === todoId)) {
      return {
        target: { kind: "day" as const, day: day.day },
        todos: day.todos,
        groupKey: null,
      };
    }
  }
  if (board.overflow.todos.some((t) => t.id === todoId)) {
    return {
      target: { kind: "overflow" as const },
      todos: board.overflow.todos,
      groupKey: null,
    };
  }
  for (const column of board.lists) {
    if (column.todos.some((t) => t.id === todoId)) {
      return {
        target: { kind: "list" as const, listId: column.list.id },
        todos: column.todos,
        groupKey: null,
      };
    }
  }
  return null;
}

/** The todos currently in a given drop target. */
function columnByTarget(
  board: NonNullable<ReturnType<typeof buildBoard>>,
  target: NonNullable<ReturnType<typeof parseColumnId>>,
): Todo[] | null {
  if (target.kind === "day") {
    return board.days.find((d) => d.day === target.day)?.todos ?? null;
  }
  if (target.kind === "overflow") return board.overflow.todos;
  return board.lists.find((c) => c.list.id === target.listId)?.todos ?? null;
}

export { OVERFLOW };
