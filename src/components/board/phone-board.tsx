"use client";

import { useRef } from "react";
import { StickyNote } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { effectiveListColor } from "@/lib/colors";
import { NAV_LOAD_MORE, navKeyOf } from "@/lib/column-nav";
import { formatDay } from "@/lib/scheduling";
import { OVERDRIVE_MIN_TODOS } from "@/lib/overdrive";
import { AppHeader } from "./app-header";
import { SignedOutBanner } from "@/components/auth/signed-out-banner";
import { BoardColumn } from "./board-column";
import { BoardEmptyBanner } from "./board-empty-banner";
import { CreateListColumn } from "./create-list-column";
import { DateNav } from "./date-nav";
import { OverdriveButton } from "./overdrive-button";
import { TabStrip } from "./tab-strip";
import { PhoneBottomBar } from "./phone-bottom-bar";
import type { BoardUiState } from "./use-board-ui-state";
import type { useBoardActions } from "./use-board-actions";
import type { NavigateFn } from "./use-column-nav";
import type { ReadyBoardData } from "./desktop-board";

/**
 * The phone shell (mobile plan M3) — one full-width column at a time, paged
 * through with native CSS scroll-snap rather than a JS carousel. See
 * docs/GESTURES.md for why scroll-snap specifically (dnd-kit's droppable
 * rect correction needs a real `scrollLeft`, which a transform-based
 * carousel doesn't have) and docs/MOBILE.md §9 for why the "swipe up/down
 * between lists and days" request became the bottom bar below instead.
 *
 * Same seam contract as `DesktopBoard` (see its own doc comment): only the
 * layout body. `DndContext`/`Hotkeys`/`DragOverlay`/every sheet mount stay
 * in the `Board` shell.
 */
