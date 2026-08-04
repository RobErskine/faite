import type { EntityKind } from "@/lib/schema";
import { mutate, newId, now } from "@/lib/store/mutate";

/**
 * Undo, expressed as ordinary forward mutations.
 *
 * An undo entry is DATA — a list of {kind, entityId, patch} steps — not a
 * closure. Every reversible action in the app happens to be expressible that
 * way, so a closure would buy nothing and cost two things: it could not be
 * tested without mocking, and it would capture object references that a later
 * edit can make stale.
 *
 * The payoff is at P3. Replaying an entry goes through mutate(), so it gets a
 * fresh updatedAt/hlc and lands in the outbox as an ordinary edit. Sync never
 * has to know undo exists — no revert opcode, no inverse-patch protocol, no
 * special case in the merge.
 *
 * Recording happens at CALL SITES, not inside mutate(). Auto-recording would
 * have to read every row before writing it (a UI concern pushed into the single
 * write path), would record the undo's own mutate() call and turn ⌘Z ⌘Z into a
 * ping-pong, and would split a compound operation like deleteList into N+1
 * separate entries — so one ⌘Z would undo only its last step. Grouping could
 * fix that, but a browser has no AsyncLocalStorage, so it would degrade to a
 * module-level "current group" that mis-attributes steps whenever two async
 * handlers interleave.
 *
 * History is in-memory only. A reload starts clean, which means a delete
 * followed by a reload is permanent.
 */

/** Settings are keyed by ownerId rather than id, so they are not undoable. */
type UndoKind = Exclude<EntityKind, "settings">;

export interface UndoStep {
  kind: UndoKind;
  entityId: string;
  patch: Record<string, unknown>;
}

export interface UndoEntry {
  id: string;
  /** Human-readable, shown in the "Undone" toast. */
  label: string;
  steps: UndoStep[];
}

/**
 * Deep enough that a long editing session in the sheet cannot evict the drag
 * you actually wanted back, small enough to stay a bounded amount of memory.
 */
export const MAX_UNDO = 50;

const stack: UndoEntry[] = [];

/**
 * Keys that must never be reversed.
 *
 * `updatedAt` is stamped by mutate() on every write; restoring an older value
 * would make the record look older than the change that produced it, which at
 * P3 is the difference between an edit surviving a merge and losing one. The
 * other three are immutable identity.
 */
const NEVER_REVERSE = new Set(["updatedAt", "id", "ownerId", "createdAt"]);

/**
 * Reverse exactly the fields a forward patch changed.
 *
 * Fields the patch did not touch are left alone. That is what makes a later
 * edit to a DIFFERENT field of the same record survive an undo — and combined
 * with strict LIFO popping, a later edit to the SAME field has already been
 * reversed by its own (newer) entry before this one is reached.
 */
export function inversePatch(
  before: Record<string, unknown>,
  forward: Record<string, unknown>,
): Record<string, unknown> {
  const inverse: Record<string, unknown> = {};

  for (const key of Object.keys(forward)) {
    if (NEVER_REVERSE.has(key)) continue;

    const value = before[key];
    /**
     * Explicit null, never undefined. Dexie's update() reads an undefined
     * value as "delete this key path", so an inverse carrying undefined would
     * strip the field off the record instead of clearing it — and every
     * nullable field in the schema expects null. Written as a comparison
     * rather than `??` so that false, 0 and "" pass through untouched.
     */
    inverse[key] = value === undefined ? null : value;
  }

  return inverse;
}

/**
 * Record an undoable action. Returns an id so a toast can later undo THAT
 * action specifically rather than whatever happens to be on top.
 */
export function pushUndo(label: string, steps: UndoStep[]): string {
  const entry: UndoEntry = { id: newId(), label, steps };
  stack.push(entry);
  // Oldest goes first.
  if (stack.length > MAX_UNDO) stack.shift();
  return entry.id;
}

/**
 * Apply an entry's steps as ordinary writes.
 *
 * Kept standalone because it is the seam redo will need: computing the
 * forward-again patch means reading each row here, just before it is
 * overwritten. See the follow-up section of the plan.
 */
async function apply(entry: UndoEntry): Promise<UndoEntry> {
  for (const step of entry.steps) {
    await mutate(step.kind, step.entityId, step.patch);
  }
  return entry;
}

/**
 * ⌘Z. Pops before awaiting, so two fast presses take two distinct entries
 * rather than racing for the same one.
 */
export async function undoLast(): Promise<UndoEntry | null> {
  const entry = stack.pop();
  return entry ? apply(entry) : null;
}

/**
 * A toast's own Undo button.
 *
 * Sonner shows up to three toasts at once, so the one being clicked is not
 * necessarily the newest action — undoing "the last thing" here would reverse
 * the wrong one. Returns null when ⌘Z already consumed this entry, which makes
 * a click on a stale toast a no-op instead of a double undo.
 */
export async function undoById(id: string): Promise<UndoEntry | null> {
  const index = stack.findIndex((entry) => entry.id === id);
  if (index === -1) return null;
  const [entry] = stack.splice(index, 1);
  return apply(entry);
}

export function clearUndo(): void {
  stack.length = 0;
}

export function undoDepth(): number {
  return stack.length;
}

/**
 * The step that undoes a creation: the same soft delete remove() performs.
 *
 * Written here rather than by importing now() into a component, so the one
 * place that knows a tombstone is `{deletedAt: <timestamp>}` stays the store.
 */
export function createUndoStep(kind: UndoKind, entityId: string): UndoStep {
  return { kind, entityId, patch: { deletedAt: now() } };
}

/**
 * Steps that undo a list deletion.
 *
 * Order is the point: restore the list FIRST, so there is never a rendered
 * frame where a todo points at a list that is still tombstoned.
 */
export function deleteListUndoSteps(
  listId: string,
  movedTodoIds: string[],
): UndoStep[] {
  return [
    { kind: "list", entityId: listId, patch: { deletedAt: null } },
    ...movedTodoIds.map((id) => ({
      kind: "todo" as const,
      entityId: id,
      patch: { listId },
    })),
  ];
}

/**
 * True when a keystroke came from a text field.
 *
 * ⌘Z inside an input has to reach the browser's own text undo. Stealing it
 * would break typing in exchange for a feature the user did not ask for there.
 */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest(
    "input, textarea, [contenteditable]:not([contenteditable='false'])",
  );
}
