import type { CivilDate, Todo } from "./schema";
import {
  daysBetween,
  formatDay,
  formatShortDate,
  OVERFLOW,
  type PlacementContext,
  rolloverTarget,
} from "./scheduling";

/**
 * Overdrive — the pure decision core for burning down a pile of to-dos one
 * card at a time, either the Overflow column or a single day column (see
 * `OverdriveSource`). See docs/OVERDRIVE.md.
 *
 * Everything here is pure: no store access, no DOM, no timers. The overlay
 * component owns the keydown listener and the actual writes; this module
 * only answers "given this key, what does the session look like now, and is
 * there something to commit?" — same split as lib/keyboard.ts vs
 * components/hotkeys.tsx.
 */

// ---------------------------------------------------------------------------
// Tunables — one block, so feel can be adjusted without hunting through the
// module.
// ---------------------------------------------------------------------------

/**
 * Overflow's entry button appears once the column holds at least this many —
 * the fallback used only for a `settings` row that predates
 * `settingsSchema.overdriveMinTodos` (EI-103 made the threshold a per-user
 * setting; every read site does `settings?.overdriveMinTodos ??
 * OVERDRIVE_MIN_TODOS`). Also the schema's own `default(5)`, so a fresh
 * account gets the same number this constant used to hardcode for everyone.
 */
export const OVERDRIVE_MIN_TODOS = 5;
/** Ceiling on the arrow ramp, in eligible days from today. Clamped, not
 * wrapped — silently landing back on today after enough presses would be
 * the worst possible failure here. */
export const RAMP_MAX = 30;
/** How far ⇧→ advances the ramp in one press. */
export const WEEK_STEP = 7;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Verdict =
  | { kind: "dropped" }
  | { kind: "done" }
  | { kind: "listed"; listId: string | null }
  | { kind: "scheduled"; date: CivilDate };

/**
 * What a session is triaging — the Overflow column, or one specific day.
 * Reuses `scheduling.ts`'s `OVERFLOW` sentinel rather than inventing a
 * second one, the same way `Placement`'s calendar half already does.
 */
export type OverdriveSource = CivilDate | typeof OVERFLOW;

/** One committed card, in the order they were decided. `undoId` is the
 * `pushUndo` entry id the write registered — `⌫` replays it via `undoById`.
 * `label` is the same human-readable line `pushUndo` was given
 * (`use-board-actions.ts`'s `handleOverdriveVerdict`) — carried here too so
 * the overlay's toast can show whichever decision is now most recent after
 * a step-back without re-deriving the wording a second time. */
export interface Decision {
  todoId: string;
  verdict: Verdict;
  undoId: string;
  label: string;
}

export interface OverdriveSession {
  /** What this session is triaging — Overflow, or one day. Frozen at open,
   * same as `queue`; see `overdriveBase` for how it drives the ramp. */
  source: OverdriveSource;
  /** Frozen at open — see `buildQueue`. Never reshuffled mid-session. */
  queue: string[];
  index: number;
  /** Staged ramp offset, in eligible days from `overdriveBase(source, ctx).base`
   * (0 = that base). Null = nothing staged. Mutually exclusive with `picked`. */
  ramp: number | null;
  /** An explicit date from the picker. Wins over `ramp` when both are set,
   * though in practice `stageDate` always clears `ramp` when it sets this. */
  picked: CivilDate | null;
  decided: Decision[];
}

export type KeyAction =
  | "wontDo" // ←
  | "done" // ↑
  | "toList" // ↓
  | "toBacklog" // ⇧↓
  | "ramp" // →
  | "rampWeek" // ⇧→
  | "confirm" // Enter
  | "cancel" // Esc
  | "stepBack"; // ⌫

/** Where `toList`/`toBacklog` resolve to — decision #2: back to the todo's
 * OWN list, Backlog only when it has none or when forced. */
export interface ListContext {
  currentListId: string | null;
  backlogListId: string;
}

