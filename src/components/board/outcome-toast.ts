import { toast, type ExternalToast } from "sonner";
import type { TodoStatus } from "@/lib/schema";

/**
 * Whether a toast reports an accomplishment or a plain outcome (EI-387).
 *
 * `"success"` wears sonner's check (`CircleCheckIcon`, `ui/sonner.tsx`).
 * `"neutral"` wears no icon. Won't do is a decision, not an accomplishment: a
 * green-tick "Won't do “Call dentist”" congratulated the user for letting
 * something go, which is not what PRODUCT.md's No-Shame Rule asks for either.
 * It is not a failure, so it doesn't get a warning icon. It gets no icon.
 */
export type ToastTone = "success" | "neutral";

/** Done earns the check; Won't do (and anything else) is neutral. */
export function toneForStatus(status: TodoStatus): ToastTone {
  return status === "done" ? "success" : "neutral";
}

/**
 * `toast.success` or a plain `toast`, by tone.
 *
 * `icon` is set either way, on purpose, for toasts that reuse one sonner id
 * (Overdrive's persistent toast): sonner MERGES an update into the existing
 * toast, so a neutral update over a success toast would keep its `type` and
 * its check. `icon: null` hides the icon whatever the type; `icon: undefined`
 * clears that again, so a later success shows its check.
 */
export function outcomeToast(tone: ToastTone, message: string, data?: ExternalToast) {
  return tone === "success"
    ? toast.success(message, { ...data, icon: undefined })
    : toast(message, { ...data, icon: null });
}
