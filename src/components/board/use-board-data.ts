"use client";

import { useMemo, useCallback } from "react";
import type { List, Tab, Todo } from "@/lib/schema";
import {
  buildBoard,
  parseColumnId,
  parseDayGroupId,
  parseTabDropId,
  planListDrop,
  planTabDrop,
  type TodoGroup,
} from "@/lib/board";
import {
  NAV_LOAD_MORE,
  buildNavGrid,
  cardItems,
  type NavGrid,
  type NavItem,
} from "@/lib/column-nav";
import { OVERFLOW, daysBetween, todayIn } from "@/lib/scheduling";
import { isRecurrenceTemplate } from "@/lib/recurrence-expand";
import { expandRecurrences } from "@/lib/recurrence-expand";
import { parseRule, summarizeRule } from "@/lib/recurrence";
import {
  calendarSpanFor,
  groupWeekendRuns,
  weekendDaysFrom,
  type TrackSlot,
} from "./weekend-runs";
import {
  useArchivedLists,
  useArchivedTabs,
  useBootstrap,
  useDayNotes,
  useLabels,
  useLists,
  usePlacementContext,
  usePlaces,
  useProjects,
  useRecurrenceChildren,
  useSettings,
  useTabs,
  useTodoEvents,
  useTodos,
} from "@/lib/store/hooks";
import { DEFAULT_TAB_ID } from "@/lib/store/repositories";

/** `settingsSchema.workdays`' default, for reads that land before Dexie does. */
const DEFAULT_WORKDAYS = [1, 2, 3, 4, 5];

/**
 * Pass A of the `board.tsx` extraction (docs/ARCHITECTURE.md, mobile plan
 * P2) — every derived value the board renders from.
 *
 * NOT argument-free, and that's a deliberate departure from a "pure data,
 * zero inputs" ideal: several of these derivations (`overTodoId`,
 * `overGroupId`, `columnDrop`, `tabDrop`, `navGrid`, `openTodo`) exist to
 * answer "given what's currently being interacted with, what should render"
 * — they're pure functions of state, just not of THIS hook's own state.
 * Rather than force them into `use-board-ui-state.ts` (which would need to
 * reach back into `buildBoard()` output it has no business owning) or
 * duplicate them in the shell, they take the interaction-state values they
 * need as parameters. `useBoardActions` and the `Board` shell both already
 * hold a `BoardUiState`, so passing its relevant fields through costs
 * nothing but naming them.
 */
export interface UseBoardDataParams {
  activeTodo: Todo | null;
  overId: string | null;
  activeList: List | null;
  activeTab: Tab | null;
  infoListId: string | null;
  infoTabId: string | null;
  openTodoId: string | null;
  collapsedGroups: ReadonlySet<string>;
  expandedWeekends: ReadonlySet<string>;
  horizon: number;
  cap: number;
  /**
   * `useViewport()`'s layout class (mobile plan M3) — the ONE read-time
   * override this hook makes, never a write: a collapsed weekend strip is a
   * 40px sliver that reads fine next to six other columns, and reads as
   * broken as an entire full-bleed pager page. `collapsingWeekends` below
   * ignores `settings.showWeekends` outright on phone rather than gating
   * the strip's rendering in `PhoneBoard` — cheaper, and it also keeps
   * `trackSlots`/`navGrid`/`dayIds` internally consistent with what
   * actually renders, rather than one flag two different layers.
   */
  layout: "phone" | "tablet" | "desktop";
}