export interface ReduceResult {
  session: OverdriveSession;
  /** A verdict for the CURRENT card, ready to write. The caller performs the
   * write and calls `applyDecision` with the id it gets back — `reduce`
   * itself never advances the queue, so it stays synchronous and pure even
   * though the actual write is not. */
  commit?: Verdict;
  /** Esc with nothing staged: the caller's cue to close the overlay. */
  exit?: boolean;
  /** Populated on `stepBack` when there was a decision to undo — the caller
   * replays it via `undoById(stepBack.undoId)`. */
  stepBack?: Decision;
}

// ---------------------------------------------------------------------------
// Queue / session
// ---------------------------------------------------------------------------

/**
 * Order-preserving over `board.overflow.todos` (decision #6) — entering
 * Overdrive should feel like walking the pile you were just looking at, not
 * being handed a re-sorted one. A named function so that rule has one home,
 * even though today it's a one-line map.
 */
export function buildQueue(todos: Pick<Todo, "id">[]): string[] {
  return todos.map((todo) => todo.id);
}

export function createSession(
  todos: Pick<Todo, "id">[],
  source: OverdriveSource = OVERFLOW,
): OverdriveSession {
  return { source, queue: buildQueue(todos), index: 0, ramp: null, picked: null, decided: [] };
}

/** The id of the card currently on screen, or null once the queue is spent. */
export function currentTodoId(session: OverdriveSession): string | null {
  return session.queue[session.index] ?? null;
}

export function isComplete(session: OverdriveSession): boolean {
  return session.index >= session.queue.length;
}

// ---------------------------------------------------------------------------
// The ramp
// ---------------------------------------------------------------------------

/**
 * The day a ramp offset lands on. Offset 0 is always `ctx.today` — never
 * advanced by `workdaysOnly`, because "today" means today even on a Sunday.
 * Offsets above 0 chain `rolloverTarget` (the same primitive the Faite Loop
 * itself rolls forward with), so the ramp skips non-eligible days exactly
 * the way a real rollover would (decision #4).
 */
export function rampDate(
  offset: number,
  ctx: Pick<PlacementContext, "today" | "workdaysOnly" | "workdays">,
  base: CivilDate = ctx.today,
): CivilDate {
  if (offset <= 0) return base;
  const opts = { workdaysOnly: ctx.workdaysOnly, workdays: ctx.workdays };
  let day = base;
  for (let i = 0; i < offset; i++) {
    day = rolloverTarget(day, opts);
  }
  return day;
}

/**
 * Where a session's ramp counts from, and the smallest offset it may stage.
 *
 * Overflow ramps from today, and offset 0 (today itself) is a real move.
 * A day session's card already sits on `source` — offset 0 there would
 * confirm a write that puts the card exactly where it already is, so the
 * floor is 1 and the first press always lands on the next eligible day.
 *
 * `source` is clamped forward to `ctx.today`: `usePlacementContext`
 * (lib/store/hooks.ts) re-ticks every 60s, so a session opened late in the
 * day can still be mounted once `today` moves past its own source day.
 * Without the clamp the ramp would stage a date in the past.
 */
export function overdriveBase(
  source: OverdriveSource,
  ctx: Pick<PlacementContext, "today">,
): { base: CivilDate; min: number } {
  if (source === OVERFLOW) return { base: ctx.today, min: 0 };
  return { base: source < ctx.today ? ctx.today : source, min: 1 };
}

/** "Today" / "Tomorrow" / "Fri, Aug 15" — the boundary cases worth naming
 * explicitly rather than always spelling out a weekday and date. */
export function rampLabel(date: CivilDate, today: CivilDate): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return `${formatDay(date).weekday.slice(0, 3)}, ${formatShortDate(date)}`;
}

/** What `Enter` would commit right now, or null if nothing is staged. An
 * explicit `picked` date always wins over a ramp offset. */
export function stagedDate(
  session: Pick<OverdriveSession, "ramp" | "picked" | "source">,
  ctx: Pick<PlacementContext, "today" | "workdaysOnly" | "workdays">,
): CivilDate | null {
  if (session.picked) return session.picked;
  if (session.ramp === null) return null;
  return rampDate(session.ramp, ctx, overdriveBase(session.source, ctx).base);
}

/** Stage an explicit date from the day picker (`D`). Does NOT snap to an
 * eligible day (decision #4) — a deliberately chosen Saturday stays on
 * Saturday, same rule the sheet's own date field follows. */
