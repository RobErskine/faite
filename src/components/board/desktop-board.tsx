"use client";

import { useRef, type CSSProperties } from "react";
import { StickyNote } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { effectiveListColor } from "@/lib/colors";
import { NAV_LOAD_MORE, navKeyOf } from "@/lib/column-nav";
import { formatDay } from "@/lib/scheduling";
import { OVERDRIVE_MIN_TODOS } from "@/lib/overdrive";
import { LOCAL_OWNER_ID } from "@/lib/store/repositories";
import { mutateSettings } from "@/lib/store/mutate";
import { AppHeader } from "./app-header";
import { SignedOutBanner } from "@/components/auth/signed-out-banner";
import { BoardColumn } from "./board-column";
import { CreateListColumn } from "./create-list-column";
import { DateNav } from "./date-nav";
import { OverdriveButton } from "./overdrive-button";
import { RailCollapseButton } from "./rail-collapse-button";
import { RailHandle } from "./rail-handle";
import { SplitHandle } from "./split-handle";
import { SplitStrip } from "./split-strip";
import { TabStrip } from "./tab-strip";
import { WeekendColumn } from "./weekend-column";
import type { BoardData } from "./use-board-data";
import type { BoardUiState } from "./use-board-ui-state";
import type { useBoardActions } from "./use-board-actions";
import type { NavigateFn } from "./use-column-nav";

/**
 * `ctx`/`board`/`settings` narrowed to non-null — `Board` (the shell) only
 * ever renders `<DesktopBoard>` after its own loading gate
 * (`!data.ready || !data.ctx || !data.board || !data.settings`) confirms all
 * three, but that narrowing is local to the shell's function body and does
 * not survive `data` crossing a component boundary as a plain `BoardData`.
 * Rather than re-derive a second gate here (or worse, sprinkle `!` assertions
 * through the JSX below), the shell asserts the type once at the call site.
 */
export type ReadyBoardData = BoardData & {
  ctx: NonNullable<BoardData["ctx"]>;
  board: NonNullable<BoardData["board"]>;
  settings: NonNullable<BoardData["settings"]>;
  // Derived from `board` in `use-board-data.ts`, so non-null follows for the
  // same reason — narrowed here rather than there for the same boundary
  // reason as the three above.
  filteredOverflow: NonNullable<BoardData["filteredOverflow"]>;
};

/**
 * The two-half desktop board — ONLY the layout body. `DndContext`,
 * `Hotkeys`, `DragOverlay` and every sheet mount stay in the `Board` shell
 * (`board.tsx`), not here — that's what makes this the
 * `{Desktop,Phone}Board` seam the mobile plan's M3 needs: exactly one of
 * each regardless of which layout renders, so a future `PhoneBoard` can
 * never duplicate a droppable/draggable id into dnd-kit's id-keyed maps
 * (the documented failure mode behind `DaySheet`'s placement outside
 * `DndContext` in the shell). See docs/MOBILE.md's P2 entry.
 */
interface DesktopBoardProps {
  data: ReadyBoardData;
  ui: BoardUiState;
  actions: ReturnType<typeof useBoardActions>;
  navigate: NavigateFn;
  dayTrackRef: React.RefObject<HTMLDivElement | null>;
  anchorIndex: number;
  visibleCount: number;
  canJumpBack: (delta: number) => boolean;
  canJumpForward: (delta: number) => boolean;
  jumpBy: (delta: number) => void;
  jumpToIndex: (target: number) => void;
  jumpToToday: () => void;
}

const PINNED_PANEL = cn(
  "relative z-10 flex shrink-0 flex-col bg-card px-4",
  "border-r border-border shadow-[2px_0_6px_-2px_rgb(0_0_0/0.08)]",
  "[--column-min:var(--list-column-min)]",
);

const LOAD_MORE_STEP = 30;

