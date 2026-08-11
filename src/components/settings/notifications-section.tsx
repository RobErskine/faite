"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  notificationPermissionState,
  requestNotificationPermission,
  type NotificationSupportState,
} from "@/components/board/use-reminders";

const STATE_COPY: Record<NotificationSupportState, string> = {
  unsupported: "Not available in this browser — reminders will still show as in-app toasts.",
  granted: "Enabled — reminders will show as system notifications.",
  denied: "Blocked. Enable notifications for this site in your browser settings to turn this back on.",
  default: "Not yet enabled — reminders show as in-app toasts until you turn this on.",
};

/** Never changes within a page's life — same rationale as `useIsLocalDev` in settings-sheet.tsx. */
const subscribeToNothing = () => () => {};

/**
 * Foreground reminders (`todoSchema.reminderTime`) only fire while a tab is
 * open, via `use-reminders.ts`'s poll. This is the one door into
 * `Notification.requestPermission()` — Safari silently ignores that call
 * unless it happens inside a real click handler, so it can never be
 * requested on mount.
 *
 * `Notification` doesn't exist during the static export's prerender, so
 * reading it directly would render one string server-side and swap in a
 * different one on hydration. `useSyncExternalStore` with an explicit server
 * snapshot is the sanctioned way to say "client-only" here — see
 * `useIsLocalDev` in settings-sheet.tsx for the same pattern.
 */
export function NotificationsSection() {
  const state = useSyncExternalStore(
    subscribeToNothing,
    notificationPermissionState,
    () => "default" as const,
  );
  const [pending, setPending] = useState<NotificationSupportState | null>(null);
  const shown = pending ?? state;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Reminder notifications</Label>
        <p className="text-sm text-muted-foreground">{STATE_COPY[shown]}</p>
      </div>
      {shown === "default" && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void requestNotificationPermission().then(setPending)}
        >
          Enable notifications
        </Button>
      )}
    </div>
  );
}
