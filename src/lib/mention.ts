/**
 * Pure "@mention" trigger detection, shared by every field that wants an
 * inline picker — quick-add today, notes/description fields later. Framework-
 * agnostic on purpose: it takes a string and a cursor offset and returns data,
 * so it works the same behind a single-line `<input>` or a `<textarea>`.
 *
 * See docs/AT-MENTION.md for how to wire this into a new field.
 */

export interface MentionTrigger {
  /** Text typed after the "@", not including it. */
  query: string;
  /** Index of the "@" itself. */
  start: number;
  /** Index the query ends at — always the cursor, since a trigger is only
   * "live" while the cursor sits at the end of the run being typed. */
  end: number;
}

/**
 * Finds the mention trigger active at `cursor`, or null.
 *
 * An "@" only starts a trigger when it begins a word — string start or
 * preceded by whitespace — matching Slack/Linear/Notion: `foo@bar.com` never
 * triggers. The trigger stays live only while the run after the "@" has no
 * whitespace in it yet; typing a space (or moving the cursor away) ends it,
 * which is what makes the popover disappear once you've finished typing past
 * the query or moved on.
 */
export function findMentionTrigger(value: string, cursor: number): MentionTrigger | null {
  if (cursor < 0 || cursor > value.length) return null;
  const before = value.slice(0, cursor);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(value[at - 1])) return null;

  const query = before.slice(at + 1);
  if (/\s/.test(query)) return null;

  return { query, start: at, end: cursor };
}

export interface ResolvedMention {
  text: string;
  /** Where the caret should land after resolving — right after whatever replaced the trigger. */
  caretIndex: number;
}

/**
 * Removes a resolved trigger's "@query" span, rejoining the surrounding text.
 *
 * Only the join point is touched — one adjacent space is dropped so "buy milk
 * @groc fri" becomes "buy milk fri" rather than leaving a double space — so
 * this is safe to reuse inside a multi-line note without disturbing the rest
 * of the text. `replacement` defaults to removal (quick-add's use: the
 * mention resolves to a hidden field, not visible text); pass a non-empty
 * string for a field that should keep a visible reference instead.
 */
export function resolveMentionTrigger(
  value: string,
  trigger: MentionTrigger,
  replacement = "",
): ResolvedMention {
  let before = value.slice(0, trigger.start);
  let after = value.slice(trigger.end);
  if (replacement === "") {
    before = before.replace(/ $/, "");
    if (before === "") after = after.replace(/^ /, "");
  }
  return { text: `${before}${replacement}${after}`, caretIndex: before.length + replacement.length };
}

/**
 * Filters and ranks mention candidates by their label: prefix matches first,
 * then shortest label wins ties (the more specific match). Generic over any
 * item shape with a `label`, so the same ranking serves lists today and
 * labels/projects/places later.
 */
export function filterMentionItems<T extends { label: string }>(
  items: readonly T[],
  query: string,
  limit = 6,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.slice(0, limit);

  return items
    .filter((item) => item.label.toLowerCase().includes(q))
    .sort((a, b) => {
      const aPrefix = a.label.toLowerCase().startsWith(q) ? 0 : 1;
      const bPrefix = b.label.toLowerCase().startsWith(q) ? 0 : 1;
      return aPrefix - bPrefix || a.label.length - b.label.length;
    })
    .slice(0, limit);
}
