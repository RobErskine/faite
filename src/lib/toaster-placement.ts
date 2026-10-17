import type { ToasterProps } from "sonner";

/** Width from which the board still shows beside an open drawer. */
export const TOASTER_WIDE_MIN_PX = 1100;

/**
 * Where toasts go while a details drawer is open (EI-396). Sonner's default,
 * bottom-right, is where the drawer's footer (Save, Delete) sits, so a toast
 * would cover the control that caused it. With room beside the drawer the
 * toast goes bottom-left; otherwise top-center. No drawer: `undefined`, which
 * leaves sonner's own default.
 */
export function toasterPosition(
  sheetOpen: boolean,
  viewportWidth: number,
): ToasterProps["position"] | undefined {
  if (!sheetOpen) return undefined;
  return viewportWidth >= TOASTER_WIDE_MIN_PX ? "bottom-left" : "top-center";
}
