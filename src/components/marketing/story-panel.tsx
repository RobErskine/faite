import { ListChecks } from "lucide-react";
import { badgeVariants } from "@/components/ui/badge";
import { edge, tint } from "@/lib/colors";
import { priorityRail } from "@/lib/priority";
import { cn } from "@/lib/utils";
import { DemoCheckbox, MOVE_SUBTASKS, MOVE_TODO_TITLE } from "./demo-board";

/**
 * The product, beside the room.
 *
 * One card — the same "Plan living room move" the hero board opens with — with
 * its five sub-tasks showing. It is pinned at the top of the copy column for
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
}: {
  /** How many sub-tasks are ticked: 0 at the top of the story, 5 at the end. */
  doneThrough?: number;
}) {
  const rail = priorityRail(1);
  const home = { name: "Home", color: "#46a758" };

  return (
    <div
      className="overflow-hidden rounded-xl border border-border bg-surface-1 shadow-card"
      /*
        The card is a picture of software, like the hero board — but unlike the
        hero board it is NOT `aria-hidden`. The sub-task titles are the story's
        own argument in miniature ("get everything out of my head", "decide
        about the old bookcase"), so they are content, not sample data, and a
        screen reader should hear them once, here, instead of hearing forty
        to-dos on the board above.
      */
      aria-label={`${MOVE_TODO_TITLE}: ${doneThrough} of ${MOVE_SUBTASKS.length} done`}
      role="group"
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
              >
                <ListChecks className="size-2.5" aria-hidden />
                {doneThrough}/{MOVE_SUBTASKS.length}
              </span>
              <span
                className={cn(badgeVariants({ variant: "secondary" }), "text-2xs font-normal")}
                style={{
                  backgroundColor: tint(home.color),
                  borderColor: edge(home.color),
                  color: home.color,
                }}
              >
                {home.name}
              </span>
            </span>
          </div>
        </div>
      </div>

      <ul className="border-t border-border/60">
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
              className="flex items-start gap-2 border-b border-border/60 py-2 pr-3 pl-6 last:border-b-0"
            >
              <DemoCheckbox done={done} className="mt-0.5" />
              <span
                className={cn(
                  "text-sm leading-snug transition-colors",
                  done ? "text-muted-foreground line-through" : "text-foreground",
                )}
              >
                {subtask.title}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
