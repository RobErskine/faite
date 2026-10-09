import type { Todo } from "@/lib/schema";

/**
 * Whether a flagged duplicate is held off the board until reviewed (EI-346).
 *
 * The server sets `duplicateHeld` for a match from outside the board (REST,
 * MCP, email). `settings.holdAllDuplicates` widens that to every match,
 * including one typed on the board. The one rule the board filter, the toast
 * and the Duplicates sheet all read, so they cannot disagree.
 */
export function isHeldDuplicate(
  todo: Pick<Todo, "duplicateOf" | "duplicateHeld">,
  holdAll: boolean,
): boolean {
  return !!todo.duplicateOf && (holdAll || !!todo.duplicateHeld);
}
