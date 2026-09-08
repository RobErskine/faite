import { listSchema, settingsSchema, todoSchema, type List, type Settings, type Todo } from "@/lib/schema";
import { contextFromSettings, deriveColumn, OVERFLOW } from "@/lib/scheduling";

/**
 * The three derived reads on `/api/v1` (A17, EI-297) — Overflow, Backlog and
 * Profile. Each already existed as an MCP tool with no REST equivalent.
 *
 * **Pure by design.** Every function here takes rows and returns rows, so
 * `derived.test.ts` can exercise the real rules with no Durable Object. The
 * route's whole job is to fetch, parse, and delegate.
 *
 * Overflow is the reason this file matters. It is the Faite Loop — the
 * product's core mechanic — and it is DERIVED, never stored (ARCHITECTURE
 * §2.2). A client cannot compute it without the account's own Settings, so
 * without a REST route a Raycast client would either have to reimplement
 * `deriveColumn` (a second answer that drifts the first time
 * `overflowAfterDays` changes meaning) or simply not show the one view a
 * launcher is best at.
 */

/**
 * To-dos that have rolled past the account's Faite Loop window.
 *
 * Runs `deriveColumn` — the SAME pure function the board itself renders with
 * — against the account's real Settings, rather than reimplementing the rule.
 * `mcp/routes.ts`'s `get_overflow` does exactly this; the two now share a
 * function instead of sharing a shape.
 *
 * **Placement, not visibility.** `deriveColumn` reads `status` only for the
 * deadline badge, never to decide a column — so a completed-but-overdue
 * to-do IS in Overflow, and the board hides it through `visibleStatuses`
 * rather than through placement. A caller that wants only open work filters
 * on `status` itself. Deliberately not filtered here: this endpoint answers
 * the same question the board and `get_overflow` answer, or it answers a
 * third one nobody asked for.
 */
export function overflowTodos(todos: Todo[], settings: Settings, now: Date = new Date()): Todo[] {
  // `now` is injected rather than read inside, so a test can pin "today" and
  // assert the real overflow rule instead of asserting around the clock.
  // `contextFromSettings` already takes it; not threading it through would
  // make this function untestable for the one thing it exists to do.
  const placementCtx = contextFromSettings(settings, now);

  return todos.filter((todo) => {
    const placement = deriveColumn(todo, placementCtx);
    return placement.half === "calendar" && placement.day === OVERFLOW;
  });
}

/**
 * To-dos in the Backlog list — the always-present column a to-do lands in
 * when it is not filed anywhere else.
 *
 * An account with no Backlog row yields an empty array rather than throwing.
 * That state should be impossible, but a read endpoint is the wrong place to
 * discover it, and returning "nothing is in Backlog" is true either way.
 */
export function backlogTodos(todos: Todo[], lists: List[]): Todo[] {
  const backlog = lists.find((list) => list.isBacklog);
  if (!backlog) return [];

  return todos.filter((todo) => todo.listId === backlog.id);
}

/**
 * The account-level slice of Settings — identity, plus the Faite Loop config
 * a client needs to render the board the same way the app does.
 *
 * **Deliberately excludes every device-local preference.** `backlogWidth`,
 * `splitRatio` and the `overdrive*` fields live in the same row but describe
 * one device's screen, not the account; handing them to a launcher on another
 * machine would be meaningless at best. `mcp/routes.ts`'s `get_profile` used
 * to hand-pick its six fields inline — it now reads this same schema, so the
 * exclusion list exists in exactly one place and cannot drift.
 *
 * `workdaysOnly` is left out on purpose too: it changes which days the BOARD
 * renders, not what a to-do's placement means, and a client that shows a flat
 * list has no use for it.
 */
export const profileSchema = settingsSchema.pick({
  displayName: true,
  avatarKind: true,
  avatarInitials: true,
  avatarEmoji: true,
  avatarImage: true,
  timezone: true,
  overflowAfterDays: true,
  visibleDays: true,
  workdays: true,
});

export type Profile = ReturnType<typeof profileSchema.parse>;

export function profileFromSettings(settings: Settings): Profile {
  return profileSchema.parse(settings);
}

/** Parses raw DO rows into entities. Every derived read needs at least one of
 * these, and doing it here keeps the route free of `.map(schema.parse)` noise. */
export const parseTodos = (rows: Record<string, unknown>[]): Todo[] =>
  rows.map((row) => todoSchema.parse(row));

export const parseLists = (rows: Record<string, unknown>[]): List[] =>
  rows.map((row) => listSchema.parse(row));
