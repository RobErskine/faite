"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TodoGroup } from "@/lib/board";
import type { ConfettiOrigin } from "@/lib/celebrate";
import { cardStop } from "@/lib/column-nav";
import {
  BEAT_MS,
  GIVE_UP_MS,
  LEAVE_MS,
  beatOutcome,
  heldSnapshot,
  holdGroups,
  holdRows,
  neighborsOf,
  type HeldRow,
} from "@/lib/completion-beat";
import { prefersReducedMotion } from "@/lib/reduced-motion";
import type { Todo } from "@/lib/schema";

/** Rows and group sections, the two things that move when a row leaves. */
const FLIP_SELECTOR = "[data-todo-row], [data-todo-group]";

function flipKey(el: Element): string | null {
  return el.getAttribute("data-nav-stop") ?? el.getAttribute("data-todo-group");
}

type Positions = Map<string, number>;

function measure(container: HTMLElement | null): Positions {
  const out: Positions = new Map();
  container?.querySelectorAll(FLIP_SELECTOR).forEach((el) => {
    const key = flipKey(el);
    if (key) out.set(key, el.getBoundingClientRect().top);
  });
  return out;
}

/** Reads a duration token off `:root`, so the motion follows globals.css. */
function cssMs(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  // The minifier rewrites `260ms` as `.26s`, so read the unit.
  return raw.endsWith("ms") ? n : raw.endsWith("s") ? n * 1000 : n;
}

/**
 * The second half of a FLIP: every row and group that moved since `before`
 * starts back where it was and slides home on a transform. A row inside a
 * group that is itself sliding subtracts the group's travel, or it would move
 * twice. WAAPI rather than a style, so dnd-kit's own inline `transform` is
 * untouched and nothing re-renders; the animation simply ends.
 */
function playFlip(container: HTMLElement, before: Positions) {
  const duration = cssMs("--dur-slow", 260);
  const easing = getComputedStyle(document.documentElement)
    .getPropertyValue("--ease-out-soft")
    .trim() || "cubic-bezier(0.22, 1, 0.36, 1)";
  const deltas = new Map<Element, number>();
  container.querySelectorAll(FLIP_SELECTOR).forEach((el) => {
    const key = flipKey(el);
    const was = key ? before.get(key) : undefined;
    if (was === undefined) return;
    deltas.set(el, was - el.getBoundingClientRect().top);
  });
  deltas.forEach((dy, el) => {
    const parent = el.parentElement?.closest("[data-todo-group]");
    const own = dy - (parent && container.contains(parent) ? (deltas.get(parent) ?? 0) : 0);
    if (Math.abs(own) < 0.5) return;
    el.animate([{ transform: `translateY(${own}px)` }, { transform: "translateY(0)" }], {
      duration,
      easing,
    });
  });
}

/**
 * Moves keyboard focus off a row that is about to leave, to the row that
 * takes its place (the next one, else the one above), else the column's
 * quick-add. Without this a Space press that completed the row would leave
 * focus on a node that is about to vanish, which drops it to `<body>`, and
 * the arrow keys go dead.
 */
function moveFocusOff(container: HTMLElement | null, id: string) {
  if (!container) return;
  const row = container.querySelector(`[data-nav-stop="${CSS.escape(cardStop(id))}"]`);
  if (!row || !row.contains(document.activeElement)) return;
  const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-todo-row]")).filter(
    (r) => r !== row && !r.hasAttribute("inert"),
  );
  const next =
    rows.find((r) => row.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING) ??
    rows.findLast((r) => row.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_PRECEDING);
  const fallback = container
    .closest("section")
    ?.querySelector<HTMLElement>('[data-nav-stop^="add:"]');
  (next ?? fallback)?.focus({ preventScroll: true });
}

type Toggle = (todo: Todo, origin?: ConfettiOrigin | null) => void;

/**
 * The column's half of the completion beat (`lib/completion-beat.ts`).
 *
 * Wraps the column's `onToggle`: completing a row records where it sits and
 * keeps it there for `BEAT_MS` (checked, struck, the flash played by the card
 * itself), then fades it for `LEAVE_MS` and lets it go — and the rows below
 * close the gap on a transform. Under View: All, where the finished row stays
 * on the board, the release moves it to its new place the same way. Reduced
 * motion keeps the beat (the state is the confirmation) and drops the fade
 * and the slide.
 */
