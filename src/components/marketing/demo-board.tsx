import { CalendarCheck, CornerDownRight, ListChecks, MapPin } from "lucide-react";
import { badgeVariants } from "@/components/ui/badge";
// `edge` only — the column accent is a real feature (lists and tabs both have
// a ColorPicker). `tint` went with the fabricated label colors.
import { edge } from "@/lib/colors";
import { priorityRail } from "@/lib/priority";
import { STORY_BEATS } from "@/lib/story-beats";
import { TITLE_CLAMP_CLASS } from "@/lib/title";
import { cn } from "@/lib/utils";
import { DemoTooltip } from "./demo-tooltip";

/**
 * The board, on the marketing page, as a picture that is not a picture.
 *
 * # Why this does not reuse `components/board/`
 *
 * `BoardColumn` imports `createLabel` from `lib/store/repositories`, so it
 * drags Dexie onto whichever page renders it, and `TodoCard` calls
 * `useSortable()` — it cannot render outside a `DndContext` at all. Below them,
 * `todo-row-parts.tsx` is `"use client"` and every badge in it is a Base UI
 * tooltip trigger.
 *
 * All three are the wrong trade here. `/` is the one page whose entire audience
 * is a cold-cache first-time visitor — `redirectIfKnownDevice` in
 * `app/page.tsx` sends everyone who has used the board before straight to
 * `/board`, ahead of paint — so every byte on it is spent on a stranger's first
 * impression. A hero that cannot be dragged, ticked, or hovered has no use for
 * drag sensors, a database, or a tooltip runtime.
 *
 * So this is a Server Component with no `"use client"` anywhere in its import
 * graph, which means it contributes **zero bytes of client JS**: it runs at
 * build time and ships as HTML. That is also what satisfies the app-shell
 * constraint for free — `npm run build:static` prerenders `/` to a redirect
 * script, and this component's code never reaches a bundle in either target.
 *
 * # What it does reuse
 *
 * The parts that carry meaning rather than behavior, so the demo cannot drift
 * from the product's own vocabulary: `priorityRail` (the achromatic rail,
 * docs/DESIGN.md §7), `tint`/`edge` (the identity ladder, §1),
 * `badgeVariants`, `TITLE_CLAMP_CLASS`, and the surface/type utilities from
 * `globals.css`. The markup is a hand-written echo of `todo-card.tsx` and
 * `board-column.tsx` — if either of those is restyled, this needs a look.
 *
 * # Why the data is a local type, not `Todo`
 *
 * A `Todo` is thirty-odd fields wide, and a card that can neither be scheduled,
 * synced, nor completed has a real value for about six of them. Literals of the
 * real record would be nine parts `null` to one part content, and the type
 * safety would be buying nothing: nothing here is passed to a function that
 * reads the other fields. `DemoTodo` says exactly what the demo draws.
 */

export interface DemoLabel {
  name: string;
  /**
   * Deliberately absent from every label in this file — see the note by the
   * label constants. The field stays because `todo-row-parts.tsx` supports it
   * and a future picker might, but a demo label must not use it.
   */
  color?: undefined;
}

export interface DemoTodo {
  title: string;
  /** Drives the achromatic left rail. Omitted means unprioritised. */
  priority?: 1 | 2 | 3 | 4;
  status?: "open" | "done";
  labels?: DemoLabel[];
  /** Inline glyph before the title, as `TitleMarkers` draws it. */
  deadlineAhead?: string;
  location?: string;
  /** The loud badge: a deadline already missed. */
  deadlineMissed?: string;
  /**
   * The Overflow badge and the dates behind its tooltip.
   *
   * Both dates, not just a count, because the real badge explains itself with
   * "Scheduled X · in Overflow since Y" — a number on its own says how long
   * without saying since when.
   */
  overflow?: { from: string; since: string; days: number };
  /**
   * The sub-tasks behind the `0/6` badge.
   *
   * Declared as text rather than a count because EI-278 ticks them off one by
   * one as the story scrolls, and the hero card is where that list starts.
   */
  subtasks?: { title: string; done?: boolean }[];
}

export interface DemoColumn {
  title: string;
  /** The eyebrow above the title: a date on a day column, prose elsewhere. */
  subtitle?: string;
  todos: DemoTodo[];
  /** Today: the one surface that steps up from the page (the Air pass). */
  emphasis?: boolean;
  /** Overflow: a rule under the title and a tinted count. */
  tone?: "urgent";
  /** A list column's own color, drawn as the header's 2px accent. */
  accentColor?: string;
  /** Overflow and Backlog — the pinned rails, on their own faint tint. */
  pinned?: boolean;
}

/** The card the whole homepage is about. EI-278 carries it into the story. */
export const MOVE_TODO_TITLE = "Plan living room move";

