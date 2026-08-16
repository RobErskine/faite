"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CalendarDays, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Label as LabelRecord, List, ReminderPreset, Todo } from "@/lib/schema";
import { toCivilDate, type PlacementContext } from "@/lib/scheduling";
import { isTextEntry, undoById } from "@/lib/undo";
import {
  applyDecision,
  createSession,
  currentTodoId,
  isComplete,
  rampLabel,
  reduce,
  stageDate,
  stagedDate,
  summarize,
  type KeyAction,
  type ListContext,
  type OverdriveSession,
  type Verdict,
} from "@/lib/overdrive";
import {
  SWIPE_ACTION,
  resolveSwipeDirection,
  swipeProgress,
  type SwipeDirection,
} from "@/lib/overdrive-swipe";
import { useViewport } from "@/lib/use-viewport";
import { civilDateToLocalDate } from "./date-nav";
import { OverdriveCard } from "./overdrive-card";

/**
 * One stable id, not one per decision — sonner replaces a toast in place
 * when given the same `id` it already has, which is what turns "a new toast
 * per verdict" into "one toast that always reflects the most recent verdict"
 * (round 2 feedback: a growing stack made an older toast's Undo ambiguous —
 * would it also reverse everything decided after it? Simpler to only ever
 * have one thing to undo in the first place). Module-level rather than a
 * `useRef`: nothing about it is per-instance, and a fresh session reusing
 * the same id is exactly correct — the previous one is already dismissed by
 * the time a new overlay could exist (see the unmount effect below).
 */
const OVERDRIVE_TOAST_ID = "overdrive-last-decision";

/**
 * Safety net ONLY — the flick normally ends on its own `animationend`
 * (`finishFlick`, below), never on this timer.
 *
 * **Why a timer can't be the primary signal.** A wall-clock timeout starts
 * the instant `dispatch` runs; the CSS animation starts whenever the browser
 * next gets to paint that element — and in between sits the verdict's
 * IndexedDB write, the toast mounting, and the board's own `useLiveQuery`
 * re-render behind the overlay. Measured live, that gap swung between 31ms
 * and 111ms from one flick to the next, so a fixed timer handed the
 * animation somewhere between 230ms and 310ms of its 320ms to actually run —
 * and the card was cut off mid-flight every single time, at a visibly
 * different point each time (travel ranged 957px to 1945px on identical
 * input). That inconsistency is exactly what "sometimes it flies off,
 * sometimes it moves 20px" was: not a tuning problem, a synchronization one.
 * `animationend` fires relative to the animation's OWN start, so the two
 * cannot drift apart by construction.
 *
 * This timeout exists only for the case where `animationend` never arrives
 * at all — CSS failed to load, the animation was suppressed, the tab is
 * backgrounded — where the alternative is an overlay wedged forever. Set
 * well clear of the real animation (320ms) plus any plausible start delay,
 * so in normal operation `animationend` always wins the race.
 */
const FLICK_FALLBACK_MS = 1000;

type Direction = "left" | "right" | "up" | "down";

/** Mirrors the gesture that caused it: `←` = left, `↑` = up, `↓` = down,
 * `→` = right — the same arrows the verdict table already teaches. */
function directionForVerdict(kind: Verdict["kind"]): Direction {
  switch (kind) {
    case "dropped":
      return "left";
    case "done":
      return "up";
    case "listed":
      return "down";
    case "scheduled":
      return "right";
  }
}

/** The lucide icon shown in the drag indicator (below), matching whichever
 * verdict button the swipe direction fires — same iconography, so the badge
 * that fades in mid-drag reads as a preview of a real button rather than a
 * fifth, unrelated affordance. */
const SWIPE_ICON: Record<SwipeDirection, typeof ArrowLeft> = {
  left: ArrowLeft,
  up: ArrowUp,
  down: ArrowDown,
  right: ArrowRight,
};

/** Degrees of rotation per px of horizontal drag while a swipe is in
 * progress — `dx / SWIPE_ROTATE_DIVISOR`. Chosen so a drag that reaches
 * `SWIPE_COMMIT_PX` (`lib/overdrive-swipe.ts`, 96px) rotates about 8°, a
 * smaller echo of the flick's own 12° (`FLICK_CLASS`) rather than a match —
 * the drag preview should read as a preview, not pre-empt the flick's own
 * motion once it actually commits. */
const SWIPE_ROTATE_DIVISOR = 12;

/** Mirrors each verdict button's own label (below) — `down` needs the
 * current card's list name, same as the "Back to …" button does. */
function swipeIndicatorLabel(direction: SwipeDirection, listName: string): string {
  switch (direction) {
    case "left":
      return "Won’t do";
    case "up":
      return "Done";
    case "down":
      return `Back to ${listName}`;
    case "right":
      return "Schedule";
  }
}

