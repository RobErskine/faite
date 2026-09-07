import { CalendarClock, CornerDownRight, ListChecks, MapPin, Repeat } from "lucide-react";
import { badgeVariants } from "@/components/ui/badge";
import { priorityRail } from "@/lib/priority";
import { cn } from "@/lib/utils";
import { DemoCheckbox, MOVE_SUBTASKS, MOVE_TODO_TITLE } from "./demo-board";
import { DemoTooltip } from "./demo-tooltip";

/**
 * The product, beside the room.
 *
 * One card — the same "Plan living room move" the hero board opens with — with
 * its sub-tasks showing, one per story beat. It is pinned at the top of the copy column for
 * the whole story (`RoomStage`'s `panel` slot), so what the room is doing and
 * what the list says about it are never more than a glance apart. That pairing
 * is the argument the page is making; putting the two in sequence instead of
 * side by side would lose it.
 *
 * # Why `doneThrough` is a prop and not a hook
 *
 * Each of the five sub-tasks belongs to one story beat, in order, so "how far
 * has the reader scrolled" and "how much of this card is done" are the same
 * number. EI-278 drives that number from the scroll ref and ticks the boxes
 * live; until then — and forever after, for anyone on reduced motion, without
 * WebGL, or with JS still in flight — the server renders a correct static
 * state from the same prop.
 *
 * That is deliberately the cheap way round. Building the live version first
 * and adding a fallback later produces a fallback nobody looks at; building
 * the static version first means the live layer is an enhancement over
 * something already right, and EI-278's degrade-gracefully requirement is
 * satisfied by construction rather than by a second code path.
 *
 * A Server Component, like `demo-board.tsx`, for the same reason: see that
 * file's header, and `demo-board.test.ts`, which guards both.
 */