/**
 * The sub-tasks, in the order the story does them.
 *
 * DERIVED from `STORY_BEATS`, not written out again here: one sub-task per
 * beat is the identity EI-278 relies on to tick them from scroll progress, and
 * a second hand-maintained copy of the list is exactly how that identity would
 * quietly stop holding. On the hero none of them are done yet — that is the
 * point of the `0/6`.
 */
export const MOVE_SUBTASKS: {
  title: string;
  location?: string;
  repeat?: string;
  rolls?: string[];
  when?: { date: string; time: string };
  done?: boolean;
}[] = STORY_BEATS.map((beat) => ({
  title: beat.subtask,
  location: beat.subtaskLocation,
  repeat: beat.subtaskRepeat,
  rolls: beat.subtaskRolls,
  when: beat.subtaskWhen,
}));

/*
  Labels are COLORLESS, because that is the only kind Faite makes.

  `createLabel` takes an optional decoration and every one of its five call
  sites passes a name and nothing else — there is no color picker for a label
  anywhere in the product, only for lists and tabs (`list-info-dialog.tsx`,
  `tab-info-dialog.tsx`). `todo-row-parts.tsx` will tint a label that has a
  color, so the earlier demo board painted three of them and invented a
  feature: the hero was advertising something a new user could never reproduce.

  A real label renders as a plain `secondary` pill, which is what these are.
*/
const HOME: DemoLabel = { name: "home" };
const ERRANDS: DemoLabel = { name: "errands" };

/**
 * A believable Wednesday.
 *
 * Dates are hard-coded rather than derived from `new Date()`: `/` is
 * prerendered, so a computed "today" would be frozen at build time anyway —
 * and a date that is silently three months stale reads worse than one that was
 * obviously always a sample.
 */
export const DEMO_COLUMNS: DemoColumn[] = [
  {
    title: "Overflow",
    subtitle: "Put off too long",
    tone: "urgent",
    pinned: true,
    todos: [
      {
        title: "Sort through the mail pile",
        priority: 4,
        overflow: { from: "Sep 1", since: "Sep 1", days: 6 },
      },
      {
        title: "Cancel unused subscription",
        overflow: { from: "Sep 1", since: "Sep 4", days: 3 },
      },
    ],
  },
  {
    title: "Monday",
    subtitle: "Today · Sep 7",
    emphasis: true,
    todos: [
      {
        title: MOVE_TODO_TITLE,
        priority: 1,
        labels: [HOME],
        deadlineAhead: "Sep 26",
        subtasks: MOVE_SUBTASKS,
      },
      { title: "Call the plumber about the leak", priority: 2, labels: [HOME] },
      { title: "Reply to Sarah's email", priority: 3 },
      {
        title: "Return library books",
        priority: 4,
        location: "Central branch",
        labels: [ERRANDS],
      },
      { title: "Back up old photos", status: "done" },
    ],
  },
  {
    title: "Tuesday",
    subtitle: "Sep 8",
    todos: [
      { title: "Schedule dentist appointment", priority: 2 },
      { title: "Measure the living room", priority: 3 },
      { title: "Renew passport", deadlineMissed: "Sep 4" },
    ],
  },
  {
    title: "Wednesday",
    subtitle: "Sep 9",
    todos: [
      { title: "Research flight options", priority: 3 },
      { title: "Replace the air filter", priority: 4 },
    ],
  },
];

/**
 * The planning half.
 *
 * These are the lists a real first run actually creates — `SEED_LISTS` in
 * `lib/store/repositories.ts` seeds Backlog, Brain Dump, Grocery List, To Buy
 * and To Read. The earlier version invented "Home" and "Errands", which is a
 * smaller lie than the colored labels but the same kind: a visitor who signs
 * up should recognize the board they were shown.
 *
 * The column colors ARE real — lists and tabs both have a `ColorPicker`
 * (`list-info-dialog.tsx`, `tab-info-dialog.tsx`), so a user can produce
 * exactly this. A brand-new board is uncolored; this one is a board somebody
 * has been using, which is the honest thing for a hero to show.
 */
export const DEMO_LISTS: DemoColumn[] = [
  {
    title: "Backlog",
    subtitle: "Unscheduled",
    pinned: true,
    todos: [
      { title: "Draft blog post outline" },
      { title: "Organize the garage", priority: 4 },
    ],
  },
  {
    title: "Brain Dump",
    accentColor: "#46a758",
    todos: [
      { title: "Fix the squeaky door hinge", priority: 3 },
      { title: "Look into that noise the car makes" },
    ],
  },
  {
    title: "To Buy",
    accentColor: "#00a2c7",
    todos: [
      { title: "Picture hooks", priority: 3, labels: [HOME] },
      { title: "Bin bags for the donation run" },
    ],
  },
];

