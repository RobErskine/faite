import type { TodoGroup } from "./board";
import type { Todo } from "./schema";

/**
 * The completion beat (EI-395): the to-do you just ticked stays where it was
 * for one beat, checked and struck, before it leaves.
 *
 * Without it there was no beat at all. Under the default View (open to-dos
 * only) the board drops a finished to-do in the same render that marks it
 * done, so the card unmounted ~90ms after the click: the check flash never
 * played and the strike was never seen. The confirmation was a toast in the
 * corner, away from where you were looking.
 *
 * The column holds the row, not the card, because the card is what leaves:
 * once the data says "done", `buildBoard` no longer hands this column the
 * to-do, and nothing inside a card that is not rendered can keep itself
 * rendered. So the column remembers what it was showing at the click (a
 * `HeldRow`) and puts it back into its own rows until the beat is over —
 * `holdRows` / `holdGroups` below, pure so they can be tested without a DOM.
 *
 * docs/DESIGN.md §4 "The completion beat" is the timeline.
 */

/**
 * From the write landing (the card turns checked; ~90ms after the click on a
 * production build) to the row starting to leave: the 180ms flash and strike,
 * then 80ms of the finished row standing still to be read.
 */
export const BEAT_MS = 260;

/**
 * The fade out — `--dur-fast`, because an exit is faster than the entrance it
 * follows. Skipped under reduced motion, where the row leaves in one step.
 */
export const LEAVE_MS = 100;

/**
 * How long a completing click waits before it calls the board's `onToggle` —
 * the write, the toast, and the store update that re-derives the whole board
 * (a 92ms long task, measured). The card ticks and the flash starts on the
 * click frame from local state; this lead, about two frames, lets the flash's
 * first frames paint before that work blocks the main thread (EI-399). Tiny
 * against `GIVE_UP_MS`, which still counts from the click.
 */
export const TICK_LEAD_MS = 34;

/**
 * Give up on a write that has not landed this long after the click, and stop
 * holding. The row then behaves exactly as it did before the beat existed.
 */
export const GIVE_UP_MS = 2000;

/** One row the column is holding in place while it completes. */
export interface HeldRow {
  id: string;
  /** The row as last shown, marked done — rendered while the data has none. */
  todo: Todo;
  /** Its neighbors when it was ticked: where to put it back. */
  prevId: string | null;
  nextId: string | null;
  /** The list group it sat in, for a grouped column. Null in a flat one. */
  group: Omit<TodoGroup, "todos"> | null;
  /** The groups either side of that one, for when the group itself is gone. */
  prevGroupId: string | null;
  nextGroupId: string | null;
  /** `beat` while it shows checked and struck; `leaving` while it fades. */
  phase: "beat" | "leaving";
}

/** The ticked row as the column will show it until the data catches up. */
export function heldSnapshot(todo: Todo, at: string): Todo {
  return { ...todo, status: "done", completedAt: at };
}

/** Where `id` sits in `rows`, by neighbor, for `HeldRow.prevId`/`nextId`. */
export function neighborsOf(
  rows: readonly { id: string }[],
  id: string,
): { prevId: string | null; nextId: string | null } {
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) return { prevId: null, nextId: null };
  return { prevId: rows[i - 1]?.id ?? null, nextId: rows[i + 1]?.id ?? null };
}

/**
 * Where to put a held item back: after its old previous neighbor if that is
 * still there, else before its old next one, else where it was relative to
 * the ends. Neighbors rather than an index, because two rows ticked in quick
 * succession shift each other's indexes and their neighbors do not.
 */
function insertionIndex(
  ids: readonly string[],
  prevId: string | null,
  nextId: string | null,
): number {
  if (prevId) {
    const p = ids.indexOf(prevId);
    if (p >= 0) return p + 1;
  }
  if (nextId) {
    const n = ids.indexOf(nextId);
    if (n >= 0) return n;
  }
  return prevId === null ? 0 : ids.length;
}

export interface HeldPlacement {
  rows: Todo[];
  /** Rows drawn from a `HeldRow` because the data no longer has them here. */
  heldIds: Set<string>;
}

