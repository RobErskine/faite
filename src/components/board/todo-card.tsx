"use client";

import { useEffect, useRef, useState } from "react";
import type {
  KeyboardEventHandler,
  MouseEventHandler,
  TouchEventHandler,
} from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DragGrip } from "./drag-grip";
import { PriorityRail, TitleMarkers, TodoMetaBadges } from "./todo-row-parts";
import { cardStop, navKeyOf, type NavKey } from "@/lib/column-nav";
import { formatCompletionStamp } from "@/lib/event-time";
import { priorityRail } from "@/lib/priority";
import { TITLE_CLAMP_CLASS } from "@/lib/title";
import { rollEventsFor } from "@/lib/rollover-events";
import type { Label as LabelRecord, ReminderPreset, Todo } from "@/lib/schema";
import type { PlacementContext } from "@/lib/scheduling";
import { originOf, type ConfettiOrigin } from "@/lib/celebrate";

interface TodoCardProps {
  todo: Todo;
  labels: LabelRecord[];
  /** Named reminder times (EI-106 P5) — see `TodoMetaBadges`. */
  reminderPresets?: ReminderPreset[];
  ctx: PlacementContext;
  /**
   * IANA zone for the completion stamp on the checkbox (EI-192).
   *
   * A prop rather than a field on `ctx`, matching how `TodoSheet` and
   * `DaySheet` already receive it. `PlacementContext` carries civil dates and
   * every formatter that reads it is pinned to UTC on purpose
   * (`scheduling.ts`'s header); a zone-aware instant has no business in there.
   */
  timezone?: string;
  /** Part of the Cmd/Ctrl+click multi-selection (EI-194). */
  isSelected?: boolean;
  /**
   * Being carried by a multi-drag, but is not the card under the cursor.
   * Ghosted like the lifted row so the whole run visibly leaves together.
   */
  isGhosted?: boolean;
  /** `additive` is Cmd/Ctrl; `range` is Shift. Both false means a plain click. */
  onSelect?: (todoId: string, modifiers: { additive: boolean; range: boolean }) => void;
  /** Scheduled outside the visible window — shown dimmed in its list column. */
  isAway?: boolean;
  /** Draw the drop indicator immediately above this card. */
  showInsertionLine?: boolean;
  /**
   * This row is mid-flight: the drag overlay is still travelling to it. Held
   * invisible so the ghost and the real row are never both on screen, but kept
   * in layout so the column does not resize under the animation.
   */
  isLanding?: boolean;
  /**
   * False where the card cannot be dragged — the day sheet's timeline, which
   * renders outside the board's DndContext. Drops the grip and the grab cursor,
   * which would otherwise advertise a gesture that does nothing there.
   *
   * Deliberately does NOT gate the `useSortable` call below. That hook must run
   * unconditionally (it is a hook), and outside a DndContext it is inert anyway:
   * dnd-kit's default context has a no-op dispatch and no items, so nothing is
   * registered and `listeners` comes back empty.
   */
  draggable?: boolean;
  /**
   * `origin` is where on screen the toggle happened, for GOOD JOB mode's
   * confetti (`lib/celebrate.ts`). Optional so the several components that
   * merely forward this handler need no changes, and measured HERE rather
   * than looked up by id in the handler — `day-sheet.tsx` renders a second
   * card for a to-do the board is already showing, so an id lookup would find
   * the wrong one and burst behind the sheet.
   */
  onToggle: (todo: Todo, origin?: ConfettiOrigin | null) => void;
  onOpen: (todo: Todo) => void;
  /**
   * Arrow-key navigation out of this row. Returns true when focus moved, so
   * the handler only calls `preventDefault` for a press it actually consumed.
   */
  onNavigate?: (fromStopId: string, key: NavKey) => boolean;
  /**
   * Occurrences currently outstanding on this card — see
   * `lib/recurrence-expand.ts`. Null/undefined/`<= 1` shows no badge: a
   * single overdue occurrence already reads as overdue from Overflow
   * placement alone, and a badge there would just be noise.
   */
  missedCount?: number | null;
  /**
   * "Every week on Fri" — the caller's summary of the series this occurrence
   * belongs to. The card only knows `recurrenceParentId`, not the rule
   * itself (that lives on the template row), so this has to be threaded in
   * rather than computed here. Undefined renders the marker with no tooltip
   * content beyond the generic `sr-only` fallback.
   */
  recurrenceSummary?: string;
  /**
   * Sub-task done/total counts (EI-183) — see `use-board-data.ts`'s
   * `subtaskCounts`. Undefined/null, or a `total` of 0, shows no badge: a
   * todo with no sub-tasks has nothing to report progress on.
   */
  subtaskCount?: { done: number; total: number } | null;
  /**
   * How many files are attached (EI-242) — see `use-board-data.ts`'s
   * `attachmentCounts`. Undefined or 0 shows no badge.
   */
  attachmentCount?: number;
}