export function useBoardData(params: UseBoardDataParams) {
  const {
    activeTodo,
    overId,
    activeList,
    activeTab,
    infoListId,
    infoTabId,
    openTodoId,
    collapsedGroups,
    expandedWeekends,
    horizon,
    cap,
    layout,
  } = params;

  const ready = useBootstrap();
  const todos = useTodos();
  const recurrenceChildren = useRecurrenceChildren();
  const lists = useLists();
  const archivedLists = useArchivedLists();
  const tabs = useTabs();
  const archivedTabs = useArchivedTabs();
  const labels = useLabels();
  const projects = useProjects();
  const places = usePlaces();
  const settings = useSettings();
  const dayNotes = useDayNotes();
  const todoEvents = useTodoEvents(openTodoId);

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

  /** Derived for the same reason as `openTodo` below — a snapshot would go stale. */
  const infoList = useMemo(
    () => lists.find((l) => l.id === infoListId) ?? null,
    [lists, infoListId],
  );

  /** Derived for the same reason as `openTodo` below — a snapshot would go stale. */
  const infoTab = useMemo(
    () => tabs.find((t) => t.id === infoTabId) ?? null,
    [tabs, infoTabId],
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
   * `visibleTodos` split into recurrence templates (never rendered directly —
   * see `lib/recurrence-expand.ts`) and everything else. Everything downstream
   * that used to read `visibleTodos` for window sizing or search reads
   * `nonTemplateTodos` instead, so a template can never grow the window or
   * turn up as a search result.
   */
  const { templates, nonTemplateTodos } = useMemo(() => {
    const templates: Todo[] = [];
    const nonTemplateTodos: Todo[] = [];
    for (const t of visibleTodos) {
      (isRecurrenceTemplate(t) ? templates : nonTemplateTodos).push(t);
    }
    return { templates, nonTemplateTodos };
  }, [visibleTodos]);

  /**
   * "Every week on Fri", keyed by template id — for the card's repeat-icon
   * tooltip (`todo-card.tsx`). One entry per SERIES, not per occurrence:
   * cards only ever carry `recurrenceParentId`, never the rule itself, so
   * every card in a series shares the same lookup.
   */
  const recurrenceSummaries = useMemo(() => {
    const map = new Map<string, string>();
    for (const template of templates) {
      const rule = parseRule(template.recurrenceRule);
      if (rule && template.scheduledDate) {
        map.set(template.id, summarizeRule(rule, template.scheduledDate));
      }
    }
    return map;
  }, [templates]);

  /**
   * How many day columns to render: always at least `DEFAULT_RENDERED_DAYS`
   * (`horizon`'s initial value in `use-board-ui-state.ts`), always enough to
   * hold the furthest-out scheduled todo — growing the window as a SIDE
   * EFFECT of scrolling would silently drain cards out of their lists as the
   * user looked further ahead, with no way back — and always at least
   * `settings.visibleDays` (the ⌘K toggle's floor). All three are clamped to
   * `cap`, past which `deriveColumn` in scheduling.ts falls back to showing
   * the todo dimmed in its list — the load-more tile at the end of the day
   * track is how the user reaches it from there.
   *
   * Built from `nonTemplateTodos`, not `visibleTodos` or the expanded board:
   * a recurring series must NEVER grow this window. A daily series always has
   * an occurrence sitting at the window's edge, so growing the window in
   * response would grow it again next render, settling only at `cap`.
   */
  const todayCivil = useMemo(
    () => (settings ? todayIn(settings.timezone) : null),
    [settings],
  );
  const furthestScheduledOffset = useMemo(() => {
    if (!todayCivil) return 0;
    let furthest: string | null = null;
    for (const t of nonTemplateTodos) {
      if (t.status === "open" && t.scheduledDate && (!furthest || t.scheduledDate > furthest)) {
        furthest = t.scheduledDate;
      }
    }
    return furthest ? daysBetween(todayCivil, furthest) + 1 : 0;
  }, [nonTemplateTodos, todayCivil]);

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
  const collapsingWeekends = layout !== "phone" && settings?.showWeekends === false;
  const minDays = useMemo(() => {
    const wanted = settings?.visibleDays ?? 7;
    if (!collapsingWeekends || !todayCivil) return wanted;
    return calendarSpanFor(todayCivil, wanted, weekendDays);
  }, [settings?.visibleDays, collapsingWeekends, todayCivil, weekendDays]);

  const renderedDays = todayCivil
    ? Math.min(cap, Math.max(minDays, horizon, furthestScheduledOffset))
    : minDays;

  const ctx = usePlacementContext(settings, renderedDays);

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

  /**
   * Every real, non-template todo — INCLUDING settled and tombstoned
   * materialized occurrences, which `nonTemplateTodos` (built on `useTodos()`)
   * does not carry. Settlement detection in `expandRecurrences` needs to see
   * a deleted occurrence to know a series moved past it.
   *
   * `recurrenceChildren` and `nonTemplateTodos` scan the same table, so an
   * untouched, non-tombstoned occurrence appears in both — deduped by id.
   */
  const realTodosForExpansion = useMemo(() => {
    if (recurrenceChildren.length === 0) return nonTemplateTodos;
    const ids = new Set(nonTemplateTodos.map((t) => t.id));
    const extra = recurrenceChildren.filter((c) => !ids.has(c.id));
    return extra.length > 0 ? [...nonTemplateTodos, ...extra] : nonTemplateTodos;
  }, [nonTemplateTodos, recurrenceChildren]);

  /**
   * Recurrence templates expanded into the occurrences the board actually
   * renders — see `lib/recurrence-expand.ts`. Computed downstream of `ctx`,
   * deliberately NOT folded into `nonTemplateTodos`/`furthestScheduledOffset`
   * above: see that comment for why.
   */
  const recurrenceExpansion = useMemo(
    () => (ctx ? expandRecurrences(templates, realTodosForExpansion, ctx) : null),
    [templates, realTodosForExpansion, ctx],
  );

  const visibleStatuses = settings?.visibleStatuses;
  const board = useMemo(
    () =>
      ctx
        ? buildBoard(
            recurrenceExpansion?.todos ?? nonTemplateTodos,
            tabLists,
            ctx,
            hiddenLists,
            { visibleStatuses, forceOverflow: recurrenceExpansion?.forceOverflow },
          )
        : null,
    [recurrenceExpansion, nonTemplateTodos, tabLists, ctx, hiddenLists, visibleStatuses],
  );

  /**
   * Every id a card, drag, or sheet gesture might name — real rows, virtual
   * recurrence occurrences, and force-overflowed occurrences alike — so every
   * `todos.find(...)` call site that used to miss a virtual card can resolve
   * one instead. `todos` covers real rows (including templates themselves,
   * harmlessly); the other two only exist inside `recurrenceExpansion`.
   */
  const todosById = useMemo(() => {
    const map = new Map<string, Todo>();
    for (const t of todos) map.set(t.id, t);
    if (recurrenceExpansion) {
      for (const t of recurrenceExpansion.todos) map.set(t.id, t);
      for (const t of recurrenceExpansion.forceOverflow) map.set(t.id, t);
    }
    return map;
  }, [todos, recurrenceExpansion]);

  /** Ids with a real Dexie row — anything else is virtual and needs materializing first. */
  const rawTodoIds = useMemo(() => new Set(todos.map((t) => t.id)), [todos]);

  /**
   * The open todo is DERIVED, never snapshotted.
   *
   * Holding the Todo object in state let the sheet drift from the store: an
   * edit made in the sheet, or an undo applied to it, left the fields showing
   * the values as of the moment it opened. Worse for undo — an entry built
   * from a stale object reverses stale values, so toggling two labels and
   * pressing ⌘Z once would strip both.
   *
   * Resolved through `todosById` rather than `todos.find`, so a virtual or
   * force-overflowed recurrence occurrence opens its sheet too.
   */
  const openTodo = useMemo(
    () => (openTodoId ? todosById.get(openTodoId) ?? null : null),
    [todosById, openTodoId],
  );

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

  /** To-do counts for the two `SplitStrip`s — everything in the half, pinned column included. */
  const calendarCount = useMemo(
    () =>
      (board?.overflow.todos.length ?? 0) +
      (board?.days.reduce((sum, c) => sum + c.todos.length, 0) ?? 0),
    [board],
  );
  const planningCount = useMemo(
    () =>
      (backlogColumn?.todos.length ?? 0) +
      otherListColumns.reduce((sum, c) => sum + c.todos.length, 0),
    [backlogColumn, otherListColumns],
  );

  /**
   * Every list a todo could point at, for the day sheet's timeline colours.
   *
   * Includes ARCHIVED lists on purpose: a todo finished last week whose list has
   * since been filed still happened, and the timeline losing its colour would
   * make it look like it never belonged anywhere.
   */
  const listsById = useMemo(
    () => new Map([...lists, ...archivedLists].map((list) => [list.id, list])),
    [lists, archivedLists],
  );

  /** The fallback for a homeless todo, mirroring `groupTodosByList`'s `?? backlog`. */
  const backlogList = useMemo(() => lists.find((l) => l.isBacklog), [lists]);

  /**
   * Quick-add's "@list" mention candidates, color-resolved up front — a list
   * without its own color falls back to its tab's, the same rule `accentColor`
   * applies at each `BoardColumn` call site below. Resolved here rather than
   * inside `BoardColumn` because a mention list can belong to ANY tab, not
   * just the active one, so the fallback needs the full `tabsById` map, not
   * just `activeTabRecord`.
   */
  const tabsById = useMemo(() => new Map(tabs.map((t) => [t.id, t])), [tabs]);
  const mentionLists = useMemo(
    () =>
      lists.map((list) => ({
        id: list.id,
        name: list.name,
        color: list.color ?? (list.tabId ? (tabsById.get(list.tabId)?.color ?? null) : null),
      })),
    [lists, tabsById],
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

  const overflowCollapsed = settings?.overflowCollapsed ?? false;
  const backlogCollapsed = settings?.backlogCollapsed ?? false;

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
    // `nonTemplateTodos`, not `visibleTodos`: a recurrence template must never
    // contribute a deadline badge that would otherwise repeat on every
    // occurrence's date. Occurrences never carry a deadline of their own
    // (`cloneOccurrence` nulls it), so this changes nothing else.
    for (const todo of nonTemplateTodos) {
      if (!todo.deadline || todo.status !== "open") continue;
      counts.set(todo.deadline, (counts.get(todo.deadline) ?? 0) + 1);
    }
    return counts;
  }, [nonTemplateTodos]);

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

  /**
   * Where the dragged column would land, recomputed as the pointer moves.
   *
   * Derived rather than stored so the indicator and the write cannot disagree:
   * `handleDragEnd` (`use-board-actions.ts`) calls the same `planListDrop`
   * with the same inputs.
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

  return {
    ready,
    todos,
    recurrenceChildren,
    lists,
    archivedLists,
    tabs,
    archivedTabs,
    labels,
    projects,
    places,
    settings,
    dayNotes,
    todoEvents,
    activeTabId,
    activeTabRecord,
    infoList,
    infoTab,
    visibleTodos,
    templates,
    nonTemplateTodos,
    recurrenceSummaries,
    todayCivil,
    weekendDays,
    collapsingWeekends,
    minDays,
    renderedDays,
    ctx,
    tabLists,
    hiddenLists,
    recurrenceExpansion,
    board,
    todosById,
    rawTodoIds,
    openTodo,
    trackSlots,
    backlogColumn,
    otherListColumns,
    calendarCount,
    planningCount,
    listsById,
    backlogList,
    tabsById,
    mentionLists,
    navGrid,
    dayIds,
    deadlineCounts,
    overTodoId,
    overGroupId,
    columnDrop,
    columnDropTargetId,
    tabDrop,
    overflowCollapsed,
    backlogCollapsed,
  };
}

export type BoardData = ReturnType<typeof useBoardData>;

export { NAV_LOAD_MORE, OVERFLOW };