/**
 * `rows` with each held row put back where it was.
 *
 * - The data still has it, still open: the write has not landed (or it was
 *   undone). The data wins and nothing moves.
 * - The data has it here, settled (View: All, same column): it stays at its
 *   old place for the beat, and the column's release then moves it to its new
 *   one with a transform.
 * - The data no longer has it here: the held copy fills its old place.
 * - The data has it somewhere else in this column (`columnIds`): it already
 *   has a place, so it is not shown twice.
 */
export function holdRows(
  rows: readonly Todo[],
  held: readonly HeldRow[],
  columnIds: ReadonlySet<string> = new Set(rows.map((r) => r.id)),
): HeldPlacement {
  const out = rows.slice();
  const heldIds = new Set<string>();
  for (const entry of held) {
    const at = out.findIndex((t) => t.id === entry.id);
    let row: Todo;
    if (at >= 0) {
      row = out[at];
      if (row.status === "open") continue;
      out.splice(at, 1);
    } else {
      if (columnIds.has(entry.id)) continue;
      row = entry.todo;
      heldIds.add(entry.id);
    }
    out.splice(
      insertionIndex(
        out.map((t) => t.id),
        entry.prevId,
        entry.nextId,
      ),
      0,
      row,
    );
  }
  return { rows: out, heldIds };
}

/**
 * The grouped form of `holdRows`. A held row whose whole group has gone —
 * it was the only to-do from that list on the day — brings its group back
 * with it for the beat, so the most common case on a day column (one to-do
 * per list) still plays.
 */
export function holdGroups(
  groups: readonly TodoGroup[],
  held: readonly HeldRow[],
): { groups: TodoGroup[]; heldIds: Set<string> } {
  const heldIds = new Set<string>();
  const columnIds = new Set(groups.flatMap((g) => g.todos.map((t) => t.id)));
  const out: TodoGroup[] = groups.map((group) => {
    const mine = held.filter((h) => h.group?.id === group.id);
    if (mine.length === 0) return group;
    const placed = holdRows(group.todos, mine, columnIds);
    placed.heldIds.forEach((id) => heldIds.add(id));
    return { ...group, todos: placed.rows };
  });

  for (const entry of held) {
    if (!entry.group || columnIds.has(entry.id)) continue;
    if (out.some((g) => g.id === entry.group!.id)) continue;
    // The row's group is gone. Restore it around the held rows that need it.
    const orphans = held.filter(
      (h) => h.group?.id === entry.group!.id && !columnIds.has(h.id),
    );
    out.splice(
      insertionIndex(
        out.map((g) => g.id),
        entry.prevGroupId,
        entry.nextGroupId,
      ),
      0,
      { ...entry.group, todos: orphans.map((h) => h.todo) },
    );
    orphans.forEach((h) => heldIds.add(h.id));
  }
  return { groups: out, heldIds };
}

/**
 * What a held row's timer should do when its beat ends, from what the data
 * says now. `present` is whether this column's data has the row at all.
 */
export function beatOutcome(
  present: boolean,
  status: Todo["status"] | null,
): "leave" | "release" | "undone" {
  if (!present) return "leave";
  // Open again after the write was seen: it was undone. The caller stops
  // holding and the data shows it where it belongs.
  if (status === "open") return "undone";
  // Settled and still here (View: All): it moves to its new place.
  return "release";
}

/**
 * The row's inline `transition`, with dnd-kit's own transition kept intact.
 *
 * `useSortable` hands back a `transition` string ("transform 200ms ease", or
 * "transform 0ms linear" for the frame it sets up a move) and the row used to
 * pass it straight to `style`. An inline `transition` shorthand replaces the
 * whole list, so the row's class transition — the hover wash on
 * `background-color` and the landing fade on `opacity` — was overridden on
 * every row, and the wash snapped instead of fading. Composing the list keeps
 * both: dnd-kit still owns `transform`, and the wash and fade keep their own
 * durations, which stay in CSS variables so a class (`hover:`, `leaving`) can
 * still change them.
 */
export function rowTransition(dndTransition: string | null | undefined): string {
  return [
    dndTransition,
    "background-color var(--row-wash-dur) var(--ease-out-soft)",
    "opacity var(--row-fade-dur) var(--ease-out-soft)",
  ]
    .filter(Boolean)
    .join(", ");
}