export function DesktopBoard({
  data,
  ui,
  actions,
  navigate,
  dayTrackRef,
  anchorIndex,
  visibleCount,
  canJumpBack,
  canJumpForward,
  jumpBy,
  jumpToIndex,
  jumpToToday,
}: DesktopBoardProps) {
  const {
    todos,
    tabs,
    labels,
    archivedLists,
    archivedTabs,
    dayNotes,
    settings,
    ctx,
    board,
    trackSlots,
    backlogColumn,
    otherListColumns,
    filteredOverflow,
    filteredBacklogColumn,
    filteredListColumns,
    calendarCount,
    planningCount,
    mentionLists,
    deadlineCounts,
    overTodoId,
    overGroupId,
    columnDropTargetId,
    tabDrop,
    activeTabId,
    tabsById,
    recurrenceSummaries,
    recurrenceExpansion,
    subtaskCounts,
    overflowCollapsed,
    backlogCollapsed,
    renderedDays,
  } = data;

  const {
    activeTodo,
    activeList,
    collapsedGroups,
    toggleGroup,
    expandWeekend,
    columnFilters,
    setColumnFilter,
    landingTodoId,
    infoTabId,
    setInfoListId,
    setInfoTabId,
    setArchivedOpen,
    openTodoSheet,
    selectTab,
    cap,
    loadMoreDays,
    setOpenDay,
  } = ui;

  const { handleToggle, handleQuickAdd, handleCreateTab } = actions;

  const overflowWidth = settings?.overflowWidth ?? null;
  const backlogWidth = settings?.backlogWidth ?? null;
  const splitRatio = settings?.splitRatio ?? null;
  const splitCollapsed = settings?.splitCollapsed ?? "none";
  // Resizing mid-drag would invalidate every droppable rect dnd-kit cached at
  // drag start (§4.2 of DRAG-AND-DROP.md) — same reasoning as `rejectsDrop`.
  const railDisabled = !!activeTodo || !!activeList;

  const splitContainerRef = useRef<HTMLDivElement>(null);
  const calendarHalfRef = useRef<HTMLDivElement>(null);
  const planningHalfRef = useRef<HTMLDivElement>(null);
  const overflowPanelRef = useRef<HTMLDivElement>(null);
  const backlogPanelRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={splitContainerRef}
      // `overscroll-none`: kills iOS's whole-page rubber-band and
      // Android's pull-to-refresh at the shell boundary. Scoped to the
      // board specifically, not `html` — the marketing page has no
      // internal scroll containers competing with the page scroll, so it
      // has nothing to protect and no reason to opt out of the platform
      // default. See docs/MOBILE.md.
      className="flex h-dvh flex-col overscroll-none"
      style={
        splitRatio != null ? ({ "--split-top": String(splitRatio) } as CSSProperties) : undefined
      }
    >
      <SignedOutBanner hasUserData={todos.length > 0} />

      <AppHeader
        onOpenPalette={() => ui.setPaletteOpen(true)}
        onOpenSettings={() => ui.setSettingsOpen(true)}
        onOpenHelp={() => ui.setHelpSheetOpen(true)}
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

        Collapsed to a `SplitStrip` when `splitCollapsed === "calendar"` —
        `showCalendar` (wrapped into every `jumpBy`/`jumpToIndex`/
        `jumpToToday` above) is what re-expands it the moment a date nav
        gesture needs it back.
      */}
      {splitCollapsed === "calendar" ? (
        <SplitStrip
          label="Calendar"
          count={calendarCount}
          direction="down"
          onExpand={() => void mutateSettings(LOCAL_OWNER_ID, { splitCollapsed: "none" })}
        />
      ) : (
      <div
        ref={calendarHalfRef}
        className={cn(
          "flex min-h-0 basis-0 bg-border/40",
          splitCollapsed === "planning" ? "flex-1" : "grow-(--split-top)",
        )}
      >
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
            todos={filteredOverflow.todos}
            labels={labels}
            reminderPresets={data.reminderPresets}
            ctx={ctx}
            // Grouped like a day column — the origin of a stale to-do is as
            // useful as anything here. `rejectsDrop` below means its groups
            // register no droppable, so they read but do not receive.
            groups={filteredOverflow.groups}
            collapsedGroups={collapsedGroups}
            onToggleGroup={toggleGroup}
            onToggle={handleToggle}
            onOpen={(todo) => openTodoSheet(todo.id)}
            missedCounts={recurrenceExpansion?.missedCounts}
            recurrenceSummaries={recurrenceSummaries}
            subtaskCounts={subtaskCounts}
            // No `onQuickAdd`, so no quick-add row: nothing can be scheduled
            // INTO Overflow, only out of it.
            onNavigate={navigate}
            filter={columnFilters.get(board.overflow.id)}
            onFilterChange={(query) => setColumnFilter(board.overflow.id, query)}
            totalCount={board.overflow.todos.length}
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
            footer={
              <OverdriveButton
                count={board.overflow.todos.length}
                minTodos={settings?.overdriveMinTodos ?? OVERDRIVE_MIN_TODOS}
                onOpen={() => ui.setOverdriveOpen(true)}
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
                  //
                  // The sticky note is composed here for the same reason: it
                  // is a fact about this DAY, and BoardColumn does not know
                  // what its column is. Keeps the component free of a prop it
                  // would ignore on every list column.
                  subtitle={
                    <span className="num">
                      {label}
                      {dayNotes.has(column.day) && (
                        <>
                          <StickyNote
                            className="ml-1 inline-block size-3 align-[-0.125em] text-muted-foreground"
                            aria-hidden
                          />
                          <span className="sr-only"> — has notes</span>
                        </>
                      )}
                    </span>
                  }
                  onOpenInfo={() => setOpenDay(column.day)}
                  todos={column.todos}
                  labels={labels}
                  ctx={ctx}
                  dueCount={deadlineCounts.get(column.day)}
                  recurrenceSummaries={recurrenceSummaries}
                  subtaskCounts={subtaskCounts}
                  groups={column.groups}
                  collapsedGroups={collapsedGroups}
                  onToggleGroup={toggleGroup}
                  overGroupId={overGroupId}
                  emphasis={isToday}
                  onToggle={handleToggle}
                  onOpen={(todo) => openTodoSheet(todo.id)}
                  onQuickAdd={(title, listId, labelIds) =>
                    void handleQuickAdd(title, { day: column.day }, listId, labelIds)
                  }
                  lists={mentionLists}
                  reminderPresets={data.reminderPresets}
                  onNavigate={navigate}
                  filter={columnFilters.get(column.id)}
                  onFilterChange={(query) => setColumnFilter(column.id, query)}
                  totalCount={board.days.find((d) => d.id === column.id)?.todos.length}
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
      )}

      {splitCollapsed === "none" && (
        <SplitHandle
          containerRef={splitContainerRef}
          calendarRef={calendarHalfRef}
          planningRef={planningHalfRef}
          storedSplit={splitRatio}
          disabled={railDisabled}
          onSplitChange={(percent) => void mutateSettings(LOCAL_OWNER_ID, { splitRatio: percent })}
          onCollapse={(half) => void mutateSettings(LOCAL_OWNER_ID, { splitCollapsed: half })}
        />
      )}

      {/* Planning half */}
      {splitCollapsed === "planning" ? (
        <SplitStrip
          label="Lists"
          count={planningCount}
          direction="up"
          onExpand={() => void mutateSettings(LOCAL_OWNER_ID, { splitCollapsed: "none" })}
        />
      ) : (
      <div
        ref={planningHalfRef}
        className={cn(
          "flex min-h-0 basis-0 bg-muted/30",
          splitCollapsed === "calendar" ? "flex-1" : "grow-[calc(100_-_var(--split-top))]",
        )}
      >
        {filteredBacklogColumn && (
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
              id={filteredBacklogColumn.id}
              title={filteredBacklogColumn.list.name}
              todos={filteredBacklogColumn.todos}
              labels={labels}
              ctx={ctx}
              awayTodoIds={board.awayTodoIds}
              onToggle={handleToggle}
              onOpen={(todo) => openTodoSheet(todo.id)}
              onQuickAdd={(title, listId, labelIds) =>
                void handleQuickAdd(
                  title,
                  { listId: filteredBacklogColumn.list.id },
                  listId,
                  labelIds,
                )
              }
              lists={mentionLists}
              reminderPresets={data.reminderPresets}
              onNavigate={navigate}
              filter={columnFilters.get(filteredBacklogColumn.id)}
              onFilterChange={(query) => setColumnFilter(filteredBacklogColumn.id, query)}
              totalCount={backlogColumn?.todos.length}
              minRows={5}
              isDragActive={!!activeTodo}
              overTodoId={overTodoId}
              landingTodoId={landingTodoId}
              recurrenceSummaries={recurrenceSummaries}
              subtaskCounts={subtaskCounts}
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
            isListDragActive={!!activeList}
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
              {/*
                Index-zipped with `otherListColumns`, not a second `.find`:
                both arrays come from the same `.map` in use-board-data.ts, so
                they stay index-aligned by construction — see `filteredListColumns`.
              */}
              {filteredListColumns.map((column, i) => (
                <BoardColumn
                  key={column.id}
                  id={column.id}
                  title={column.list.name}
                  todos={column.todos}
                  labels={labels}
                  ctx={ctx}
                  awayTodoIds={board.awayTodoIds}
                  onToggle={handleToggle}
                  onOpen={(todo) => openTodoSheet(todo.id)}
                  onQuickAdd={(title, listId, labelIds) =>
                    void handleQuickAdd(title, { listId: column.list.id }, listId, labelIds)
                  }
                  lists={mentionLists}
                  reminderPresets={data.reminderPresets}
                  onNavigate={navigate}
                  filter={columnFilters.get(column.id)}
                  onFilterChange={(query) => setColumnFilter(column.id, query)}
                  totalCount={otherListColumns[i]?.todos.length}
                  minRows={5}
                  isDragActive={!!activeTodo}
                  overTodoId={overTodoId}
                  landingTodoId={landingTodoId}
                  recurrenceSummaries={recurrenceSummaries}
                  subtaskCounts={subtaskCounts}
                  reorderListId={column.list.id}
                  reservesGripSlot
                  onOpenInfo={() => setInfoListId(column.list.id)}
                  isColumnDropTarget={columnDropTargetId === column.list.id}
                  isColumnDragActive={!!activeList}
                  // The list's own color wins, falling back to its tab's. A
                  // list you have deliberately colored should look colored in
                  // both halves — and the tab accent still covers every list
                  // you have not, so "these columns belong together" survives.
                  accentColor={effectiveListColor(column.list, tabsById)}
                />
              ))}
              <CreateListColumn tabId={activeTabId} onNavigate={navigate} />
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