/**
 * The board's checkbox, as a picture of one.
 *
 * A `span`, not `ui/checkbox.tsx` — that one is `"use client"` and nothing on
 * this page has anything to tick. Same 16px square, same square corners (see
 * that file for why a 4px radius is wrong at this size), same `--primary` fill
 * when checked.
 *
 * Exported because the story panel (`story-panel.tsx`) ticks the same boxes
 * the hero board draws, and two hand-rolled checkmarks would drift apart.
 */
export function DemoCheckbox({
  done,
  live,
  className,
}: {
  done?: boolean;
  /**
   * Take the checked state from the nearest ancestor carrying `data-done`
   * rather than from the `done` prop.
   *
   * The story's sub-tasks are ticked by `story-ticks.tsx`, which toggles an
   * attribute from a scroll loop rather than re-rendering React. So the mark
   * has to be in the DOM already and revealed by CSS — a conditional `{done &&
   * …}` cannot be turned on by an attribute. The `done` prop still decides
   * what the SERVER renders, which is what a reader with no JavaScript keeps.
   */
  live?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-none border transition-colors",
        done ? "border-primary bg-primary" : "border-muted-foreground",
        live && "group-data-done:border-primary group-data-done:bg-primary",
        className,
      )}
    >
      {(done || live) && (
        <svg
          viewBox="0 0 16 16"
          className={cn(
            "size-3 text-primary-foreground transition-opacity",
            live && !done && "opacity-0 group-data-done:opacity-100",
          )}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
        </svg>
      )}
    </span>
  );
}

/**
 * A card row.
 *
 * The geometry is `todo-card.tsx`'s and the comments there explain each piece:
 * the rail is an absolutely positioned span rather than `border-l`, the
 * checkbox sits in the left gutter, and `indent-6` on the first line alone is
 * what lets the title wrap underneath it.
 */