export function useCompletionBeat({
  todos,
  groups,
  onToggle,
}: {
  todos: Todo[];
  groups: TodoGroup[] | null | undefined;
  onToggle: Toggle;
}) {
  const [held, setHeld] = useState<HeldRow[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);

  // What this column's data says now, for the timers. Written after commit,
  // never read during render (React Compiler's `refs` rule).
  const dataRef = useRef<Map<string, Todo["status"]>>(new Map());
  // Rows whose completion the data has reflected at least once. One of these
  // that reads `open` again was undone, not slow.
  const seenRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingFlipRef = useRef<Positions | null>(null);

  useEffect(() => {
    const timers = timersRef.current;
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  const later = useCallback((id: string, ms: number, fn: () => void) => {
    clearTimeout(timersRef.current.get(id));
    timersRef.current.set(
      id,
      setTimeout(() => {
        timersRef.current.delete(id);
        fn();
      }, ms),
    );
  }, []);

  const release = useCallback((id: string, slide: boolean) => {
    clearTimeout(timersRef.current.get(id));
    timersRef.current.delete(id);
    seenRef.current.delete(id);
    if (slide && !prefersReducedMotion()) pendingFlipRef.current = measure(listRef.current);
    setHeld((h) => h.filter((x) => x.id !== id));
  }, []);

  const endBeat = useCallback(
    (id: string) => {
      const outcome = beatOutcome(dataRef.current.has(id), dataRef.current.get(id) ?? null);
      // Open again after the write was seen: undone. Stop holding; the data
      // already shows it where it belongs.
      if (outcome === "undone") return release(id, false);
      if (outcome === "release") return release(id, true);
      moveFocusOff(listRef.current, id);
      if (prefersReducedMotion()) return release(id, false);
      setHeld((h) => h.map((x) => (x.id === id ? { ...x, phase: "leaving" } : x)));
      later(id, LEAVE_MS, () => release(id, true));
    },
    [later, release],
  );

  /*
    After every commit: note what the data says, for the timers, and start
    the beat for any held row whose write has just landed. The beat is timed
    from the write, not the click, because the flash and the strike are keyed
    on the data changing — timed from the click, a slow write (a busy main
    thread, a dev build) would cut the strike off halfway.
  */
  useLayoutEffect(() => {
    dataRef.current = new Map(todos.map((t) => [t.id, t.status]));
    for (const h of held) {
      if (seenRef.current.has(h.id)) continue;
      const status = dataRef.current.get(h.id);
      if (status !== undefined && status === "open") continue;
      seenRef.current.add(h.id);
      later(h.id, BEAT_MS, () => endBeat(h.id));
    }
  });

  useLayoutEffect(() => {
    const before = pendingFlipRef.current;
    if (!before || !listRef.current) return;
    pendingFlipRef.current = null;
    playFlip(listRef.current, before);
  });

  const isGrouped = (groups?.length ?? 0) > 0 || held.some((h) => h.group);
  const placedGroups = isGrouped ? holdGroups(groups ?? [], held) : null;
  const placedFlat = placedGroups ? null : holdRows(todos, held);
  const heldIds = placedGroups?.heldIds ?? placedFlat!.heldIds;
  const leavingIds = new Set(
    held.filter((h) => h.phase === "leaving" && heldIds.has(h.id)).map((h) => h.id),
  );

  const toggle: Toggle = (todo, origin) => {
    if (todo.status === "open") {
      const snapshot = heldSnapshot(todo, new Date().toISOString());
      let entry: HeldRow;
      const home = placedGroups?.groups.find((g) => g.todos.some((t) => t.id === todo.id));
      if (placedGroups && home) {
        const { todos: _rows, ...group } = home;
        void _rows;
        const groupNeighbors = neighborsOf(placedGroups.groups, home.id);
        entry = {
          id: todo.id,
          todo: snapshot,
          ...neighborsOf(home.todos, todo.id),
          group,
          prevGroupId: groupNeighbors.prevId,
          nextGroupId: groupNeighbors.nextId,
          phase: "beat",
        };
      } else {
        entry = {
          id: todo.id,
          todo: snapshot,
          ...neighborsOf(placedFlat?.rows ?? [], todo.id),
          group: null,
          prevGroupId: null,
          nextGroupId: null,
          phase: "beat",
        };
      }
      seenRef.current.delete(todo.id);
      setHeld((h) => [...h.filter((x) => x.id !== todo.id), entry]);
      // A write that never lands stops being held; the row then behaves as
      // it did before the beat existed. Replaced by the beat's own timer once
      // the write is seen.
      later(todo.id, GIVE_UP_MS, () => release(todo.id, false));
    }
    onToggle(todo, origin);
  };

  return {
    /** The flat rows to render, held rows included. Null when grouped. */
    rows: placedFlat?.rows ?? null,
    /** The groups to render, held rows (and their groups) included. */
    groups: placedGroups?.groups ?? null,
    /** Rows that are fading out — the card renders them inert. */
    leavingIds,
    onToggle: toggle,
    /** Goes on the element that holds the column's rows. */
    listRef,
  };
}
