import type { DropAnimationFunctionArguments } from "@dnd-kit/core";
import { prefersReducedMotion } from "@/lib/reduced-motion";

/**
 * The released item flies from where it was dropped to where it will land.
 *
 * dnd-kit's default drop animation is hardcoded to fly the overlay back to the
 * *source* draggable's rect. That is wrong for a board: the item is not going
 * back where it came from, it is going somewhere else. The overlay returned
 * home while the write landed the card in its new column a beat later, so a
 * successful drop read as a failed one that got corrected.
 *
 * The target we animate to is the drop indicator — the insertion line drawn
 * above the hovered card, or the end-of-column line. Those already sit at the
 * exact pixel the item will occupy; that is their entire job. Animating to them
 * makes the motion honest by construction, collapses the "over a card" and
 * "over a column" cases into one path, and needs no prediction of what the
 * layout will look like after the write.
 */

/** Marks the elements whose position the ghost should fly to. */
export const DROP_INDICATOR_ATTR = "data-drop-indicator";

/** Flight duration. The overlay's opacity fades out over the final CROSSFADE_MS. */
export const FLIGHT_MS = 200;

/**
 * The real row is revealed CROSSFADE_MS before the ghost finishes, so the two
 * overlap instead of leaving a frame where neither is visible.
 */
export const CROSSFADE_MS = 90;

const EASING = "cubic-bezier(.2,.8,.3,1)";

/**
 * The overlay's resting tilt, applied as inline style on the overlay's card so
 * the drop animation unwinds exactly the properties that were set. Kept here
 * next to the keyframes that undo it.
 */
export const LIFTED = { rotate: "2deg", scale: "1.02" } as const;

const SETTLED = { rotate: "0deg", scale: "1" } as const;

interface Rect {
  left: number;
  top: number;
  width: number;
}

interface Translate {
  x: number;
  y: number;
}

/**
 * Where the overlay's transform must end up for its top-left corner to sit on
 * the landing rect's top-left corner.
 *
 * The overlay is `position: fixed` at the *source* card's rect and moved by a
 * translate, so the final translate is the current one minus the gap between
 * where the overlay is now and where it should end. This is dnd-kit's own
 * derivation with the landing rect substituted for the source rect.
 */
export function landingTransform({
  overlayRect,
  landingRect,
  transform,
}: {
  overlayRect: Rect;
  landingRect: Rect;
  transform: Translate;
}): Translate {
  return {
    x: transform.x - (overlayRect.left - landingRect.left),
    y: transform.y - (overlayRect.top - landingRect.top),
  };
}

/**
 * Measure the visible drop indicator.
 *
 * At most one exists: there is a single `over` at a time, and both indicators
 * are gated on `!rejectsDrop`. Returns null when there is nothing to fly to —
 * Overflow (which refuses drops), a drop onto the dragged card itself, or a
 * release outside any column. Callers fall back to dnd-kit's return-to-source
 * animation, which is the correct read for a refusal.
 *
 * Must be called before the drag-end render commits. dnd-kit invokes onDragEnd
 * inside `unstable_batchedUpdates` after its own dispatch, so the indicator is
 * still in the DOM there — but not after the first `await`.
 */
export function readLandingRect(): DOMRect | null {
  if (typeof document === "undefined") return null;
  const indicator = document.querySelector(`[${DROP_INDICATOR_ATTR}]`);
  return indicator ? indicator.getBoundingClientRect() : null;
}

interface LandingDropAnimationOptions {
  /** The rect captured at drag end, or null to fall back to flying home. */
  landingRect: DOMRect | null;
  /**
   * Reveal the real row. Fired mid-flight so the swap is a crossfade.
   *
   * Receives the id this flight is carrying: if the user has already started
   * and dropped another item, a late timer from this flight must not reveal
   * the newer one while it is still in the air.
   */
  onLand: (activeId: string) => void;
}

/**
 * Body of the `DropAnimationFunction` handed to `DragOverlay`.
 *
 * Takes the landing rect as a plain argument rather than closing over a getter
 * so the caller can read its ref at call time. A factory invoked during render
 * would be handed a closure over that ref, which the React Compiler rightly
 * rejects.
 */
export function runLandingDropAnimation(
  { active, dragOverlay, transform }: DropAnimationFunctionArguments,
  { landingRect, onLand }: LandingDropAnimationOptions,
): Promise<void> | void {
  const activeId = String(active.id);

  // No landing target, or the user does not want motion: hand the row over
  // immediately. Returning without animating unmounts the ghost at once.
  if (!landingRect || prefersReducedMotion()) {
    onLand(activeId);
    return;
  }

  const node = dragOverlay.node;

  // Measure the wrapper we are about to animate rather than trusting
  // `dragOverlay.rect`: dnd-kit measures whichever node it considers
  // "measurable", which for a single-child overlay is the child — and this
  // overlay's child is tilted, scaled and width-capped, so its box is not the
  // wrapper's. getBoundingClientRect reflects the element's own transform and
  // ignores child overflow, which is exactly the box being moved.
  const overlayRect = node.getBoundingClientRect();

  const final = landingTransform({ overlayRect, landingRect, transform });

  const flight = node.animate(
    [
      {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        width: `${overlayRect.width}px`,
      },
      {
        transform: `translate3d(${final.x}px, ${final.y}px, 0)`,
        width: `${landingRect.width}px`,
      },
    ],
    { duration: FLIGHT_MS, easing: EASING, fill: "forwards" },
  );

  // A separate animation because it targets a different property — the two
  // composite rather than one overwriting the other.
  node.animate([{ opacity: 1 }, { opacity: 0 }], {
    delay: FLIGHT_MS - CROSSFADE_MS,
    duration: CROSSFADE_MS,
    easing: "linear",
    fill: "forwards",
  });

  // The ghost is tilted while in flight; it settles flat as it lands. These
  // are the same individual properties `LIFTED` sets inline, so the animation
  // overrides them cleanly instead of stacking on top of a `transform`.
  const card = node.firstElementChild;
  if (card) {
    card.animate([{ ...LIFTED }, { ...SETTLED }], {
      duration: FLIGHT_MS,
      easing: EASING,
      fill: "forwards",
    });
  }

  const reveal = window.setTimeout(() => onLand(activeId), FLIGHT_MS - CROSSFADE_MS);

  return flight.finished
    .catch(() => {
      // The overlay can be torn down mid-flight; that is not an error.
    })
    .then(() => {
      window.clearTimeout(reveal);
      onLand(activeId);
    });
}
