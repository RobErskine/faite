import { apiUrl } from "@/lib/api-origin";
import { backlogMembership } from "@/lib/backlog";
import type { Todo } from "@/lib/schema";
import { getDb } from "@/lib/store/db";
import { LOCAL_OWNER_ID } from "@/lib/store/owner";
import { updateTodo } from "@/lib/store/repositories";

/**
 * The client half of `POST /api/smart-sort/suggest`: proposed lists for
 * to-dos the board describes by their text. Same conventions as
 * `lib/duplicates-key.ts` — `credentials: "include"` for the session cookie,
 * `apiUrl()` because `next dev` runs no Worker.
 */

export interface TodoText {
  id: string;
  title: string;
  description: string | null;
}

/**
 * Set once the route has said it cannot help this session — signed out, no
 * Worker, or no key — so a board that keeps creating to-dos stops asking.
 * Saving a key clears it (`resetListSuggestions`). A Jev failure (502) does
 * not set it; the next create simply asks again.
 */
let unavailable = false;

export function resetListSuggestions(): void {
  unavailable = false;
}

/**
 * Proposed list ids by to-do id, or null when there is nothing to use. Never
 * throws: a proposal is a convenience, so every failure means the same thing.
 */
export async function fetchListSuggestions(todos: TodoText[]): Promise<Record<string, string | null> | null> {
  if (todos.length === 0) return {};
  if (unavailable) return null;
  try {
    const response = await fetch(apiUrl("/api/smart-sort/suggest"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ todos }),
    });
    if (response.status === 401 || response.status === 404 || response.status === 409) {
      unavailable = true;
      return null;
    }
    if (!response.ok) return null;
    const body = (await response.json()) as { suggestions?: Record<string, string | null> };
    return body.suggestions ?? null;
  } catch {
    return null;
  }
}

/**
 * Ask Jev for a list the moment the board creates a to-do (EI-373), instead
 * of waiting for sync and the server's push hook — that path costs the 2s
 * sync debounce plus a round trip each way, which is what made a proposal
 * take seconds.
 *
 * Fire and forget, after the create. Everything it needs is read from the
 * local store, so a caller passes only the id. It does nothing unless smart
 * sorting is on and the to-do is open and in Backlog, and it reads the to-do
 * again before writing, so one the user already filed or scheduled is left
 * alone. The write is an ordinary local edit, so it syncs like one.
 */
export async function proposeListForNewTodo(id: string): Promise<void> {
  if (unavailable) return;
  const db = getDb();
  const settings = await db.settings.get(LOCAL_OWNER_ID);
  if (!settings?.smartSortEnabled) return;

  const isOpenInBacklog = async (): Promise<Todo | null> => {
    const todo = await db.todos.get(id);
    if (!todo || todo.deletedAt || todo.status !== "open" || todo.parentId || todo.suggestedListId) return null;
    const inBacklog = backlogMembership(await db.lists.toArray());
    return inBacklog?.(todo) && todo.title.trim() ? todo : null;
  };

  const todo = await isOpenInBacklog();
  if (!todo) return;

  const suggestions = await fetchListSuggestions([
    { id: todo.id, title: todo.title, description: todo.description },
  ]);
  const listId = suggestions?.[todo.id];
  if (!listId || !(await isOpenInBacklog())) return;
  await updateTodo(id, { suggestedListId: listId });
}
