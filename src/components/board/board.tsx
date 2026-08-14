"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { DndContext, DragOverlay, MeasuringStrategy } from "@dnd-kit/core";
import { GripVertical, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { useViewport } from "@/lib/use-viewport";
import { LIFTED } from "@/lib/drop-animation";
import { tint } from "@/lib/colors";
import { priorityRail } from "@/lib/priority";
import { FONT_STORAGE_KEY } from "@/lib/fonts";
import {
  DARK_CLASS,
  PREFERS_DARK,
  THEME_STORAGE_KEY,
  normalizeTheme,
  resolveTheme,
} from "@/lib/theme";
import { LOCAL_OWNER_ID } from "@/lib/store/repositories";
import { mutateSettings } from "@/lib/store/mutate";
import type { Hotkey } from "@/lib/keyboard";
import { Hotkeys } from "@/components/hotkeys";
import { TodoSheet } from "./todo-sheet";
import { ListInfoDialog } from "./list-info-dialog";
import { TabInfoDialog } from "./tab-info-dialog";
import { ArchivedListsSheet } from "./archived-lists-sheet";
import { HelpSheet } from "./help-sheet";
import { SettingsSheet } from "@/components/settings/settings-sheet";
import { CommandPalette } from "./command-palette";
import { DaySheet } from "./day-sheet";
import { OverdriveOverlay } from "./overdrive-overlay";
import { SessionProvider } from "@/components/auth/session-provider";
import { SyncProvider } from "@/components/sync/sync-provider";
import { WelcomeDialog } from "@/components/auth/welcome-dialog";
import { restoreListWithUndo } from "./list-actions";
import { restoreTabWithUndo } from "./tab-actions";
import { useColumnNav } from "./use-column-nav";
import { useDayTrack } from "./use-day-track";
import { useReminders } from "./use-reminders";
import { useBoardData } from "./use-board-data";
import { computeModalOpen, useBoardUiState } from "./use-board-ui-state";
import { useBoardActions } from "./use-board-actions";
import { DesktopBoard, type ReadyBoardData } from "./desktop-board";
import { PhoneBoard } from "./phone-board";
import { setDayNote } from "@/lib/store/repositories";
import { boardDragAnnouncements } from "@/lib/dnd-announcements";

/**
 * Pass A/B/C of `board.tsx`'s extraction (docs/ARCHITECTURE.md, mobile plan
 * P2) live in `use-board-data.ts`/`use-board-ui-state.ts`/
 * `use-board-actions.ts`. This file is what's left: the composition root.
 *
 * Three things stay here rather than in any of the three hooks, all for the
 * same reason — they are genuinely layout-shell concerns, not data, not
 * interaction state, not a handler:
 *
 * - `dayTrackRef` + `useDayTrack` + the `jumpBy`/`jumpToIndex`/`jumpToToday`
 *   wrappers. A ref has to attach to whichever element is actually
 *   scrolling, which is a layout fact — hoisting it here (rather than into
 *   `DesktopBoard`) is what lets a future `PhoneBoard` (P3) attach the SAME
 *   ref to a different element and get `anchorIndex`/`jumpBy`/`jumpToToday`
 *   for free, with no duplicate scroll-tracking logic.
 * - `navigate` (`useColumnNav`) — it needs `anchorIndex`/`visibleCount`/
 *   `jumpToIndex`, which only exist after `useDayTrack` has run.
 * - `guardContext` — combines `ui`'s own state with `data.openTodo`, which
 *   neither hook can compute alone (see `computeModalOpen`'s comment in
 *   `use-board-ui-state.ts`).
 *
 * `DndContext`, `Hotkeys`, `DragOverlay`, and every sheet mount live here
 * too, deliberately never inside `DesktopBoard` — exactly one of each
 * regardless of which layout renders, so a future `PhoneBoard` can never
 * duplicate a droppable/draggable id into dnd-kit's id-keyed maps. `DaySheet`
 * stays OUTSIDE `DndContext`, as it always has: its timeline renders real
 * `TodoCard`s, which call `useSortable` unconditionally, and a second
 * registration under an id the board already owns would silently replace the
 * real card's entry for as long as the sheet stayed open.
 */
export function Board() {
  // `layout` finally gets a render branch as of P3 — see docs/MOBILE.md.
  const { layout, coarse } = useViewport();

  const ui = useBoardUiState();
  const data = useBoardData({
    activeTodo: ui.activeTodo,
    overId: ui.overId,
    activeList: ui.activeList,
    activeTab: ui.activeTab,
    infoListId: ui.infoListId,
    infoTabId: ui.infoTabId,
    openTodoId: ui.openTodoId,
    collapsedGroups: ui.collapsedGroups,
    expandedWeekends: ui.expandedWeekends,
    columnFilters: ui.columnFilters,
    horizon: ui.horizon,
    cap: ui.cap,
    layout,
  });
  const actions = useBoardActions(data, ui, coarse, layout);

  const { settings, navGrid, dayIds } = data;

  // Foreground reminders: polls `nonTemplateTodos` for anything due and
  // delivers each once. See `use-reminders.ts` for why this is a poll rather
  // than a per-todo timer.
  useReminders(data.nonTemplateTodos, settings?.timezone ?? "UTC");

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

  /** The day track's scroll container, threaded into `useDayTrack` below. */
  const dayTrackRef = useRef<HTMLDivElement>(null);

  const splitCollapsed = settings?.splitCollapsed ?? "none";

  /**
   * Re-shows a collapsed calendar before a `DateNav`/hotkey/palette jump —
   * jumping to a date you can't see is meaningless. Wrapped here, once,
   * rather than in `DateNav` itself, so every caller of `jumpBy`/
   * `jumpToIndex`/`jumpToToday` inherits it for free.
   */
  const showCalendar = useCallback(() => {
    if (splitCollapsed === "calendar") {
      void mutateSettings(LOCAL_OWNER_ID, { splitCollapsed: "none" });
    }
  }, [splitCollapsed]);

  const {
    anchorIndex,
    visibleCount,
    canJumpBack,
    canJumpForward,
    jumpBy: jumpByRaw,
    jumpToIndex: jumpToIndexRaw,
    jumpToToday: jumpToTodayRaw,
  } = useDayTrack({
    trackRef: dayTrackRef,
    cap: ui.cap,
    /**
     * `jumpToIndex` (wired to the date picker) calls this with targets past
     * `cap` on purpose — see the comment on `cap` in `use-board-ui-state.ts`.
     * Growing both here, together, is what makes an 18-months-out pick
     * actually reachable instead of silently clamped back to a year.
     */
    onExtend: (days) => {
      ui.setCap((c) => Math.max(c, days));
      ui.setHorizon((h) => Math.max(h, days));
    },
    // False while collapsed: the track has no layout to scroll to yet. A
    // jump requested in that state parks (see the comment on `trackReady` in
    // use-day-track.ts) and is served once this flips back to true.
    trackReady: splitCollapsed !== "calendar",
    // Overflow is spliced into the SAME scroll-snap track as the day
    // columns on phone (there's no pinned-sibling-outside-the-track the way
    // desktop has) — see use-day-track.ts's own comment on this option.
    indexOffset: layout === "phone" ? 1 : 0,
  });

  const jumpBy = useCallback(
    (delta: number) => {
      showCalendar();
      jumpByRaw(delta);
    },
    [showCalendar, jumpByRaw],
  );
  const jumpToIndex = useCallback(
    (target: number) => {
      showCalendar();
      jumpToIndexRaw(target);
    },
    [showCalendar, jumpToIndexRaw],
  );
  const jumpToToday = useCallback(() => {
    showCalendar();
    jumpToTodayRaw();
  }, [showCalendar, jumpToTodayRaw]);

  const navigate = useColumnNav({
    grid: navGrid,
    dayIds,
    dragging: ui.dragging,
    anchorIndex,
    visibleCount,
    jumpToIndex,
  });

  const guardContext = {
    dragging: ui.dragging,
    modalOpen: computeModalOpen({
      paletteOpen: ui.paletteOpen,
      openTodoExists: !!data.openTodo,
      infoListId: ui.infoListId,
      infoTabId: ui.infoTabId,
      archivedOpen: ui.archivedOpen,
      settingsOpen: ui.settingsOpen,
      openDay: ui.openDay,
      overdriveOpen: ui.overdriveOpen,
      helpSheetOpen: ui.helpSheetOpen,
    }),
  };

  /**
   * The board's global shortcuts. See docs/KEYBOARD.md.
   *
   * Declared here (not in `use-board-ui-state.ts`) even though most of its
   * fields live there — `hotkeys` itself is a static registry independent of
   * any single piece of state, and lives with the other UI state as
   * `ui.hotkeys` (it only needs `handleUndo`, which only touches ui-state).
   * Read from `ui` directly below.
   */
  const hotkeys: Hotkey[] = ui.hotkeys;

  const activeRail = priorityRail(ui.activeTodo?.priority ?? null);

  /**
   * dnd-kit screen-reader announcements (EI-84) — string-building lives in
   * `dnd-announcements.ts` so it's testable without React; this just supplies
   * the same board data `DndContext` below already reads. A `useMemo` before
   * the loading guard, like `hotkeys`/`activeRail` above — hooks can't follow
   * a conditional return, so `data.board` may still be null here, hence the
   * empty fallback (never actually reached by a drag before `ready`).
   */
  const dragAnnouncements = useMemo(
    () =>
      boardDragAnnouncements({
        board: data.board ?? { days: [], overflow: { id: "", todos: [], groups: [] }, lists: [] },
        todosById: data.todosById,
        listsById: data.listsById,
        tabsById: data.tabsById,
      }),
    [data.board, data.todosById, data.listsById, data.tabsById],
  );

  if (!data.ready || !data.ctx || !data.board || !data.settings) {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
        Loading your board…
      </div>
    );
  }

  return (
    <>
    <DndContext
      sensors={actions.sensors}
      collisionDetection={actions.collisionDetection}
      autoScroll={actions.autoScroll}
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
      accessibility={{ announcements: dragAnnouncements }}
      onDragStart={actions.handleDragStart}
      onDragOver={actions.handleDragOver}
      onDragEnd={actions.handleDragEnd}
      onDragCancel={actions.handleDragCancel}
    >
      <Hotkeys registry={hotkeys} context={guardContext} />

      {/*
        The mobile plan's M3 branch point — `layout` finally drives what
        renders. `tablet` gets `DesktopBoard` unchanged: the existing
        two-half board already fits at iPad-mini portrait (744px), so it
        only needed M1's touch remediation, not a new layout. Every prop
        below is identical between the two — both take exactly `data`/`ui`/
        `actions` plus the day-track values the shell hoists (see this
        file's own doc comment for why `dayTrackRef`/`navigate` live here
        rather than in either board component).
      */}
      {layout === "phone" ? (
        <PhoneBoard
          data={data as ReadyBoardData}
          ui={ui}
          actions={actions}
          navigate={navigate}
          dayTrackRef={dayTrackRef}
          anchorIndex={anchorIndex}
          visibleCount={visibleCount}
          canJumpBack={canJumpBack}
          canJumpForward={canJumpForward}
          jumpBy={jumpBy}
          jumpToIndex={jumpToIndex}
          jumpToToday={jumpToToday}
        />
      ) : (
        <DesktopBoard
          // Narrowed by the `!data.ready || !data.ctx || ...` gate above,
          // which TypeScript can't see across this component boundary on
          // its own — see `ReadyBoardData`'s comment in desktop-board.tsx.
          data={data as ReadyBoardData}
          ui={ui}
          actions={actions}
          navigate={navigate}
          dayTrackRef={dayTrackRef}
          anchorIndex={anchorIndex}
          visibleCount={visibleCount}
          canJumpBack={canJumpBack}
          canJumpForward={canJumpForward}
          jumpBy={jumpBy}
          jumpToIndex={jumpToIndex}
          jumpToToday={jumpToToday}
        />
      )}

      {/*
        The overlay follows the cursor at a slight tilt and scale so the item
        reads as lifted off the board rather than sliding along it — then
        settles flat as it flies into its new slot on release.
      */}
      <DragOverlay dropAnimation={actions.dropAnimation}>
        {ui.activeTodo && (
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
            {ui.activeTodo.location && (
              <MapPin className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            )}
            {/*
              Truncated, not wrapped like the card: the overlay wrapper has to
              keep a stable measurable box or the drop animation mis-measures its
              flight (§4.7), and a chip that changed height mid-drag would.
            */}
            <span className="truncate">{ui.activeTodo.title}</span>
          </div>
        )}
        {ui.activeList && (
          <div
            style={LIFTED}
            className={cn(
              "flex max-w-xs cursor-grabbing items-center gap-2 rounded-md border",
              "bg-background px-2 py-1.5 shadow-xl ring-2 ring-primary/40",
            )}
          >
            <GripVertical className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate font-heading text-sm font-bold uppercase tracking-tight">
              {ui.activeList.name}
            </span>
          </div>
        )}
        {ui.activeTab && (
          <div
            style={{ ...LIFTED, backgroundColor: tint(ui.activeTab.color) }}
            className={cn(
              "flex max-w-xs cursor-grabbing items-center gap-2 rounded-md border",
              "bg-background px-2 py-1 text-xs shadow-xl ring-2 ring-primary/40",
            )}
          >
            <GripVertical className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate font-semibold">{ui.activeTab.name}</span>
          </div>
        )}
      </DragOverlay>

      <TodoSheet
        todo={data.openTodo}
        today={data.ctx.today}
        ctx={data.ctx}
        lists={data.lists}
        tabs={data.tabs}
        labels={data.labels}
        projects={data.projects}
        places={data.places}
        reminderPresets={data.reminderPresets}
        events={data.todoEvents}
        timezone={data.settings?.timezone ?? "UTC"}
        listsById={data.listsById}
        onClose={ui.closeTodoSheet}
        onSave={actions.handleSheetSave}
        onSetStatus={actions.handleSheetStatus}
        onToggleLabel={actions.handleToggleLabel}
        onDelete={actions.handleDelete}
        backToDay={ui.todoOriginDay ?? undefined}
        onBackToDay={ui.handleBackToDay}
        recurrence={actions.recurrenceInfo}
        onStartSeries={actions.handleStartSeries}
      />

      <ListInfoDialog
        list={data.infoList}
        onClose={() => ui.setInfoListId(null)}
        onSave={actions.handleSaveList}
        onArchive={actions.handleArchiveList}
        onDelete={actions.handleDeleteList}
      />

      <TabInfoDialog
        tab={data.infoTab}
        onClose={() => ui.setInfoTabId(null)}
        onSave={actions.handleSaveTab}
        onArchive={actions.handleArchiveTab}
        onDelete={actions.handleDeleteTab}
      />

      <ArchivedListsSheet
        open={ui.archivedOpen}
        onOpenChange={ui.setArchivedOpen}
        lists={data.archivedLists}
        tabs={data.archivedTabs}
        todos={data.todos}
        onRestore={restoreListWithUndo}
        onRestoreTab={(tab) => void restoreTabWithUndo(tab)}
      />

      <SettingsSheet
        open={ui.settingsOpen}
        onOpenChange={ui.setSettingsOpen}
        settings={data.settings}
      />

      <HelpSheet open={ui.helpSheetOpen} onOpenChange={ui.setHelpSheetOpen} hotkeys={hotkeys} />

      <CommandPalette
        open={ui.paletteOpen}
        onOpenChange={ui.setPaletteOpen}
        lists={data.lists}
        // Archived lists are off the board, and so are their to-dos — search
        // must not be the one door left open to them. `nonTemplateTodos`, not
        // `visibleTodos`: a virtual recurrence occurrence is not a distinct
        // record to find, and a template renders nowhere for search to open.
        todos={data.nonTemplateTodos}
        labels={data.labels}
        reminderPresets={data.reminderPresets}
        recurrenceSummaries={data.recurrenceSummaries}
        tabs={data.tabs}
        settings={data.settings}
        activeTabId={data.activeTabId}
        onSelectTodo={(todo) => ui.openTodoSheet(todo.id)}
        onSelectTab={ui.selectTab}
        onSetTodoStatus={actions.handleSheetStatus}
        onDeleteTodo={actions.handleDelete}
        overflowCount={data.board.overflow.todos.length}
        onOpenOverdrive={() => ui.setOverdriveOpen(true)}
        onOpenHelp={() => ui.setHelpSheetOpen(true)}
      />

      <SessionProvider />
      <SyncProvider />
      <WelcomeDialog />
    </DndContext>

    {/*
      DELIBERATELY OUTSIDE THE DndContext ABOVE, and this is load bearing.

      The day sheet's timeline renders real TodoCards, and TodoCard calls
      `useSortable` unconditionally. Inside the context those calls would
      re-register draggable and droppable entries under ids the board already
      owns — dnd-kit keys those maps by id, so the timeline's copy would silently
      replace the real card's entry for as long as the sheet stayed open, and
      dragging that card on the board behind it would stop working.

      Outside, the hooks fall through to dnd-kit's default contexts (a no-op
      dispatch and an empty item list), so they register nothing and hand back no
      listeners. Base UI portals the popup to <body> either way, so the sheet
      looks and behaves identically wherever it sits in the tree.
    */}
    <DaySheet
      day={ui.openDay}
      settings={data.settings}
      note={ui.openDay ? data.dayNotes.get(ui.openDay) : undefined}
      // `nonTemplateTodos`: a day's timeline is a journal of what actually
      // happened, and nothing happens to a virtual occurrence or a template.
      todos={data.nonTemplateTodos}
      timezone={data.settings?.timezone ?? "UTC"}
      labels={data.labels}
      reminderPresets={data.reminderPresets}
      listsById={data.listsById}
      backlog={data.backlogList}
      ctx={data.ctx}
      onClose={() => ui.setOpenDay(null)}
      onSaveNote={(day, body) => void setDayNote(day, body)}
      onToggleTodo={actions.handleToggle}
      // Swap sheets rather than stacking them: a second right-side sheet fully
      // covers the first, so "the day is still behind it" would be a lie. The
      // todo sheet's "Back to Aug 11" is what lets the user return.
      onOpenTodo={(todo) => {
        ui.openTodoSheet(todo.id, ui.openDay);
        ui.setOpenDay(null);
      }}
    />

    {/*
      Also outside DndContext, for the same reason DaySheet is: `OverdriveCard`
      renders todo content but (unlike TodoCard) registers no dnd-kit hook at
      all, so there's nothing here for the context to protect either way —
      this just keeps it consistent with every other full-board overlay.
    */}
    <OverdriveOverlay
      open={ui.overdriveOpen}
      todos={data.board.overflow.todos}
      todosById={data.todosById}
      listsById={data.listsById}
      backlogListId={data.backlogList?.id ?? ""}
      labels={data.labels}
      reminderPresets={data.reminderPresets}
      ctx={data.ctx}
      onClose={() => ui.setOverdriveOpen(false)}
      onVerdict={actions.handleOverdriveVerdict}
    />
    </>
  );
}

export { OVERFLOW } from "@/lib/scheduling";