export function StoryPanel({
  doneThrough = 0,
  flying = false,
}: {
  /** How many sub-tasks are ticked: 0 at the top of the story, 5 at the end. */
  doneThrough?: number;
  /**
   * This is the copy in flight, not the one at rest.
   *
   * Only two things differ. It drops `data-travel-target`, so the query that
   * finds the resting card cannot match it. And it is `aria-hidden`, because
   * the story would otherwise announce the same five sub-tasks twice.
   */
  flying?: boolean;
}) {
  const rail = priorityRail(1);
  /*
    Colorless, like every label the product can actually make. `createLabel`
    takes an optional decoration and no caller anywhere passes one — there is
    no color picker for a label, only for lists and tabs. This card had a green
    "Home" pill hardcoded, which is the same invented feature the hero board
    carried; `demo-board.test.ts` guards that file, and this one is the second
    place the same hex was written by hand.
  */
  const home = { name: "home" };

  return (
    <div
      /*
        Where the hero's card lands (EI-278). Marked on the resting copy only —
        the flying copy is rendered by `card-travel.tsx` and carries no
        attribute, so the two can never be confused for one another.
      */
      data-travel-target={flying ? undefined : ""}
      className="overflow-hidden rounded-xl border border-border bg-surface-1 shadow-card"
      /*
        The card is a picture of software, like the hero board — but unlike the
        hero board it is NOT `aria-hidden`. The sub-task titles are the story's
        own argument in miniature ("get everything out of my head", "decide
        about the old bookcase"), so they are content, not sample data, and a
        screen reader should hear them once, here, instead of hearing forty
        to-dos on the board above.
      */
      aria-label={flying ? undefined : `${MOVE_TODO_TITLE}: ${doneThrough} of ${MOVE_SUBTASKS.length} done`}
      aria-hidden={flying || undefined}
      role={flying ? undefined : "group"}
    >
      <div className="relative py-2.5 pr-3 pl-3">
        {rail && (
          <span
            aria-hidden
            style={{ width: rail.width, opacity: rail.opacity, backgroundColor: "var(--foreground)" }}
            className="pointer-events-none absolute inset-y-0 left-0"
          />
        )}
        <div className="flex items-start gap-2">
          <DemoCheckbox className="mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm leading-snug font-medium">{MOVE_TODO_TITLE}</p>
            <span className="mt-1.5 flex flex-wrap items-center gap-1">
              <span
                className={cn(badgeVariants({ variant: "outline" }), "num gap-1 text-2xs font-normal")}
                /* The real board explains this count with a native `title`
                   (`TodoMetaBadges`); matching it keeps the badge interrogable
                   without nesting a tooltip inside something this small. */
                title={`${doneThrough} of ${MOVE_SUBTASKS.length} sub-tasks done`}
              >
                <ListChecks className="size-2.5" aria-hidden />
                {/*
                  One flex child, not two. The badge is `inline-flex gap-1`, so
                  splitting the count into `<span>3</span>` plus a bare "/6"
                  text node made them two children and the gap rendered between
                  them: "3 /6". `story-ticks.tsx` rewrites the inner span.
                */}
                <span>
                  <span data-subtask-count>{doneThrough}</span>/{MOVE_SUBTASKS.length}
                </span>
              </span>
              <span
                className={cn(badgeVariants({ variant: "secondary" }), "text-2xs font-normal")}
              >
                {home.name}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* `data-subtask-list` is the handle `card-travel.tsx` sizes from zero
          to full height, which is what makes the card unfold as it travels
          rather than merely slide. */}
      <ul data-subtask-list className="border-t border-border/60">
        {MOVE_SUBTASKS.map((subtask, i) => {
          const done = i < doneThrough;
          return (
            <li
              key={subtask.title}
              /*
                `data-subtask` is EI-278's handle: the live layer ticks these
                by index from the rAF loop, without re-rendering the subtree.
              */
              data-subtask={i}
              data-done={done ? "" : undefined}
              /*
                `group` so the checkbox and the title can both read this row's
                `data-done`. That attribute is written twice: by the server
                from `doneThrough`, and by `story-ticks.tsx` from the scroll
                loop. One attribute, one set of styles, two ways to set it —
                which is why a reader with no JavaScript sees a correct card
                rather than an empty one.
              */
              className="group flex items-start gap-2 border-b border-border/60 py-2 pr-3 pl-6 last:border-b-0"
            >
              <DemoCheckbox done={done} live className="mt-0.5" />
              <span
                className={cn(
                  "text-sm leading-snug transition-colors",
                  done
                    ? "text-muted-foreground line-through"
                    : "text-foreground group-data-done:text-muted-foreground group-data-done:line-through",
                )}
              >
                {/*
                  Faite's Location field, drawn the way `TitleMarkers` draws it
                  on a real card: a pin inside the title's inline flow, right
                  before the text, with the place name for screen readers.

                  One sub-task in the story has one, and it is the one that is
                  actually about going somewhere. A pin on every line would be
                  decoration; on this line it is the product.
                */}
                {/*
                  A recurring to-do carries a repeat MARKER, not "— every
                  Wednesday" in its title. The schedule is a property you
                  interrogate, the way `TitleMarkers` presents it on a real
                  card, not part of the task's name.
                */}
                {subtask.repeat && (
                  <DemoTooltip
                    label={`Repeats: ${subtask.repeat.toLowerCase()}`}
                    className="mr-1 align-[-0.1875em] text-muted-foreground"
                  >
                    <Repeat className="size-3" aria-hidden />
                  </DemoTooltip>
                )}
                {/*
                  The rollover marker, hidden until the card has actually
                  rolled. `story-ticks.tsx` reveals it and rewrites its
                  tooltip; the server renders day one, where nothing has been
                  missed yet.
                */}
                {subtask.rolls && (
                  <span data-roll-marker hidden className="contents">
                    <DemoTooltip
                      label="Rolled from Wed, Sep 9"
                      className="mr-1 align-[-0.1875em] text-muted-foreground"
                    >
                      <CornerDownRight className="size-3" aria-hidden />
                    </DemoTooltip>
                  </span>
                )}
                {subtask.location && (
                  <DemoTooltip
                    label={subtask.location}
                    sr={`Location: ${subtask.location}.`}
                    className="mr-1 align-[-0.1875em] text-muted-foreground"
                  >
                    <MapPin className="size-3" aria-hidden />
                  </DemoTooltip>
                )}
                {subtask.title}
                {/*
                  The day the card currently sits on, and — once it has rolled
                  twice — the Overflow badge. Both are the real board's own
                  vocabulary: a scheduled date reads through `CalendarClock`,
                  and Overflow is the urgency channel's destructive variant.

                  Rendered at day one and updated by `story-ticks.tsx`, so a
                  reader with no JavaScript sees a coherent card rather than an
                  empty one.
                */}
                {subtask.rolls && (
                  <span className="mt-1.5 flex flex-wrap items-center gap-1">
                    <span
                      className={cn(
                        badgeVariants({ variant: "outline" }),
                        "num gap-1 text-2xs font-normal",
                      )}
                    >
                      <CalendarClock className="size-2.5" aria-hidden />
                      <span data-roll-date>{subtask.rolls[0]}</span>
                    </span>
                    <span data-roll-overflow hidden className="contents">
                      <DemoTooltip label="Scheduled Wed, Sep 9 · in Overflow since Fri, Sep 11">
                        <span
                          className={cn(
                            badgeVariants({ variant: "destructive" }),
                            "num gap-1 text-2xs font-normal",
                          )}
                        >
                          <CornerDownRight className="size-2.5" aria-hidden />
                          In Overflow
                        </span>
                      </DemoTooltip>
                    </span>
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