function DemoCard({ todo }: { todo: DemoTodo }) {
  const done = todo.status === "done";
  const rail = priorityRail(todo.priority);
  const subtaskTotal = todo.subtasks?.length ?? 0;
  const subtaskDone = todo.subtasks?.filter((s) => s.done).length ?? 0;

  const badges =
    todo.labels?.length ||
    todo.deadlineMissed ||
    todo.overflow ||
    subtaskTotal > 0;

  return (
    <div
      /*
        The one card the homepage story follows (EI-278). `card-travel.tsx`
        measures this element every frame and flies a copy of it from here into
        the story's panel; nothing here changes if that never runs.
      */
      data-travel-origin={todo.title === MOVE_TODO_TITLE ? "" : undefined}
      className="group relative block border-b border-border/60 py-2 pr-2 pl-3 last:border-b-0"
    >
      {rail && (
        <span
          aria-hidden
          data-priority-rail={todo.priority}
          style={{
            width: rail.width,
            opacity: rail.opacity,
            ...(rail.dotted
              ? {
                  backgroundImage:
                    "repeating-linear-gradient(to bottom, var(--foreground) 0 2px, transparent 2px 5px)",
                }
              : { backgroundColor: "var(--foreground)" }),
          }}
          className="pointer-events-none absolute inset-y-0 left-0"
        />
      )}

      <DemoCheckbox done={done} className="absolute top-2.5 left-3" />

      <div
        className={cn(
          "block w-full text-left text-sm leading-snug",
          done && "text-muted-foreground line-through",
        )}
      >
        <span className={cn("indent-6 wrap-break-word", TITLE_CLAMP_CLASS)}>
          {/*
            Every marker is a tooltip trigger, the way it is on the real board.
            A glyph you cannot interrogate is decoration; `TitleMarkers` puts
            each of these behind its own tooltip and so does this.
          */}
          {todo.deadlineAhead && (
            <DemoTooltip
              label={`Due ${todo.deadlineAhead}`}
              className="mr-1 align-[-0.1875em] text-muted-foreground"
            >
              <CalendarCheck className="size-3" aria-hidden />
            </DemoTooltip>
          )}
          {todo.location && (
            <DemoTooltip
              label={todo.location}
              sr={`Location: ${todo.location}.`}
              className="mr-1 align-[-0.1875em] text-muted-foreground"
            >
              <MapPin className="size-3" aria-hidden />
            </DemoTooltip>
          )}
          {todo.title}
          {rail && <span className="sr-only"> — {rail.label}</span>}
        </span>

        {badges && (
          <span className="mt-1.5 flex flex-wrap items-center gap-1">
            {subtaskTotal > 0 && (
              <DemoTooltip label={`${subtaskDone} of ${subtaskTotal} sub-tasks done`}>
                <span
                  className={cn(
                    badgeVariants({ variant: "outline" }),
                    "num gap-1 text-2xs font-normal",
                  )}
                >
                  <ListChecks className="size-2.5" aria-hidden />
                  {subtaskDone}/{subtaskTotal}
                </span>
              </DemoTooltip>
            )}
            {todo.overflow && (
              <DemoTooltip
                label={`Scheduled ${todo.overflow.from} · in Overflow since ${todo.overflow.since}`}
              >
                <span
                  className={cn(
                    badgeVariants({ variant: "destructive" }),
                    "num gap-1 text-2xs font-normal",
                  )}
                >
                  <CornerDownRight className="size-2.5" aria-hidden />
                  In Overflow {todo.overflow.days} days
                </span>
              </DemoTooltip>
            )}
            {todo.deadlineMissed && (
              // The board leaves this one bare, but a red badge reading
              // "Deadline Sep 4" beside a card scheduled for Sep 8 is the one
              // most worth explaining: the date has passed, and that is the
              // whole reason it is loud.
              <DemoTooltip label={`Deadline was ${todo.deadlineMissed} — now past`}>
                <span
                  className={cn(badgeVariants({ variant: "destructive" }), "text-2xs font-normal")}
                >
                  Deadline <span className="num">{todo.deadlineMissed}</span>
                </span>
              </DemoTooltip>
            )}
            {todo.labels?.map((label) => (
              /*
                No `tint`/`edge` style any more. `DemoLabel.color` is typed
                `undefined` because Faite has no way to color a label, so the
                identity ladder that used to be applied here was resolving to
                `undefined` on every render — dead code that still read, to
                anyone skimming, as though colored labels were a thing.
              */
              <DemoTooltip key={label.name} label={`Label: ${label.name}`}>
                <span
                  className={cn(badgeVariants({ variant: "secondary" }), "text-2xs font-normal")}
                >
                  {label.name}
                </span>
              </DemoTooltip>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

/** A column, echoing `board-column.tsx`'s header and body. */
function DemoColumnView({ column, dayTrack }: { column: DemoColumn; dayTrack?: boolean }) {
  return (
    <section
      aria-label={column.title}
      className={cn(
        "group/column relative flex flex-col rounded-md",
        dayTrack && column.emphasis && "bg-surface-1 shadow-card",
        column.pinned && "rounded-lg bg-surface-0",
        "min-w-0 flex-1",
      )}
    >
      <header
        className={cn(
          "relative flex items-start justify-between gap-2 px-3 pt-2.5 pb-2",
          column.accentColor && "border-b-2",
          column.tone === "urgent" && "border-b-2 border-urgent/40",
          dayTrack && column.emphasis && "hairline-spectrum",
        )}
        style={column.accentColor ? { borderColor: edge(column.accentColor) } : undefined}
      >
        <div className="min-w-0">
          {column.subtitle && (
            <p className={cn("type-eyebrow", dayTrack && "num")}>{column.subtitle}</p>
          )}
          <div className="flex min-w-0 items-center gap-1.5">
            <h3
              className={cn(
                "min-w-0 truncate type-column-title",
                // Days are the stage, lists are containers.
                dayTrack && column.emphasis
                  ? "text-xl"
                  : dayTrack || column.pinned
                    ? "text-lg"
                    : "text-base",
                dayTrack && !column.emphasis && "text-muted-foreground",
              )}
            >
              {column.title}
            </h3>
            {column.tone === "urgent" && column.todos.length > 0 && (
              <span
                aria-hidden
                className="num shrink-0 rounded-4xl bg-urgent/10 px-1.5 text-2xs font-medium text-urgent"
              >
                {column.todos.length}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-col">
        {column.todos.map((todo) => (
          <DemoCard key={todo.title} todo={todo} />
        ))}
      </div>
    </section>
  );
}

/**
 * The whole thing: the calendar half over the planning half, the two-track
 * shape a returning user would recognize from `/board` itself.
 *
 * `aria-hidden` with a caption instead: this is a picture of software, and
 * every string in it is a sample. Read aloud it would be forty to-dos of noise
 * standing between a visitor and the one link on the page. The surrounding
 * hero copy in `app/page.tsx` carries the actual meaning.
 */
export function DemoBoard({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-card",
        className,
      )}
    >
      {/* The calendar half: Overflow pinned to the left of the day track. */}
      <div className="flex items-start gap-3 px-3 py-2">
        {DEMO_COLUMNS.map((column) => (
          <DemoColumnView
            key={column.title}
            column={column}
            dayTrack={!column.pinned}
          />
        ))}
      </div>

      {/* The planning half: Backlog pinned to the left of the list columns. */}
      <div className="flex items-start gap-3 px-3 pt-2 pb-3">
        {DEMO_LISTS.map((column) => (
          <DemoColumnView key={column.title} column={column} />
        ))}
      </div>
    </div>
  );
}
