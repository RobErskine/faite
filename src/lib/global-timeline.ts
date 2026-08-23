import type { CivilDate, TodoEvent } from "./schema";
import type { TodoEventKind } from "./store/todo-events";
import { parseEventPayload } from "./store/todo-events";
import type { DailyRollSummary } from "./rollover-events";
import { civilDateOf, daysBetween, formatDay, formatShortDate } from "./scheduling";

/**
 * Assembles the whole-app activity feed (the "Global Timeline") from the
 * real per-todo event log plus the Faite Loop's derived roll summaries —
 * `buildGlobalTimeline` is the render-time half; `logTodoEvent`
 * (`store/todo-events.ts`) and `dailyRollSummaries` (`rollover-events.ts`)
 * are the two sources it merges.
 *
 * v1 is todos only: no list/tab lifecycle events exist yet (a later ticket),
 * and rollover is aggregated per day rather than per todo (see
 * `dailyRollSummaries`'s two limits — the aggregated row answers "what is
 * rolling," not "what rolled").
 *
 * Deliberately NO synthetic `created` backfill and NO `history-start`
 * marker, unlike `buildTodoTimeline`. That marker exists there to explain a
 * gap above one synthesized row for one todo; doing the same here would mean
 * synthesizing a `created` row for every pre-log todo in the whole account —
 * the derived-backfill work explicitly deferred when this shipped todos-only.
 * The feed simply starts wherever real logging began, same as `useTodoEvents`
 * already does for a single todo lacking a `history-start` marker of its own.
 *
 * Newest-first throughout, unlike `buildTodoTimeline`'s oldest-first per-todo
 * History — an activity feed reads top-down as "what just happened."
 */

export interface TodoTitleInfo {
  title: string;
  /** True once the todo is tombstoned (`deletedAt` set) OR the row no
   * longer exists locally at all — either way, the row can't open a sheet. */
  deleted: boolean;
}

export interface GlobalTimelineEvent {
  key: string;
  todoId: string;
  /** Unrecognized kinds pass through as-is, same contract as
   * `TodoTimelineEvent.kind` — the render layer falls back to a neutral
   * "Updated" label rather than this module failing closed. */
  kind: TodoEventKind | string;
  at: string;
  payload: unknown;
  fields?: string[];
  title: string;
  deleted: boolean;
}

export type GlobalTimelineItem =
  | { type: "day-header"; key: string; day: CivilDate; label: string }
  | { type: "event"; event: GlobalTimelineEvent }
  | {
      type: "rollup";
      key: string;
      kind: DailyRollSummary["kind"];
      day: CivilDate;
      at: string;
      todos: DailyRollSummary["todos"];
    }
  /** The feed hit `MAX_SHOWN` — older history exists but isn't loaded. */
  | { type: "marker"; key: "truncated" };

function editedFields(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const fields = (payload as { fields?: unknown }).fields;
  return Array.isArray(fields) ? (fields as string[]) : [];
}

/**
 * Resolution order: the live/tombstoned todo's own title, then — only when
 * the todo row doesn't exist locally at all — the `deleted` event's own
 * snapshot, then a placeholder. See `DeletedPayload`'s doc comment
 * (`store/todo-events.ts`) for why a title snapshot exists only on that one
 * kind, never `edited`.
 */
function resolveSubject(event: TodoEvent, titles: ReadonlyMap<string, TodoTitleInfo>): TodoTitleInfo {
  const info = titles.get(event.todoId);
  if (info) return info;

  if (event.kind === "deleted") {
    const payload = parseEventPayload(event.payload) as { title?: unknown } | null;
    if (payload && typeof payload.title === "string" && payload.title.length > 0) {
      return { title: payload.title, deleted: true };
    }
  }
  return { title: "(deleted to-do)", deleted: true };
}