/**
 * A genuine flick, not a slide — the card travels 150% of its own box, plus
 * a few degrees of rotation on the horizontal verdicts, the way an actual
 * index card twists when it's flicked off a stack by hand. Vertical
 * verdicts (`done`/`listed`) stay rotation-free — a card tossed straight up
 * or dropped down doesn't spin the way one flicked sideways does.
 *
 * **The unit has to match whatever CLIPS the card**, which is why it's
 * responsive — get it wrong in either direction and the animation spends
 * part of its runtime moving something the user can't see:
 *
 * - **`tall:` (the centred dialog, §9)** clips at the popup's own edge
 *   (`overflow-hidden`), a box barely wider than the card itself. `150%` —
 *   of the card's OWN box, which is what a `%` translate resolves against —
 *   clears it with margin. A viewport-sized value here would fling the card
 *   out of sight in the animation's first fraction and then animate nothing
 *   for the rest, reading as a dead pause.
 * - **Below `tall:` (full-bleed)** the clipping box is the whole viewport
 *   and the card sits centred in it with room on either side, so `150%` of
 *   the card would leave a sliver still on screen at the end — that was
 *   round 4a's bug exactly. `150vw`/`150vh` is what guarantees clearance
 *   there regardless of how wide the screen is next to the card.
 */
const FLICK_CLASS: Record<Direction, string> = {
  left: "slide-out-to-left-[150vw] tall:slide-out-to-left-[150%] -spin-out-12",
  right: "slide-out-to-right-[150vw] tall:slide-out-to-right-[150%] spin-out-12",
  up: "slide-out-to-top-[150vh] tall:slide-out-to-top-[150%]",
  down: "slide-out-to-bottom-[150vh] tall:slide-out-to-bottom-[150%]",
};

/** Read fresh each flick rather than cached — the OS setting (or a test)
 * can change between one verdict and the next. */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Overdrive (EI-97) — a one-card-at-a-time overlay for burning down the
 * Overflow column. See docs/OVERDRIVE.md.
 *
 * Mounted once in `board.tsx`, OUTSIDE `DndContext`, next to `DaySheet` —
 * same reasoning as that sheet: `OverdriveCard` renders todo content but
 * (unlike `TodoCard`) calls no dnd-kit hook, so nothing here needs the
 * context in the first place; keeping it outside just keeps the board's own
 * droppables from ever being re-measured on account of an overlay that has
 * nothing to do with dragging.
 */
export interface OverdriveOverlayProps {
  open: boolean;
  /**
   * The Overflow queue, unfiltered, in board order (decision #6). Read ONCE,
   * at mount — see `OverdriveOverlay`'s wrapper below for how "at mount"
   * lines up with "the moment `open` became true".
   */
  todos: Todo[];
  /** Live — read every render, so a card's current data (a concurrent edit,
   * a label added elsewhere) is always what's shown and what's undone from. */
  todosById: ReadonlyMap<string, Todo>;
  listsById: ReadonlyMap<string, List>;
  backlogListId: string;
  labels: LabelRecord[];
  /** Named reminder times (EI-106 P5) — see `TodoMetaBadges`. */
  reminderPresets?: ReminderPreset[];
  ctx: PlacementContext;
  onClose: () => void;
  /** `use-board-actions.ts`'s `handleOverdriveVerdict` — the one write path
   * every verdict shares. Returns the `pushUndo` entry id synchronously,
   * plus the human-readable label the toast shows verbatim. */
  onVerdict: (todo: Todo, verdict: Verdict) => { undoId: string; label: string };
}

/**
 * The mount/unmount gate. Conditionally rendering `OverdriveOverlayContent`
 * — rather than always rendering it and toggling a `hidden` class — is what
 * gives the session a fresh `useState` every time Overdrive opens: React
 * discards all component state on unmount, so there is no explicit "reset"
 * step to forget. Same trick `TodoSheet`'s `key={todo.id}` plays for the
 * same reason, just keyed on presence rather than identity.
 */
export function OverdriveOverlay({ open, ...rest }: OverdriveOverlayProps) {
  if (!open) return null;
  return <OverdriveOverlayContent {...rest} />;
}

