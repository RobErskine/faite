import type { List, Todo } from "@/lib/schema";

/**
 * The list to show as a to-do's proposal chip (EI-369), or null.
 *
 * `suggestedListId` is never cleaned up when its list goes away (the server
 * writes it once; nothing rewrites it), so this is where a stale value stops
 * mattering: a deleted, archived or Backlog list, or a to-do that is no longer
 * open, shows nothing. The caller limits it to Backlog cards.
 */
export function suggestedListFor(
  todo: Pick<Todo, "suggestedListId" | "status">,
  listsById: ReadonlyMap<string, List>,
): List | null {
  if (todo.status !== "open" || !todo.suggestedListId) return null;
  const list = listsById.get(todo.suggestedListId);
  if (!list || list.deletedAt || list.archivedAt || list.isBacklog) return null;
  return list;
}