export function stageDate(session: OverdriveSession, date: CivilDate): OverdriveSession {
  return { ...session, picked: date, ramp: null };
}

// ---------------------------------------------------------------------------
// reduce — the whole interaction, one keypress at a time
// ---------------------------------------------------------------------------

export function reduce(
  session: OverdriveSession,
  action: KeyAction,
  ctx: Pick<PlacementContext, "today" | "workdaysOnly" | "workdays">,
  lists: ListContext,
): ReduceResult {
  const { min } = overdriveBase(session.source, ctx);
  switch (action) {
    case "wontDo":
      // Stage-aware, symmetric with "ramp"/"rampWeek" staging forward: a
      // ramped-past-where-you-meant-it overshoot is exactly what "step back
      // toward base" is for. Only commits once nothing is left to unstage —
      // discovered live (round 2 feedback) after `←` committed "won't do"
      // outright on an overshot ramp, discarding it instead of walking it
      // back. Shared by both the `←` key AND the "Won't do" button
      // (`overdrive-overlay.tsx` dispatches the same action either way) —
      // a mis-click mid-stage carries the same accidental-commit risk a
      // stray keypress does.
      if (session.picked !== null) {
        return { session: { ...session, picked: null } };
      }
      if (session.ramp !== null) {
        return {
          session: { ...session, ramp: session.ramp > min ? session.ramp - 1 : null },
        };
      }
      return { session, commit: { kind: "dropped" } };

    case "done":
      return { session, commit: { kind: "done" } };

    case "toList":
      return {
        session,
        commit: { kind: "listed", listId: lists.currentListId ?? lists.backlogListId },
      };

    case "toBacklog":
      return { session, commit: { kind: "listed", listId: lists.backlogListId } };

    case "ramp":
      return {
        session: {
          ...session,
          ramp: Math.min(session.ramp === null ? min : session.ramp + 1, RAMP_MAX),
          picked: null,
        },
      };

    case "rampWeek":
      return {
        session: {
          ...session,
          ramp: Math.min(
            session.ramp === null ? Math.max(WEEK_STEP, min) : session.ramp + WEEK_STEP,
            RAMP_MAX,
          ),
          picked: null,
        },
      };

    case "confirm": {
      const date = stagedDate(session, ctx);
      // Enter with nothing staged is a no-op, not a write — scheduling is
      // the one verdict that requires an explicit confirm precisely so a
      // stray keypress can never write a day nobody chose.
      if (!date) return { session };
      return { session, commit: { kind: "scheduled", date } };
    }

    case "cancel":
      if (session.ramp !== null || session.picked !== null) {
        return { session: { ...session, ramp: null, picked: null } };
      }
      // Nothing staged to cancel: Esc means "leave Overdrive".
      return { session, exit: true };

    case "stepBack": {
      const last = session.decided.at(-1);
      if (!last) return { session };
      return {
        session: {
          ...session,
          index: session.index - 1,
          ramp: null,
          picked: null,
          decided: session.decided.slice(0, -1),
        },
        stepBack: last,
      };
    }
  }
}

/**
 * Record a committed verdict and advance to the next card. Split from
 * `reduce` because the write it follows is async (`undoId` only exists once
 * `pushUndo` has run) — `reduce` stays synchronous and pure; this is the one
 * step the caller performs in between the write and the next render.
 */
export function applyDecision(
  session: OverdriveSession,
  verdict: Verdict,
  undoId: string,
  label: string,
): OverdriveSession {
  const todoId = session.queue[session.index];
  return {
    ...session,
    index: session.index + 1,
    ramp: null,
    picked: null,
    decided: [...session.decided, { todoId, verdict, undoId, label }],
  };
}

/** Tally of decided verdicts, for the finish screen. */
export interface Tally {
  dropped: number;
  done: number;
  listed: number;
  scheduled: number;
}

export function summarize(decided: readonly Decision[]): Tally {
  const tally: Tally = { dropped: 0, done: 0, listed: 0, scheduled: 0 };
  for (const { verdict } of decided) tally[verdict.kind]++;
  return tally;
}