function OverdriveOverlayContent({
  todos,
  todosById,
  listsById,
  backlogListId,
  labels,
  reminderPresets,
  ctx,
  onClose,
  onVerdict,
}: Omit<OverdriveOverlayProps, "open">) {
  // Lazy initializer runs exactly once, at mount — this IS the "frozen at
  // open" snapshot (decision #7). `todosById` below stays live so the CURRENT
  // todo's own fields (title edits, label changes) are always what renders.
  const [session, setSession] = useState<OverdriveSession>(() => createSession(todos));
  const [pickerOpen, setPickerOpen] = useState(false);

  // Swipe gestures (EI-104) — phone layout only. `layout`, not `coarse`: a
  // touchscreen laptop should still get the button-only desktop experience
  // (`docs/MOBILE.md` §2's own rule for the same axis), and the on-screen
  // buttons already cover every verdict regardless, so there's nothing lost
  // by gating on the narrower condition.
  const { layout } = useViewport();
  const swipeEnabled = layout === "phone";

  const currentId = currentTodoId(session);
  const currentTodo = currentId ? (todosById.get(currentId) ?? null) : null;
  const done = isComplete(session);

  /**
   * `onKeyDown` below lives on this element, so keyboard control of the
   * whole overlay depends on focus staying inside it. It doesn't, on its
   * own: whichever verdict button was just clicked HAS focus, and the
   * moment `transitioning` disables/hides it (browsers force-blur an
   * element that becomes non-focusable), focus falls back to
   * `document.body` — a sibling of this dialog in the DOM, not a
   * descendant, so no keypress dispatched there ever reaches `onKeyDown`
   * again. Found by a flaky-looking e2e test where the SECOND keyboard
   * verdict in a row silently did nothing; a real keyboard-only user would
   * hit the identical wall after their first click. The effect below pulls
   * focus back here every time `transitioning` changes — the same instant a
   * button would otherwise have taken focus with it into the void.
   */
  const popupRef = useRef<HTMLDivElement>(null);

  /**
   * The card mid-flick — a single slot, not a queue. While this is set, the
   * queue has NOT advanced yet (`session` still points at this same card):
   * the flick is a genuine, blocking transition, not a decorative overlay
   * on an already-interactive next card. `dispatch` (below) refuses every
   * action while this is non-null, and the next card isn't even mounted
   * until it clears — "once the animation is done the next card can be
   * interacted with," exactly as asked for, rather than the next card
   * being clickable underneath a still-animating previous one.
   *
   * Carries the WHOLE card — `todo`/`list`/`index`/`total` — so it renders
   * a full `OverdriveCard`, not just a title, for the ~340ms it's flicking
   * away.
   */
  const [transitioning, setTransitioning] = useState<{
    todo: Todo;
    list: List | null;
    index: number;
    total: number;
    direction: Direction;
    seq: number;
  } | null>(null);
  const transitionSeq = useRef(0);
  const transitionTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The deferred `setSession` for the in-flight flick, held until whichever
   * of `animationend` / the fallback timer gets here first. Null means no
   * flick is pending, which is also what makes `finishFlick` idempotent. */
  const pendingAdvance = useRef<(() => void) | null>(null);

  /**
   * Ends the in-flight flick: advances the queue and clears `transitioning`.
   *
   * Called from BOTH the card's own `animationend` (the normal path) and the
   * fallback timer, whichever arrives first — so it has to be safe to call
   * twice. `pendingAdvance` being null is that guard: the first caller takes
   * the callback and leaves nothing behind for the second.
   */
  const finishFlick = () => {
    if (transitionTimeout.current) {
      clearTimeout(transitionTimeout.current);
      transitionTimeout.current = null;
    }
    const advance = pendingAdvance.current;
    if (!advance) return;
    pendingAdvance.current = null;
    advance();
    setTransitioning(null);
  };

  /**
   * Under `prefers-reduced-motion`, `transitioning` is never set at all —
   * `advance()` runs immediately instead. The alternative (still holding
   * the gate open for the full duration, just without the visual) would
   * trade a moving card for a blank pause of the same length, which is
   * worse, not more accessible. It also means the `animationend` this
   * normally waits on can't be a liveness risk: when there's no animation,
   * there's no wait either.
   */
  const triggerFlick = (
    outgoingTodo: Todo,
    outgoingList: List | null,
    index: number,
    total: number,
    kind: Verdict["kind"],
    advance: () => void,
  ) => {
    if (transitionTimeout.current) clearTimeout(transitionTimeout.current);
    if (prefersReducedMotion()) {
      advance();
      return;
    }
    pendingAdvance.current = advance;
    transitionSeq.current += 1;
    setTransitioning({
      todo: outgoingTodo,
      list: outgoingList,
      index,
      total,
      direction: directionForVerdict(kind),
      seq: transitionSeq.current,
    });
    transitionTimeout.current = setTimeout(finishFlick, FLICK_FALLBACK_MS);
  };

  useEffect(() => {
    return () => {
      if (transitionTimeout.current) clearTimeout(transitionTimeout.current);
    };
  }, []);

  // Runs whenever a flick starts OR ends — both are moments a button under
  // focus may have just been forced to blur (disabled/hidden going in,
  // re-enabled coming out doesn't restore it on its own). `popupRef`'s
  // target is Base UI's own dialog popup, which carries `tabIndex={-1}` —
  // the same "focusable on request, never in Tab order" contract it already
  // uses to auto-focus the dialog on open.
  useEffect(() => {
    popupRef.current?.focus();
  }, [transitioning]);

  /**
   * A stable handle onto "whichever `dispatch` closes over the CURRENT
   * render's `session`" — reassigned every render, read only from the
   * toast's `onClick`.
   *
   * The toast action is a plain callback captured once, at `toast.success`
   * call time, and sonner never re-creates it on its own — closing over
   * `dispatch` directly there would freeze that click on the `session` as it
   * stood in the render that fired the toast. Every subsequent decision (or
   * a `⌫`/`⌘Z` in between) produces a NEW `dispatch` closing over the newer
   * `session`, and only reading through this ref at call time reaches it.
   */
  const dispatchRef = useRef<(action: KeyAction) => void>(() => {});

  /**
   * Keeps the one persistent toast in sync with whatever `session.decided`
   * currently ends with — called after every branch that changes it (a
   * fresh commit, or a step-back). Empty `decided` means nothing to show;
   * dismissing rather than leaving a stale "Won't do" toast up once its
   * decision has itself been undone.
   */
  const syncToast = (nextSession: OverdriveSession) => {
    const last = nextSession.decided.at(-1);
    if (!last) {
      toast.dismiss(OVERDRIVE_TOAST_ID);
      return;
    }
    toast.success(last.label, {
      id: OVERDRIVE_TOAST_ID,
      duration: Infinity,
      // Bottom-CENTER, not the app's default bottom-right (`<Toaster>` in
      // `app/layout.tsx` sets no `position`, so every other toast in the
      // app falls back to sonner's own default there) — this one lives
      // directly under Overdrive's own UI rather than in the ambient corner,
      // since it's replying to something the user is looking at dead
      // center. A per-toast override, sonner's own `ExternalToast.position`
      // — the global `<Toaster>` is untouched, and both positions render
      // from the same instance without conflict.
      position: "bottom-center",
      action: { label: "Undo", onClick: () => dispatchRef.current("stepBack") },
    });
  };

  // Whatever toast is up when the overlay closes — however it closes — goes
  // with it. Runs on unmount only ([] deps), which is exactly when this
  // content component goes away (see `OverdriveOverlay`'s gate above).
  useEffect(() => {
    return () => {
      toast.dismiss(OVERDRIVE_TOAST_ID);
    };
  }, []);

  const dispatch = (action: KeyAction) => {
    // Nothing is interactive while a card is mid-flick — see `transitioning`
    // above. Covers ⌫/⌘Z and Esc too, not just the four verdicts: a stray
    // keypress landing in the ~340ms window would otherwise act on
    // whichever card the queue lands on the instant it advances, not the
    // one the user was actually looking at when they pressed it.
    if (transitioning) return;

    // A card can vanish mid-session (deleted elsewhere, synced away). There
    // is nothing left to commit a verdict against, so skip it silently
    // rather than write to a row that no longer exists.
    if (currentId && !currentTodo) {
      setSession((s) => ({ ...s, index: s.index + 1, ramp: null, picked: null }));
      return;
    }

    const lists: ListContext = {
      currentListId: currentTodo?.listId ?? null,
      backlogListId,
    };
    const result = reduce(session, action, ctx, lists);

    if (result.stepBack) {
      void undoById(result.stepBack.undoId);
      setSession(result.session);
      syncToast(result.session);
      return;
    }
    if (result.exit) {
      onClose();
      return;
    }
    if (result.commit && currentTodo) {
      const { undoId, label } = onVerdict(currentTodo, result.commit);
      // Computed now (a pure value) but not yet applied via `setSession` —
      // the toast and the underlying write happen immediately (there's no
      // reason feedback or data integrity should wait on a flourish), but
      // the QUEUE only advances once the flick actually finishes, via
      // `triggerFlick`'s `advance` callback below.
      const nextSession = applyDecision(result.session, result.commit, undoId, label);
      syncToast(nextSession);
      // Inlined rather than reading the render-scoped `list` below — this
      // closure needs the OUTGOING todo's list, and `list` isn't declared
      // until after `dispatch` (it's derived from `currentTodo`, same as
      // this one-liner, just re-evaluated here for the card that's leaving).
      const outgoingList = currentTodo.listId ? (listsById.get(currentTodo.listId) ?? null) : null;
      triggerFlick(
        currentTodo,
        outgoingList,
        session.index,
        session.queue.length,
        result.commit.kind,
        () => setSession(nextSession),
      );
      return;
    }
    setSession(result.session);
  };

  // Ref mutations belong in an effect, not the render body — this runs
  // after every render (no deps array), which is exactly "always the latest
  // `dispatch`" and still always settles before the browser can deliver the
  // next real click (effects run before the next paint-and-interact cycle).
  useEffect(() => {
    dispatchRef.current = dispatch;
  });

  /**
   * Swipe drag state (EI-104), phone layout only. `pointerId` scopes every
   * handler to the finger that started the gesture — a second touch landing
   * mid-drag (a stray thumb resting on the glass) is ignored rather than
   * hijacking or resetting it. `direction` is `null` until the drag clears
   * `SWIPE_AXIS_LOCK_PX` (`lib/overdrive-swipe.ts`), then stays fixed for
   * the rest of the gesture. `active` is false only in the brief window
   * after release where a drag that didn't reach the commit threshold is
   * animating back to center — see the wrapper's className below for what
   * that drives.
   */
  const [drag, setDrag] = useState<{
    pointerId: number;
    startX: number;
    startY: number;
    dx: number;
    dy: number;
    direction: SwipeDirection | null;
    active: boolean;
  } | null>(null);

  const handleSwipeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    // Same "nothing is interactive mid-flick" rule `dispatch` itself
    // enforces, plus: no card to swipe on the finish screen, a drag
    // starting while the date picker is up would fight its own gestures,
    // and — `drag` already set — a second finger landing mid-gesture (a
    // stray thumb resting on the glass) must not hijack or reset the one
    // already in progress.
    if (!swipeEnabled || transitioning || pickerOpen || !currentTodo || drag) return;
    // `setPointerCapture` keeps every subsequent move/up event for this
    // finger targeted at this element even once it leaves the card's
    // bounds — without it, a fast drag would lose the gesture the moment
    // the finger crosses the card's edge. Guarded for test environments
    // (jsdom/happy-dom) that don't implement it; the gesture still works
    // there since Testing Library dispatches events directly at this node.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      dx: 0,
      dy: 0,
      direction: null,
      active: true,
    });
  };

  const handleSwipeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || !drag.active || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const direction = drag.direction ?? resolveSwipeDirection(dx, dy);
    setDrag({ ...drag, dx, dy, direction });
  };

  /** Shared by pointerup and pointercancel — the only difference is whether
   * a completed gesture is allowed to commit (never on cancel: the OS/
   * browser interrupting the touch is not the user releasing it on
   * purpose). */
  const endSwipe = (e: React.PointerEvent<HTMLDivElement>, allowCommit: boolean) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { direction, dx, dy } = drag;
    const committed = allowCommit && direction !== null && swipeProgress(dx, dy, direction) >= 1;
    // A commit hands off to the flick (`dispatch` → `triggerFlick`), which
    // owns the card's transform from here via `FLICK_CLASS` — clear `drag`
    // outright so nothing lingers to fight it. Otherwise, if a direction had
    // locked, ease back to center instead of unmounting: `active: false`
    // switches the wrapper to its `transition-transform` class (below) so
    // the snap-back is a genuine animation, not a jump cut. A release still
    // inside the deadzone (`direction` never locked) needed no visual in
    // the first place, so it just clears.
    setDrag(direction && !committed ? { ...drag, active: false, dx: 0, dy: 0 } : null);
    if (committed && direction) dispatch(SWIPE_ACTION[direction]);
  };

  const swipeHandlers = swipeEnabled
    ? {
        onPointerDown: handleSwipeStart,
        onPointerMove: handleSwipeMove,
        onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => endSwipe(e, true),
        onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => endSwipe(e, false),
      }
    : {};

  /** Translate (and, for the horizontal verdicts, a slight rotation echoing
   * `FLICK_CLASS`'s own spin) following the drag 1:1 along whichever axis
   * locked — `null` once the direction hasn't locked yet, so a drag still in
   * the deadzone shows no motion at all rather than a jittery sub-pixel
   * wobble. Never set while `transitioning`: that state already drives the
   * flick's OWN transform via `FLICK_CLASS`, and an inline `style.transform`
   * here would silently win the cascade over it. */
  const dragStyle =
    drag?.direction && !transitioning
      ? {
          transform:
            drag.direction === "left" || drag.direction === "right"
              ? `translateX(${drag.dx}px) rotate(${(drag.dx / SWIPE_ROTATE_DIVISOR).toFixed(2)}deg)`
              : `translateY(${drag.dy}px)`,
        }
      : undefined;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented || isTextEntry(e.target)) return;
    // One early return covers the whole handler while a card is mid-flick —
    // `dispatch` itself guards the same way, but `D` never reaches it (it
    // only raises the date picker, no session transition), so it needs the
    // check here too.
    if (transitioning) return;
    // The finish screen has no card and nothing staged, so `confirm` (Enter's
    // normal action) is always a no-op there — repurpose it to close instead,
    // matching the "Done" button, rather than leaving Enter dead on the one
    // screen where a keyboard user would otherwise have to reach for the
    // mouse. `⌫`/`⌘Z` are deliberately left alone here: `reduce`'s
    // `"stepBack"` already works from a finished session (it only looks at
    // `session.decided`, not `isComplete`), so stepping back into the last
    // card from the finish screen still needs to reach the table below.
    if (e.key === "Enter" && (done || !currentTodo)) {
      e.preventDefault();
      onClose();
      return;
    }
    // `⌘Z`/`Ctrl+Z` — local, not the global registry: the board's own ⌘Z is
    // correctly held off while this overlay owns the keyboard
    // (`overdriveOpen` in `computeModalOpen`, `use-board-ui-state.ts`), so
    // without this ⌘Z would do nothing at all in here. Exactly one of
    // Ctrl/Meta, never both — same rule `hasExactModifiers` (`lib/keyboard.ts`)
    // enforces for the registry, hand-checked here because that helper only
    // serves it.
    if (e.key.toLowerCase() === "z" && e.metaKey !== e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      dispatch("stepBack");
      return;
    }
    // `D` opens the date picker — checked ahead of the table since it isn't
    // a session transition on its own (it just raises UI, same as clicking
    // the button below), and matching `e.key` case-insensitively covers Caps
    // Lock without also matching modified combos.
    if (e.key.toLowerCase() === "d" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      setPickerOpen(true);
      return;
    }
    const action = ACTION_BY_KEY[e.key]?.(e.shiftKey);
    if (!action) return;
    e.preventDefault();
    dispatch(action);
  };

  const staged = !done ? stagedDate(session, ctx) : null;
  const list = currentTodo?.listId ? (listsById.get(currentTodo.listId) ?? null) : null;
  // The drag's visual feedback (below) — resolved once here rather than
  // inline in the JSX, same reason `staged`/`list`/`tally` are.
  const swipeIndicator =
    swipeEnabled && drag?.direction && !transitioning
      ? {
          Icon: SWIPE_ICON[drag.direction],
          label: swipeIndicatorLabel(drag.direction, list ? list.name : "Backlog"),
          progress: swipeProgress(drag.dx, drag.dy, drag.direction),
        }
      : null;
  const tally = summarize(session.decided);

  return (
    <Dialog
      open
      onOpenChange={(nextOpen, eventDetails) => {
        if (nextOpen) return;
        // Escape follows the same rule as every other key here — clear a
        // staged day first, only exit once nothing is left to cancel. Base
        // UI would otherwise close on the FIRST Escape regardless, so its
        // own dismissal is called off and `reduce` decides instead.
        if (eventDetails.reason === "escape-key") {
          eventDetails.cancel();
          dispatch("cancel");
          return;
        }
        onClose();
      }}
    >
      {/*
        A centred DIALOG, not the full-screen sheet this used to be (round
        5). The board behind it is driven by `useLiveQuery`, and Overdrive
        writes through the same repository functions every other surface
        does — so with the board actually visible, the Overflow column
        drains and scheduled cards land on their day columns in real time as
        you triage, for free. That feedback IS the burn-down the feature is
        named for; a full-screen sheet was hiding the only view that shows
        it working.

        The trade is deliberate: a little less "focus mode" isolation for a
        lot more context. The dialog stays modal (Base UI focus trap, and
        `overdriveOpen` still feeds `computeModalOpen`, §9), so nothing
        behind it is interactive — it's visible, not usable.

        `overlayClassName` drops the backdrop's `backdrop-blur-xs`, which
        would otherwise smear the very thing this change exists to show, and
        lightens the scrim to match. `overflow-hidden` clips the flick at
        the dialog's edge (see `FLICK_CLASS` for why the travel unit had to
        change with it); the date picker is unaffected because
        `PopoverContent` portals out (`ui/popover.tsx`).

        `showCloseButton={false}` — Esc and the finish screen's Done button
        are the ways out, and a stray ✕ in the corner of a keyboard-driven
        surface invites a click that `reduce` never sees.

        **Only where there's vertical room for it** (`tall:`, ≥40rem high —
        see the variant's own note in `globals.css`). Below that the old
        full-bleed presentation is kept verbatim: a landscape phone is 343px
        tall, so a centred dialog there has no room for itself AND the
        decision toast beneath it, and the toast lands on top of the button
        row instead — the exact collision §8b describes, reintroduced by
        shrinking the surface. There's also nothing to gain: the phone board
        is a one-column pager, so there's no "watch it drain" payoff behind
        the dialog to trade for.
      */}
      <DialogContent
        ref={popupRef}
        showCloseButton={false}
        overlayClassName="bg-black/10 dark:bg-black/40 supports-backdrop-filter:backdrop-blur-none"
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0",
          // Short viewports: full-bleed, exactly as before round 5. The
          // `sm:max-w-none` is not redundant — `DialogContent`'s own base
          // class list ends in `sm:max-w-sm`, and a bare `max-w-none` here
          // loses to it on any viewport past 640px wide, which is most
          // landscape phones (734px). It has to be neutralised AT the same
          // variant to be neutralised at all.
          "inset-0 h-dvh w-full max-w-none translate-x-0 translate-y-0 rounded-none sm:max-w-none",
          // Tall enough for a dialog: centred, with the board around it.
          "tall:inset-auto tall:top-1/2 tall:left-1/2 tall:h-auto tall:max-h-[85dvh]",
          "tall:w-[calc(100%-2rem)] tall:max-w-2xl tall:sm:max-w-2xl",
          "tall:-translate-x-1/2 tall:-translate-y-1/2 tall:rounded-xl",
        )}
        onKeyDown={handleKeyDown}
      >
        <DialogTitle className="sr-only">Overdrive</DialogTitle>
        <DialogDescription className="sr-only">
          Triage the Overflow column one to-do at a time.
        </DialogDescription>

        {/*
          `min-h-0` + `overflow-y-auto`: without `min-h-0`, a flex item's
          default `min-height: auto` overrides `flex-1` the moment its own
          content (card + gap-8 + staged box + button row) is taller than
          the popup's `max-h-[85dvh]` box — the classic flex overflow trap.
          Found live on a short landscape phone: this box was silently
          rendering 100+px taller than the dialog itself, with its TOP
          pinned in place rather than "centered" — `justify-center` cannot
          distribute leftover space in a box that has none. `min-h-0` makes
          this div actually respect the height it's supposed to fill;
          `overflow-y-auto` means content that still doesn't fit scrolls
          internally instead of rendering off-canvas.

          The bottom padding is the §8b toast fix, and it applies only to
          the full-bleed branch — there the surface reaches the screen's
          bottom edge, so room has to be reserved inside it for the toast
          that sits there. In `tall:` mode the dialog stops well short of
          that edge and the toast has its own space below, so the same
          padding would just be dead height.
        */}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 overflow-y-auto px-6 pt-(--safe-top) pb-[calc(var(--safe-bottom)+6rem)] tall:py-8">
          {done || !currentTodo ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="font-heading text-2xl font-bold">
                {session.decided.length > 0
                  ? `Cleared ${session.decided.length}`
                  : "Nothing to triage"}
              </p>
              {/* Reaching the end isn't the only way here — Esc mid-way lands
                  in this same branch via `!currentTodo`/`done`, so the tally
                  always reflects what was actually decided, not the whole
                  queue. */}
              {session.decided.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {[
                    tally.dropped > 0 && `${tally.dropped} won’t do`,
                    tally.done > 0 && `${tally.done} done`,
                    tally.scheduled > 0 && `${tally.scheduled} scheduled`,
                    tally.listed > 0 && `${tally.listed} back to lists`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              <Button onClick={onClose} className="mt-2">
                Done
              </Button>
            </div>
          ) : (
            <>
              {/*
                One card, in normal flow — never two at once. While
                `transitioning`, this IS the outgoing card, flicking away in
                the verdict's direction; `session` hasn't advanced yet (see
                `dispatch`), so there is nothing else to show underneath it.
                Once this card's own `animationend` fires, `transitioning`
                clears and `session` has already advanced, so this branch
                swaps straight to the new current card — no overlay, no dual
                mount, no absolute positioning to get wrong.

                `onAnimationEnd` is the thing that keeps the flick
                CONSISTENT: the card leaves when its animation is actually
                over, not when a timer that started at a different moment
                says it should be (see `FLICK_FALLBACK_MS`). `e.target ===
                e.currentTarget` so a future animation on anything INSIDE
                the card can't end the flick early by bubbling up here.

                `fill-mode-forwards` holds the card at its final off-screen
                position between `animationend` firing and React actually
                unmounting it. Without it the default `fill-mode: none`
                snaps the card back to dead center, at full opacity, for
                however many frames that gap lasts — a flash of the
                just-decided card reappearing before it vanishes.

                **Swipe (EI-104), phone layout only.** `swipeHandlers` is `{}`
                on tablet/desktop, so this carries no pointer listeners there
                at all — the button row is the whole story off-phone, same as
                before this ticket. `touch-none` only while a gesture could
                actually start (`swipeEnabled && !transitioning`): it
                pre-empts the ancestor's native touch-scroll on this element
                specifically, the same `touch-action: none` trade
                `rail-handle.tsx`/`split-handle.tsx` already make for their
                own genuine drag surfaces (`docs/GESTURES.md`) — without it,
                the browser can commit the touch to scrolling before this
                component's own `pointermove` handler gets a say. The
                `transition-transform` class (vs. `transition-none` while
                actively dragging) is what turns a released, uncommitted drag
                into a genuine ease-back-to-center rather than a jump cut;
                `dragStyle`'s own comment covers why it can never fight the
                flick's `FLICK_CLASS` transform.
              */}
              <div
                key={transitioning ? `flick-${transitioning.seq}` : currentId}
                onAnimationEnd={(e) => {
                  if (e.target === e.currentTarget) finishFlick();
                }}
                className={cn(
                  "relative",
                  swipeEnabled && !transitioning && "touch-none select-none",
                  transitioning
                    ? cn(
                        "animate-out fade-out duration-320 ease-in fill-mode-forwards",
                        FLICK_CLASS[transitioning.direction],
                      )
                    : cn(
                        "animate-in fade-in duration-220 ease-out motion-reduce:animate-none",
                        drag?.active ? "transition-none" : "transition-transform duration-150 ease-out",
                      ),
                )}
                style={dragStyle}
                {...swipeHandlers}
              >
                <OverdriveCard
                  todo={transitioning ? transitioning.todo : currentTodo}
                  list={transitioning ? transitioning.list : list}
                  labels={labels}
                  reminderPresets={reminderPresets}
                  ctx={ctx}
                  index={transitioning ? transitioning.index : session.index}
                  total={transitioning ? transitioning.total : session.queue.length}
                />

                {/*
                  The drag's visual feedback (EI-104) — a badge fading and
                  scaling in as `swipeProgress` climbs toward 1, so the
                  gesture reads as "here's what letting go does" rather than
                  a mystery input. Same icon/label the matching verdict
                  button already shows, so a user who has tried the buttons
                  first recognizes this instantly. `pointer-events-none` +
                  `aria-hidden`: purely decorative, and must never steal the
                  pointer capture the card wrapper itself is holding.
                */}
                {swipeIndicator && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
                  >
                    <span
                      className="flex items-center gap-2 rounded-full border-2 border-primary bg-background px-4 py-2 text-base font-semibold text-primary shadow-md"
                      style={{
                        opacity: swipeIndicator.progress,
                        transform: `scale(${0.85 + swipeIndicator.progress * 0.15})`,
                      }}
                    >
                      <swipeIndicator.Icon aria-hidden className="size-5" />
                      {swipeIndicator.label}
                    </span>
                  </div>
                )}
              </div>

              {staged && !transitioning && (
                <div className="flex flex-wrap items-center justify-center gap-3 rounded-md border-2 border-primary bg-primary/5 px-4 py-3 shadow-sm">
                  <span className="text-base">
                    Schedule for <strong>{rampLabel(staged, ctx.today)}</strong>
                  </span>
                  <Button onClick={() => dispatch("confirm")} className="pointer-coarse:min-h-11">
                    <Check aria-hidden /> Confirm
                  </Button>
                  {/* A keyboard hint has nothing to say on a device with no
                      keyboard — the Confirm button is the whole affordance there. */}
                  <span className="text-xs text-muted-foreground touch:hidden">
                    Enter to confirm
                  </span>
                </div>
              )}

              {/*
                Centred, wrapping row on a mouse; a two-column grid on touch
                (`touch:`, `@media (hover: none)`, globals.css) — a wide row
                of four+ targets is not reachable one-handed, and a grid
                anchored near the thumb is. `pointer-coarse:min-h-11` on each
                button is the same 44px WCAG/HIG floor `ui/button.tsx`'s own
                small sizes already apply to themselves (`docs/MOBILE.md`).

                `invisible`, not unmounted, while `transitioning` — the row
                stays in the layout (so nothing above it jumps to re-center)
                but is neither visible nor reachable; each button is also
                `disabled` so a held-down key or a queued click can't land on
                it via focus/Enter instead of a pointer.
              */}
              <div
                className={cn(
                  "flex flex-wrap items-center justify-center gap-2 touch:grid touch:w-full touch:max-w-md touch:grid-cols-2",
                  transitioning && "invisible",
                )}
              >
                <Button
                  variant="outline"
                  disabled={!!transitioning}
                  className={cn("pointer-coarse:min-h-11", staged && "opacity-60")}
                  onClick={() => dispatch("wontDo")}
                >
                  <ArrowLeft aria-hidden /> Won’t do
                </Button>
                <Button
                  variant="outline"
                  disabled={!!transitioning}
                  className={cn("pointer-coarse:min-h-11", staged && "opacity-60")}
                  onClick={() => dispatch("toList")}
                >
                  <ArrowDown aria-hidden /> Back to {list ? list.name : "Backlog"}
                </Button>
                <Button
                  variant="outline"
                  disabled={!!transitioning}
                  className={cn("pointer-coarse:min-h-11", staged && "opacity-60")}
                  onClick={() => dispatch("done")}
                >
                  <ArrowUp aria-hidden /> Done
                </Button>
                <Button
                  variant={staged ? "ghost" : "outline"}
                  disabled={!!transitioning}
                  className="pointer-coarse:min-h-11"
                  onClick={() => dispatch("ramp")}
                >
                  <ArrowRight aria-hidden /> Schedule
                </Button>
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger
                    aria-label="Pick a date"
                    disabled={!!transitioning}
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="pointer-coarse:min-h-11 pointer-coarse:min-w-11 touch:col-span-2 touch:w-full"
                      />
                    }
                  >
                    <CalendarDays aria-hidden />
                  </PopoverTrigger>
                  <PopoverContent align="center" className="w-auto p-0">
                    {/* Deliberately does NOT snap to an eligible day even
                        with workdaysOnly on — an explicitly chosen Saturday
                        stays on Saturday (docs/FAITE-LOOP.md §2). */}
                    <Calendar
                      mode="single"
                      defaultMonth={civilDateToLocalDate(ctx.today)}
                      disabled={{ before: civilDateToLocalDate(ctx.today) }}
                      onSelect={(date) => {
                        if (!date) return;
                        setSession((s) =>
                          stageDate(
                            s,
                            toCivilDate(date.getFullYear(), date.getMonth() + 1, date.getDate()),
                          ),
                        );
                        setPickerOpen(false);
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Maps a raw `KeyboardEvent.key` (plus Shift) to an `overdrive.ts` action.
 * A lookup table rather than a chain of `if`s, matching `lib/keyboard.ts`'s
 * own preference for data over branching. */
const ACTION_BY_KEY: Record<string, (shift: boolean) => KeyAction> = {
  ArrowLeft: () => "wontDo",
  ArrowUp: () => "done",
  ArrowDown: (shift) => (shift ? "toBacklog" : "toList"),
  ArrowRight: (shift) => (shift ? "rampWeek" : "ramp"),
  Enter: () => "confirm",
  Backspace: () => "stepBack",
};
