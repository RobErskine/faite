"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
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
import { GripVertical } from "lucide-react";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { List, Tab, Todo } from "@/lib/schema";
import {
  buildBoard,
  parseColumnId,
  parseListDragId,
  parseTabDragId,
  parseTabDropId,
  planListDrop,
  planTabDrop,
  preferPreciseTarget,
} from "@/lib/board";
import {
  FLIGHT_MS,
  LIFTED,
  readLandingRect,
  runLandingDropAnimation,
} from "@/lib/drop-animation";
import { tint } from "@/lib/colors";
import { positionForIndex } from "@/lib/ordering";
import { OVERFLOW, formatDay } from "@/lib/scheduling";
import { FONT_STORAGE_KEY } from "@/lib/fonts";
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
  listPatch,
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
import { ArchivedListsSheet } from "./archived-lists-sheet";
import { BoardColumn } from "./board-column";
import { ColumnInfoButton } from "./column-info-button";
import { CreateListColumn } from "./create-list-column";
import { ListInfoDialog } from "./list-info-dialog";
import {
  archiveListWithUndo,
  deleteListWithUndo,
  renameListWithUndo,
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

/**
 * How long a card must hover a tab before it focuses.
 *
 * Long enough that sweeping across the strip on the way somewhere else does
 * not cycle through every tab, short enough that it does not feel stuck. The
 * gesture is only discoverable once it fires, so erring long would hide it.
 */
const TAB_FOCUS_DWELL_MS = 600;

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
  const ctx = usePlacementContext(settings);

  const [activeTodo, setActiveTodo] = useState<Todo | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [openTodoId, setOpenTodoId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** The list whose settings dialog is open, if any. */
  const [infoListId, setInfoListId] = useState<string | null>(null);
  /** The tab whose settings dialog is open, if any. */
  const [infoTabId, setInfoTabId] = useState<string | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);

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
        paletteOpen || !!openTodoId || !!infoListId || !!infoTabId || archivedOpen,
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

  const sensors = useSensors(
    // A small activation distance keeps clicks and drags distinguishable, and
    // makes touch dragging usable inside a Capacitor WebView later.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
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
   */
  const hiddenListIds = useMemo(
    () =>
      new Set(
        lists.filter((l) => !l.isBacklog && l.tabId !== activeTabId).map((l) => l.id),
      ),
    [lists, activeTabId],
  );

  const board = useMemo(
    () => (ctx ? buildBoard(visibleTodos, tabLists, ctx, hiddenListIds) : null),
    [visibleTodos, tabLists, ctx, hiddenListIds],
  );

  /**
   * `over` is either a column or a card. Only a card gives us a precise
   * insertion point; a column means "append to the end".
   *
   * The dragged card is excluded so the indicator never renders above the item
   * being moved, which would suggest a no-op drop.
   */
  const overTodoId = useMemo(() => {
    if (!overId || !activeTodo || overId === activeTodo.id) return null;
    return parseColumnId(overId) ? null : overId;
  }, [overId, activeTodo]);

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
        const forward = schedulePatch(target.day, position);
        pushUndo(`Scheduled “${short(todo.title)}”`, [
          { kind: "todo", entityId: todo.id, patch: inversePatch(todo, forward) },
        ]);
        await scheduleTodo(todo.id, target.day, position);
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
  const handleRenameList = useCallback(
    (id: string, name: string) => {
      const before = lists.find((l) => l.id === id);
      if (before) renameListWithUndo(before, name);
    },
    [lists],
  );

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
        <AppHeader onOpenPalette={() => setPaletteOpen(true)} />

        {/* Calendar half */}
        <div className="column-track flex flex-1 gap-px border-b bg-border/40 px-4 pt-4">
          <BoardColumn
            id={board.overflow.id}
            title="Overflow"
            subtitle="Put off too long"
            todos={board.overflow.todos}
            labels={labels}
            ctx={ctx}
            onToggle={handleToggle}
            onOpen={(todo) => setOpenTodoId(todo.id)}
            onQuickAdd={() => {}}
            emphasis
            isDragActive={!!activeTodo}
            overTodoId={overTodoId}
            landingTodoId={landingTodoId}
            rejectsDrop
          />
          {board.days.map((column) => {
            const { weekday, label } = formatDay(column.day);
            const isToday = column.day === ctx.today;
            return (
              <BoardColumn
                key={column.id}
                id={column.id}
                title={weekday}
                // `subtitle` also carries prose on other columns, so the
                // numeral face is applied here rather than in BoardColumn.
                subtitle={<span className="num">{label}</span>}
                todos={column.todos}
                labels={labels}
                ctx={ctx}
                emphasis={isToday}
                onToggle={handleToggle}
                onOpen={(todo) => setOpenTodoId(todo.id)}
                onQuickAdd={(title) => void handleQuickAdd(title, { day: column.day })}
                isDragActive={!!activeTodo}
                overTodoId={overTodoId}
                landingTodoId={landingTodoId}
              />
            );
          })}
        </div>

        {/* Planning half */}
        <div className="flex flex-[0.8] flex-col bg-muted/30">
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
            The wider floor is set on the TRACK, not on each column: every
            column inside reads `--column-min`, so overriding it here widens
            the whole half without threading a size prop through BoardColumn.
          */}
          <div className="column-track flex flex-1 gap-px bg-border/40 px-4 pt-3 [--column-min:var(--list-column-min)]">
            {board.lists.map((column) => (
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
                minRows={5}
                isDragActive={!!activeTodo}
                overTodoId={overTodoId}
                landingTodoId={landingTodoId}
                // Backlog is pinned leftmost, so it gets no reorder handle.
                reorderListId={column.list.isBacklog ? undefined : column.list.id}
                reservesGripSlot
                // Backlog has nothing to offer here either: it cannot be
                // renamed, archived, or deleted, and a button whose every
                // action is disabled is worse than no button.
                actions={
                  column.list.isBacklog ? undefined : (
                    <ColumnInfoButton
                      listName={column.list.name}
                      isOpen={infoListId === column.list.id}
                      onOpen={() => setInfoListId(column.list.id)}
                    />
                  )
                }
                columnDropSide={
                  columnDrop?.listId === column.list.id ? columnDrop.side : null
                }
                isColumnDragActive={!!activeList}
                // Backlog belongs to no tab, so it stays neutral while the
                // columns around it carry the current tab's colour. That
                // difference is also the clearest signal that it is shared.
                accentColor={column.list.isBacklog ? null : activeTabRecord?.color}
              />
            ))}
            <CreateListColumn tabId={activeTabId} />
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
            style={LIFTED}
            className={cn(
              "flex max-w-xs cursor-grabbing items-center gap-2 rounded-md border",
              "bg-background px-2 py-1.5 text-sm shadow-xl ring-2 ring-primary/40",
            )}
          >
            <GripVertical className="size-3 shrink-0 text-muted-foreground" aria-hidden />
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
        onRename={handleRenameList}
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
    if (day.todos.some((t) => t.id === todoId)) {
      return { target: { kind: "day" as const, day: day.day }, todos: day.todos };
    }
  }
  if (board.overflow.todos.some((t) => t.id === todoId)) {
    return { target: { kind: "overflow" as const }, todos: board.overflow.todos };
  }
  for (const column of board.lists) {
    if (column.todos.some((t) => t.id === todoId)) {
      return {
        target: { kind: "list" as const, listId: column.list.id },
        todos: column.todos,
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