export function TodoCard({
  todo,
  labels,
  reminderPresets,
  ctx,
  timezone = "UTC",
  isSelected,
  isGhosted,
  onSelect,
  isAway,
  showInsertionLine,
  isLanding,
  draggable = true,
  onToggle,
  onOpen,
  onNavigate,
  missedCount,
  recurrenceSummary,
  subtaskCount,
  attachmentCount,
}: TodoCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: todo.id });

  // dnd-kit types its listeners as bare `Function`, which spreads onto an
  // element fine but cannot be assigned to a specific handler prop. The
  // activators go to different elements here, so name them once.
  //
  // `onMouseDown`/`onTouchStart`, not `onPointerDown`: the board runs a
  // MouseSensor and a TouchSensor rather than one PointerSensor (§4.8), and each
  // sensor names its own activator. Destructuring the wrong one fails silently —
  // an undefined handler is a row that simply does not drag.
  const {
    onMouseDown: startMouseDrag,
    onTouchStart: startTouchDrag,
    onKeyDown: startKeyboardDrag,
  } = (listeners ?? {}) as {
    onMouseDown?: MouseEventHandler;
    onTouchStart?: TouchEventHandler;
    onKeyDown?: KeyboardEventHandler;
  };

  /** Kept locally only for the sr-only priority label below — the visual
   * rail itself is rendered by `<PriorityRail>`. */
  const rail = priorityRail(todo.priority);

  /*
   * Null for an open to-do, which is what keeps the tooltip off every card on
   * an ordinary board. `completedAt` is stamped for `dropped` as well as
   * `done` — the field really means "settled at" — so the wording branches
   * rather than claiming everything was completed.
   */
  const completionStamp = formatCompletionStamp(todo.status, todo.completedAt, timezone);

  /**
   * The Faite Loop, made visible: the last roll event tells us whether this
   * card is still rolling (show the marker) or has fallen into Overflow
   * (show the age badge) — never both, they're mutually exclusive states of
   * the same sequence. `rollEventsFor` already returns `[]` for settled and
   * recurring todos, so this is a no-op for both.
   */
  const lastRoll = rollEventsFor(todo, ctx).at(-1);
  const rolledFrom =
    lastRoll?.kind === "rolledOver"
      ? { from: lastRoll.from, rolls: lastRoll.rolls, overflowsIn: lastRoll.overflowsIn }
      : undefined;
  const overflowInfo =
    lastRoll?.kind === "overflowed"
      ? { from: lastRoll.from, since: lastRoll.day, rolls: lastRoll.rolls }
      : undefined;

  /**
   * Whether the clamp is actually cutting the title off — the gate on the
   * full-title tooltip, so it cannot fire on a title that already fits.
   *
   * Measured with a ResizeObserver rather than on hover. Measuring on hover is
   * the obvious cheaper thing and it does not work: the measurement is what
   * enables the trigger, so it lands *after* the `mouseenter` Base UI would have
   * opened on, and the tooltip only appears the second time you hover. An
   * observer also covers the other way this answer changes — the column being
   * resized, which no interaction reports.
   */
  const titleRef = useRef<HTMLSpanElement | null>(null);
  const [titleClamped, setTitleClamped] = useState(false);

  /**
   * The checkbox's on-screen box, for GOOD JOB mode's confetti origin. Read
   * synchronously in the toggle handlers below, because completing removes
   * this card from the board — a moment later there is nothing left to
   * measure.
   */
  const checkboxRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const el = titleRef.current;
    // Absent in happy-dom, which has no layout to observe anyway.
    if (!el || typeof ResizeObserver === "undefined") return;

    // The +1 absorbs sub-pixel line-height rounding, which otherwise reports a
    // one-line title as clamped at some zoom levels.
    const measure = () => setTitleClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [todo.title]);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      /*
        Mouse and touch drags start anywhere on the row. Only those two
        activators move here — `attributes` (role, tabIndex,
        aria-roledescription) and the keyboard activator stay on the grip,
        because making the row itself a focusable `role="button"` would nest
        interactive controls inside it.

        The two concerns that originally kept dragging on the grip alone turn
        out to be dnd-kit's job, not ours: on activation it clears the document
        selection and keeps clearing it, and it registers a capture-phase click
        listener that swallows the trailing click — so a drag never also opens
        the detail sheet. Below the mouse's 4px threshold, and inside touch's
        250ms delay, nothing activates — so taps on the checkbox and title
        behave exactly as before, and a swipe still scrolls the column.
      */
      onMouseDown={startMouseDrag}
      onTouchStart={startTouchDrag}
      /*
        Multi-select (EI-194). Capture phase on the ROW is the only place this
        can go, and each of the three things it has to not break is already
        handled by something else:

        - The 4px drag threshold is untouched — `onMouseDown` still reaches
          `MouseSensor` first. If a drag DID activate, dnd-kit has registered
          a capture-phase `click` listener on `document` that stops
          propagation and stays attached 50ms past `detach()`, and document
          capture runs before this. So a Cmd+drag can never also toggle
          selection.
        - The detail sheet still opens on a plain click: the title's own
          `onClick` is a bubble-phase handler on a descendant, and the
          unmodified branch below deliberately does NOT stop propagation.
        - The checkbox still toggles on a plain click, and on a modified one
          selects instead of ticking — one uniform rule for the whole row,
          with the `after:-inset-x-1` hit-area geometry left alone.

        macOS turns Ctrl+click into `contextmenu` and suppresses the `click`
        entirely, so `ctrlKey` is effectively the Windows/Linux path.
      */
      onClickCapture={(e) => {
        const additive = e.metaKey || e.ctrlKey;
        const range = e.shiftKey;
        if (!additive && !range) {
          // Let the click through to whatever it landed on; the document
          // listener in `use-board-ui-state.ts` handles collapsing.
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        onSelect?.(todo.id, { additive, range });
      }}
      // What the document-level "clear on click elsewhere" listener uses to
      // tell a click on a card from a click on the board behind it.
      data-todo-row=""
      /*
        A nav stop for the arrow keys (docs/KEYBOARD.md §11). `tabIndex={-1}`
        makes the row focusable programmatically WITHOUT joining the tab order,
        so Tab still walks the grip, checkbox and title exactly as before and
        the reasoning above still holds — the row takes focus but never a
        `role`, so no interactive control ends up nested inside a button.
      */
      tabIndex={-1}
      data-nav-stop={cardStop(todo.id)}
      onKeyDown={(e) => {
        const key = navKeyOf(e);
        if (key) {
          if (onNavigate?.(cardStop(todo.id), key)) e.preventDefault();
          return;
        }
        // Enter and Space belong to whichever control has focus. Only act when
        // the row itself does, or a press on the checkbox, the title button or
        // the drag grip would fire twice as it bubbled through here.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen(todo);
        } else if (e.key === " ") {
          e.preventDefault();
          // Same origin as a click, not the focused row: the checkbox is what
          // Space operates, so the confetti should leave from there too.
          onToggle(todo, originOf(checkboxRef.current));
        } else if (e.key === "x" || e.key === "X") {
          // The keyboard route into a multi-selection (EI-194). Space is
          // already spoken for by "toggle done", so selection needs a letter;
          // `x` is the mail-client convention and is registered in
          // `lib/shortcuts.ts` as a local shortcut.
          e.preventDefault();
          onSelect?.(todo.id, { additive: true, range: false });
        }
      }}
      className={cn(
        /*
          Not a flex row any more, and that is the point: the grip and the
          checkbox are both absolutely positioned in the left gutter, so the
          title block spans the full width and its second and third lines run
          *under* the checkbox instead of stopping at a flex column edge. Only
          the first line is indented (`indent-6` below), which is the one line
          that has to clear the checkbox.

          `pl-3` is the grip's 12px gutter; the checkbox sits at `left-3`,
          immediately after it.
        */
        "group relative block border-b border-border/60 py-1.5 pl-3 pr-2",
        draggable && "cursor-grab active:cursor-grabbing",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
        // Opacity transitions alongside the background so the row fades in when
        // a landing completes rather than popping. Hover only changes the
        // background, so naming both properties loses nothing over
        // `transition-colors`.
        "transition-[background-color,opacity] duration-100",
        "hover:bg-foreground/5 focus-within:bg-foreground/5",
        // The dragged row stays in place as a faint ghost so the list does not
        // visibly collapse out from under the cursor.
        /*
          Selected, but placed BEFORE the drag/landing states so those still
          win — a selected card being dragged must read as dragging.
        */
        isSelected && "bg-primary/10 ring-1 ring-inset ring-primary/30",
        isDragging && "opacity-30",
        // A non-dragged member of a multi-selection in flight: ghosted like
        // the lifted row so the whole run visibly leaves together.
        isGhosted && "opacity-30",
        // Held invisible while the overlay is still flying towards this slot.
        // Last, so it wins over the dragging and away states.
        isLanding && "opacity-0",
        isAway && !isLanding && "opacity-60",
      )}
    >
      {/*
        PRIORITY, as a rail rather than a chip.

        An absolutely positioned span, not `border-l`, for four separate reasons:

        - `box-sizing: border-box` plus a column-imposed width means a left
          border eats the content box, so a P1 card's checkbox and title would
          sit 3px right of a P4's. Inside one column that reads as broken
          alignment rather than as encoding.
        - The row already has `border-b`. A 3px coloured left border mitres
          against it into a visible diagonal wedge in the corner — worst exactly
          at P1, where the rail is thickest.
        - The insertion line below is positioned against the PADDING box, so a
          left border would shift where the drop indicator starts, per level.
          That position is load bearing: `data-drop-indicator` doubles as the
          drop animation's flight target (DRAG-AND-DROP §4.7).
        - `inset-y-0` stops the rail 1px short of `border-b`, so a run of
          same-priority cards reads as ticks rather than fusing into one stripe.

        The rail is `aria-hidden`; the level reaches screen readers as text
        inside the title button below.
      */}
      <PriorityRail priority={todo.priority} />

      {/*
        Insertion indicator: a solid line showing exactly where the dragged item
        will land. Without it the column highlight tells you *which* column but
        not *where* in it.
      */}
      {showInsertionLine && (
        <span
          aria-hidden
          data-drop-indicator
          className="absolute -top-px left-0 right-0 z-10 h-0.5 rounded-full bg-primary"
        >
          <span className="absolute -left-0.5 -top-[3px] size-2 rounded-full bg-primary" />
        </span>
      )}

      {/*
        The whole row drags, but the grip stays — out of the layout, and out of
        sight until you reach for it.

        It is still the keyboard drag activator: a real focusable control
        carrying `attributes` (role, tabIndex, aria-roledescription), which a
        bare div row cannot be without nesting interactive elements inside a
        button. `Space` on it still lifts, so the keyboard model is untouched.
        It is no longer the touch drag surface — TouchSensor's long-press covers
        the whole row now (board.tsx sensors), which is strictly better than one
        12px control.

        What changed is what it costs. In flow it took 20px of a ~108px title
        track at the --column-min floor. Absolutely positioned in the row's left
        gutter it takes none, and revealing it on hover or focus rather than
        leaving it faintly visible trades a little discoverability for that
        width — an acceptable trade now that the whole row is grabbable and the
        grip-means-draggable vocabulary is still taught by columns and tabs.

        `before:inset-x-0` is not tidiness. DragGrip expands its hit area to
        24×24 via `::before`, and an `opacity-0` element still receives pointer
        events — so out of flow, that expansion would sit over the checkbox and
        silently eat its clicks. Vertical only.
      */}
      {draggable && (
      <DragGrip
        className={cn(
          // `top-2.5` centres a 12px glyph on the first line of `text-sm
          // leading-snug` inside `py-1.5`.
          "absolute left-0 top-2.5",
          // Full strength rather than DragGrip's resting /30: at rest it is not
          // visible at all, so there is nothing left for a faint state to do.
          "text-muted-foreground opacity-0 transition-opacity",
          // `group-focus-within` also fires for the row itself, so arrowing onto
          // a card reveals the grip — which is how a keyboard user learns the
          // row can be lifted at all. `touch:` because `group-hover` is gated
          // to `(hover: hover)` (Tailwind v4) — a device that can never hover
          // would otherwise never see this control exists at all.
          "group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100",
          "focus-visible:opacity-100",
          "before:-inset-y-1.5 before:inset-x-0",
        )}
        aria-label={`Drag to reschedule or reorder ${todo.title}`}
        {...attributes}
        onKeyDown={startKeyboardDrag}
      />
      )}

      {/*
        Out of flow, in the gutter right after the grip, so the title can wrap
        beneath it. `top-2` centres a 16px box on the first line of `text-sm
        leading-snug` inside `py-1.5`.

        `after:-inset-x-1` narrows the shadcn base's 12px horizontal hit
        expansion to 4px. Left at 12px it would reach back to x=0 and cover the
        grip entirely, so a click meant for the grip would toggle done. At 4px the
        target is still 24px wide — the WCAG 2.2 minimum — and stops clear of the
        grip's glyph, which is painted between x≈4.5 and x≈7.5.

        `pointer-coarse:after:-inset-x-1` restates the same narrowing under
        `ui/checkbox.tsx`'s own `pointer-coarse:` hit-area growth (P1) —
        without it, the coarse-pointer rule would win on specificity-tie
        source order (it's declared later in the stylesheet) and silently
        widen the tap target back into the grip on exactly the devices where
        a stray tap is most likely.
      */}
      <Tooltip>
        {/*
          The trigger is a plain `span` WRAPPING the checkbox, not the checkbox
          itself.

          `render={<Checkbox/>}` was the obvious spelling and it does not work:
          `Checkbox` is Base UI's own `useRender` component, and composing two
          of those drops the trigger's pointer handlers on the floor. The
          checkbox rendered fine, kept every prop, and simply never opened a
          tooltip — `aria-describedby` stayed null through a full hover. Every
          working tooltip in this codebase triggers off a plain element (the
          location pin's span, the title's span) or a shadcn `Button`, which is
          a bare `<button>`; none of them nests a second Base UI primitive.

          Base UI adds no role and no tabIndex to a span trigger, so the
          checkbox remains the only control here — same reasoning as the
          location pin inside the title button.

          The positioning moves to this wrapper, but the HIT AREA does not:
          `after:-inset-x-1` stays on the checkbox and is measured from the
          checkbox's own box, so the 4px expansion still stops clear of the
          grip's glyph. That boundary is what its regression test protects,
          and it is unchanged.
        */}
        <TooltipTrigger
          disabled={!completionStamp}
          render={
            /*
              The ref rides the render element rather than the `Checkbox`
              because Base UI's own components take their ref for internals;
              this span is a plain element and already sits exactly on the
              checkbox, so its rect IS the checkbox's rect. GOOD JOB mode
              measures it at click time — see `onCheckedChange` below.
            */
            <span ref={checkboxRef} className="absolute left-3 top-2 inline-flex" />
          }
        >
          <Checkbox
            checked={todo.status === "done"}
            onCheckedChange={() => onToggle(todo, originOf(checkboxRef.current))}
            aria-label={`Mark ${todo.title} ${todo.status === "done" ? "not done" : "done"}`}
            data-completed-at={todo.completedAt ?? undefined}
            // Cursor is inherited, so without this the checkbox would read as a
            // drag surface. It still drags if you pull from it; it just should not
            // advertise that over being a checkbox.
            className="cursor-pointer after:-inset-x-1 pointer-coarse:after:-inset-x-1"
          />
        </TooltipTrigger>
        {completionStamp && <TooltipContent>{completionStamp}</TooltipContent>}
      </Tooltip>

      <button
        type="button"
        onClick={() => onOpen(todo)}
        className={cn(
          // `block w-full`, because a button is inline-block by default and
          // would otherwise shrink-wrap its text instead of taking the column's
          // width — leaving the title nothing to wrap within. This replaced a
          // `flex-1 min-w-0` pair when the row stopped being a flex container;
          // block boxes have no flex automatic minimum size, so the min-content
          // floor that used to push the row into the next column is simply gone.
          "block w-full text-left text-sm leading-snug",
          // Stated rather than inherited: dragging is the primary gesture over
          // the title now, and a click still opens the sheet.
          draggable && "cursor-grab active:cursor-grabbing",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded",
          /*
            Two settled statuses, two different reads — worth the extra branch
            now that the "Marked as won't do" filter can put them side by side.

            A strike-through means "this got done"; wearing it, `dropped` would
            claim credit for work that was abandoned, which is the exact
            distinction `todoStatusSchema` refuses to collapse. Both dim, since
            neither is live work; only `done` is struck.
          */
          todo.status !== "open" && "text-muted-foreground",
          todo.status === "done" && "line-through",
          todo.status === "dropped" && "opacity-70",
        )}
      >
        {/*
          The title wraps, then clamps. `wrap-break-word` earns its place
          independently of the clamp: one unbroken token longer than the track —
          a pasted URL — has no break opportunity, so it would still push past
          the column edge without it.

          `indent-6` is the checkbox's 16px box plus an 8px gap, and text-indent
          applies to the FIRST LINE ONLY — which is the whole trick behind
          wrapping under the checkbox.

          It survives `line-clamp` even though `-webkit-box` is not a block
          container: text-indent is inherited, so the anonymous block box holding
          this span's inline content picks it up and applies it to its own first
          line (CSS 2.1 §9.2.1.1 — anonymous boxes inherit inherited properties
          from the enclosing box).

          The markers live inside this same inline flow rather than beside it, so
          they sit on the indented first line and the text closes up after them.

          A nested tooltip: this span is a trigger for the full title, and the
          markers inside it are triggers of their own. Base UI handles that — it
          walks up to the closest enabled trigger and suppresses the ancestor
          while a nested one is hovered.
        */}
        <Tooltip>
          <TooltipTrigger
            disabled={!titleClamped}
            render={
              <span
                ref={titleRef}
                data-todo-title
                className={cn("indent-6 wrap-break-word", TITLE_CLAMP_CLASS)}
              >
                <TitleMarkers
                  todo={todo}
                  today={ctx.today}
                  recurrenceSummary={recurrenceSummary}
                  rolledFrom={rolledFrom}
                />
                {todo.title}
                {rail && <span className="sr-only"> — {rail.label}</span>}
                {/*
                  The tooltip is a pointer nicety; this is the real channel.
                  Base UI's `aria-describedby` only exists while the tooltip is
                  OPEN, so a screen-reader user who never hovers would never
                  hear it — and the checkbox's own `aria-label` is a name, not
                  a place to put a description.
                */}
                {completionStamp && <span className="sr-only"> — {completionStamp}</span>}
              </span>
            }
          />
          <TooltipContent>{todo.title}</TooltipContent>
        </Tooltip>

        <TodoMetaBadges
          todo={todo}
          labels={labels}
          today={ctx.today}
          showScheduledDate={isAway}
          missedCount={missedCount}
          overflow={overflowInfo}
          reminderPresets={reminderPresets}
          subtaskCount={subtaskCount}
          attachmentCount={attachmentCount}
        />
      </button>
    </div>
  );
}
