import type { List, Todo } from "@/lib/schema";

/**
 * Which to-dos are "in Backlog" — the one rule the board, `/api/v1/backlog`
 * and MCP `get_backlog` must all agree on (EI-366).
 *
 * Backlog is not just the to-dos whose `listId` is the Backlog row's id. The
 * board (`buildBoard` in `board.ts`) also files an unscheduled to-do there when
 * its `listId` is null — every email capture, and any REST/MCP/Raycast create
 * that names no list — or points at a list that is gone (deleted or archived).
 * The server reads used to match the id alone, so exactly the to-dos most
 * likely to be lost (the ones that arrived from outside the app) were missing
 * from every client but the board.
 *
 * **Placement, not visibility** — the same contract as `overflowTodos`: status
 * is not read, so a done to-do with no date and no list is in Backlog, and a
 * caller that wants open work filters on `status` itself.
 *
 * A to-do with any `scheduledDate` is not in Backlog. That includes the rare
 * "away" to-do scheduled past the board's day cap, which the board draws in its
 * list column with a date flag: it has a day, so it is not unsorted work.
 *
 * Returns null when the account has no Backlog row. That should be
 * impossible, and callers answer "nothing is in Backlog", which is true.
 */
export function backlogMembership(
  lists: readonly List[],
): ((todo: Pick<Todo, "listId" | "scheduledDate">) => boolean) | null {
  const backlog = lists.find((list) => list.isBacklog && !list.deletedAt);
  if (!backlog) return null;

  const liveListIds = new Set(
    lists.filter((list) => !list.deletedAt && !list.archivedAt).map((list) => list.id),
  );

  return (todo) => {
    if (todo.scheduledDate) return false;
    if (todo.listId === null || todo.listId === backlog.id) return true;
    return !liveListIds.has(todo.listId);
  };
}