interface PhoneBoardProps {
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

const LOAD_MORE_STEP = 30;

export function PhoneBoard({
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
}: PhoneBoardProps) {
  const {
    todos,
    tabs,
    labels,
    archivedLists,
    archivedTabs,
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
    tabCounts,
    mentionLists,
    deadlineCounts,
    overTodoId,
    overGroupId,
    columnDropTargetId,
    listDayDrop,
    movingIds,
    tabDrop,
    activeTabId,
    tabsById,
    recurrenceSummaries,
    recurrenceExpansion,
    subtaskCounts,
    attachmentCounts,
    renderedDays,
  } = data;

  const {
    activeTodo,
    activeList,
    collapsedGroups,
    toggleGroup,
    columnFilters,
    setColumnFilter,
    landingTodoIds,
    selectedIds,
    infoTabId,
    setInfoListId,
    setInfoTabId,
    setArchivedOpen,
    openTodoSheet,
    selectTab,
    cap,
    loadMoreDays,
    setOpenDay,
    setPaletteOpen,
    setSettingsOpen,
    setHelpSheetOpen,
    setOverdriveOpen,
    phoneView,
    setPhoneView,
    dragging,
  } = ui;

  const { handleToggle, handleQuickAdd, handleCreateTab } = actions;

  // The Lists pager has no jump/scroll-position consumer outside this
  // component (no date to jump to), so it keeps its own local ref rather
  // than being hoisted to the shell the way `dayTrackRef` is.
  const listTrackRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex h-dvh flex-col overscroll-none">
      <SignedOutBanner hasUserData={todos.length > 0} />

      <AppHeader
        compact
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenHelp={() => setHelpSheetOpen(true)}
        settings={settings}
      />

      {/*
        Above both pagers, not inside either — it has to read the same
        whether the Days or Lists page is active, and neither pager alone
        knows about the other's count. See `BoardEmptyBanner`'s own comment.
      */}
      {calendarCount === 0 && planningCount === 0 && <BoardEmptyBanner />}

      {phoneView === "days" && (
        <DateNav
          compact
          settings={settings}
          today={ctx.today}
          anchorIndex={anchorIndex}
          visibleCount={visibleCount}
          canJumpBack={canJumpBack}
          canJumpForward={canJumpForward}
          onJump={jumpBy}
          onJumpToDate={jumpToIndex}
          onToday={jumpToToday}
          onOpenActivity={() => ui.setActivityOpen(true)}
        />
      )}

      <div className="min-h-0 flex-1">
        {phoneView === "days" ? (
          <div
            ref={dayTrackRef}
            // Set directly from `ui.dragging`, read by the `[data-dragging]`
            // rule on `column-track-pager` (globals.css) — suspends the
            // mandatory snap type for the duration of a drag so it can't
            // fight dnd-kit's own scroll compensation near a page edge.
            data-dragging={dragging ? "" : undefined}
            className="column-track-pager flex h-full"
          >
            {/* Overflow — page −1. Pinned on desktop as a fixed sibling
                outside the scrolling track; on phone it's simply the first
                page IN the track, since there's no "outside" to pin it to. */}
            <BoardColumn
              className="pager-column"
              id={board.overflow.id}
              title="Overflow"
              subtitle="Put off too long"
              todos={filteredOverflow.todos}
              labels={labels}
              reminderPresets={data.reminderPresets}
              ctx={ctx}
              timezone={settings?.timezone ?? "UTC"}
              groups={filteredOverflow.groups}
              collapsedGroups={collapsedGroups}
              onToggleGroup={toggleGroup}
              onToggle={handleToggle}
              onOpen={(todo) => openTodoSheet(todo.id)}
              missedCounts={recurrenceExpansion?.missedCounts}
              recurrenceSummaries={recurrenceSummaries}
              subtaskCounts={subtaskCounts}
              attachmentCounts={attachmentCounts}
              onNavigate={navigate}
              filter={columnFilters.get(board.overflow.id)}
              onFilterChange={(query) => setColumnFilter(board.overflow.id, query)}
              totalCount={board.overflow.todos.length}
              emphasis
              isDragActive={!!activeTodo}
              overTodoId={overTodoId}
              landingTodoIds={landingTodoIds}
                  selectedIds={selectedIds}
                  movingIds={movingIds}
                  onSelect={actions.handleSelect}
              rejectsDrop
              footer={
                <OverdriveButton
                  count={board.overflow.todos.length}
                  minTodos={settings?.overdriveMinTodos ?? OVERDRIVE_MIN_TODOS}
                  onOpen={() => setOverdriveOpen(true)}
                />
              }
            />
            {trackSlots.map((slot) => {
              // Unreachable on phone: `useBoardData` forces
              // `collapsingWeekends` false whenever `layout === "phone"`
              // (see its comment), so `trackSlots` never contains a
              // "weekend" slot here. Guarded anyway because the type is a
              // union either way, and a full second WeekendColumn render
              // path isn't worth maintaining for a case that can't occur.
              if (slot.kind === "weekend") return null;
              const { column } = slot;
              const { weekday, label } = formatDay(column.day);
              const isToday = column.day === ctx.today;
              return (
                <BoardColumn
                  key={column.id}
                  className="pager-column"
                  id={column.id}
                  dayTrackColumn
                  // EI-193: a list dragged over this day will schedule its
                  // unscheduled to-dos onto it. Reuses the column-drag chrome
                  // the planning half already has; `count > 0` keeps a day
                  // where nothing would move unhighlighted, so the outline
                  // never promises a write that will not happen.
                  isColumnDragActive={!!activeList}
                  isColumnDropTarget={
                    listDayDrop?.day === column.day && listDayDrop.count > 0
                  }
                  title={weekday}
                  subtitle={
                    <span className="num">
                      {label}
                      {data.dayNotes.has(column.day) && (
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
                  timezone={settings?.timezone ?? "UTC"}
                  dueCount={deadlineCounts.get(column.day)}
                  recurrenceSummaries={recurrenceSummaries}
                  subtaskCounts={subtaskCounts}
                  attachmentCounts={attachmentCounts}
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
                  landingTodoIds={landingTodoIds}
                  selectedIds={selectedIds}
                  movingIds={movingIds}
                  onSelect={actions.handleSelect}
                />
              );
            })}
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
                  "pager-column flex shrink-0 flex-col items-center justify-center",
                  "border border-dashed border-border px-2 text-center text-sm text-muted-foreground",
                  "transition-colors hover:border-foreground/30 hover:bg-background/60 hover:text-foreground",
                  "focus-visible:outline-2 focus-visible:outline-ring",
                )}
              >
                Load {LOAD_MORE_STEP} more days
              </button>
            )}
          </div>
        ) : (
          <div className="flex h-full flex-col">
            <TabStrip
              tabs={tabs}
              activeTabId={activeTabId}
              archivedCount={archivedLists.length + archivedTabs.length}
              counts={tabCounts}
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
            <div
              ref={listTrackRef}
              data-dragging={dragging ? "" : undefined}
              className="column-track-pager flex h-full flex-1"
            >
              {filteredBacklogColumn && (
                <BoardColumn
                  className="pager-column"
                  id={filteredBacklogColumn.id}
                  title={filteredBacklogColumn.list.name}
                  todos={filteredBacklogColumn.todos}
                  labels={labels}
                  ctx={ctx}
                  timezone={settings?.timezone ?? "UTC"}
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
                  isDragActive={!!activeTodo}
                  overTodoId={overTodoId}
                  landingTodoIds={landingTodoIds}
                  selectedIds={selectedIds}
                  movingIds={movingIds}
                  onSelect={actions.handleSelect}
                  recurrenceSummaries={recurrenceSummaries}
                  subtaskCounts={subtaskCounts}
                  attachmentCounts={attachmentCounts}
                  isColumnDragActive={!!activeList}
                  accentColor={null}
                />
              )}
              {/*
                Index-zipped with `otherListColumns` — see the desktop
                board's identical comment. Both arrays share one `.map` in
                use-board-data.ts, so they stay aligned by construction.
              */}
              {filteredListColumns.map((column, i) => (
                <BoardColumn
                  key={column.id}
                  className="pager-column"
                  id={column.id}
                  title={column.list.name}
                  todos={column.todos}
                  labels={labels}
                  ctx={ctx}
                  timezone={settings?.timezone ?? "UTC"}
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
                  isDragActive={!!activeTodo}
                  overTodoId={overTodoId}
                  landingTodoIds={landingTodoIds}
                  selectedIds={selectedIds}
                  movingIds={movingIds}
                  onSelect={actions.handleSelect}
                  recurrenceSummaries={recurrenceSummaries}
                  subtaskCounts={subtaskCounts}
                  attachmentCounts={attachmentCounts}
                  reorderListId={column.list.id}
                  onOpenInfo={() => setInfoListId(column.list.id)}
                  isColumnDropTarget={columnDropTargetId === column.list.id}
                  isColumnDragActive={!!activeList}
                  accentColor={effectiveListColor(column.list, tabsById)}
                />
              ))}
              <CreateListColumn
                className="pager-column"
                tabId={activeTabId}
                onNavigate={navigate}
              />
            </div>
          </div>
        )}
      </div>

      <PhoneBottomBar view={phoneView} onSelectView={setPhoneView} />
    </div>
  );
}