function toGlobalEvent(row: TodoEvent, titles: ReadonlyMap<string, TodoTitleInfo>): GlobalTimelineEvent {
  const payload = parseEventPayload(row.payload);
  const { title, deleted } = resolveSubject(row, titles);
  return {
    key: row.id,
    todoId: row.todoId,
    kind: row.kind,
    at: row.at,
    payload,
    ...(row.kind === "edited" ? { fields: editedFields(payload) } : {}),
    title,
    deleted,
  };
}

/**
 * "Today" / "Yesterday" / "3 days ago · Aug 19" / "Last week · Aug 15" /
 * "Aug 2" / "Aug 2, 2025" — the boundary-naming convention `rampLabel`
 * (`lib/overdrive.ts`) uses for a handful of cases, extended to cover a
 * feed that can span months: a bare "Aug 19" reads fine on its own, but
 * pairing it with a relative phrase for anything inside the last two weeks
 * is what makes "how recent is this" scannable without doing the date math
 * yourself.
 *
 * `diff` is always >= 0 in practice — every `day` this is called with comes
 * from either a real event's `at` (logged at write time, never future) or a
 * rollover day (never past `ctx.today` — see `rollEventsFor`), so there is
 * no reachable case where `day` is in the future relative to `today`.
 */
function dayLabel(day: CivilDate, today: CivilDate): string {
  const diff = daysBetween(day, today);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff <= 6) return `${diff} days ago · ${formatShortDate(day)}`;
  if (diff <= 13) return `Last week · ${formatShortDate(day)}`;
  if (day.slice(0, 4) === today.slice(0, 4)) return formatShortDate(day);
  return formatDay(day).label;
}

interface SortableRow {
  at: string;
  sortKey: string;
  render: () => GlobalTimelineItem;
}

export function buildGlobalTimeline(
  events: readonly TodoEvent[],
  rollups: readonly DailyRollSummary[],
  titles: ReadonlyMap<string, TodoTitleInfo>,
  timezone: string,
  today: CivilDate,
  opts: { atCap: boolean },
): GlobalTimelineItem[] {
  // Newest first, tiebroken by `id` descending (UUIDv7 sorts by creation) —
  // the mirror image of `buildTodoTimeline`'s ascending sort.
  const sortedEvents = [...events].sort(
    (a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id),
  );

  // Clip rollups to the span the loaded event page actually covers, so a
  // summary never appears to report on a day older than any real event this
  // render knows about. Compared by CIVIL DAY, not raw instant — a rollup is
  // always stamped at 00:00 (see `dailyRollSummaries`), so comparing instants
  // directly would drop same-day rollups behind any event later that day.
  // `dailyRollSummaries` is naturally bounded to the last
  // `overflowAfterDays + 1` days regardless, so this rarely trims anything —
  // it's a correctness guard, not a performance one.
  const oldestEventDay = civilDateOf(sortedEvents.at(-1)?.at ?? "", timezone);
  const clippedRollups = oldestEventDay ? rollups.filter((r) => r.day >= oldestEventDay) : rollups;

  const rows: SortableRow[] = [
    ...sortedEvents.map((row) => ({
      at: row.at,
      sortKey: row.id,
      render: (): GlobalTimelineItem => ({ type: "event", event: toGlobalEvent(row, titles) }),
    })),
    ...clippedRollups.map((r) => ({
      at: r.at,
      sortKey: r.key,
      render: (): GlobalTimelineItem => ({
        type: "rollup",
        key: r.key,
        kind: r.kind,
        day: r.day,
        at: r.at,
        todos: r.todos,
      }),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at) || b.sortKey.localeCompare(a.sortKey));

  const items: GlobalTimelineItem[] = [];
  let lastDay: CivilDate | null = null;

  for (const row of rows) {
    const day = civilDateOf(row.at, timezone);
    if (day && day !== lastDay) {
      items.push({ type: "day-header", key: `day:${day}`, day, label: dayLabel(day, today) });
      lastDay = day;
    }
    items.push(row.render());
  }

  if (opts.atCap) {
    items.push({ type: "marker", key: "truncated" });
  }

  return items;
}
