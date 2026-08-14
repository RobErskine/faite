"use client";

import { useState, useSyncExternalStore } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  notificationPermissionState,
  requestNotificationPermission,
  type NotificationSupportState,
} from "@/components/board/use-reminders";
import { useReminderPresets } from "@/lib/store/hooks";
import {
  createReminderPreset,
  deleteReminderPreset,
  updateReminderPreset,
} from "@/lib/store/repositories";
import { positionBetween } from "@/lib/ordering";
import type { ReminderPreset } from "@/lib/schema";

const STATE_COPY: Record<NotificationSupportState, string> = {
  unsupported: "Not available in this browser — reminders will still show as in-app toasts.",
  granted: "Enabled — reminders will show as system notifications.",
  denied: "Blocked. Enable notifications for this site in your browser settings to turn this back on.",
  default: "Not yet enabled — reminders show as in-app toasts until you turn this on.",
};

/** Never changes within a page's life — same rationale as `useIsLocalDev` in settings-sheet.tsx. */
const subscribeToNothing = () => () => {};

/** Move a preset one slot toward the start or end of `ordered` — writes a
 * single new `position` between its new neighbours, per lib/ordering.ts. */
function moveRow(ordered: ReminderPreset[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= ordered.length) return null;
  // Position the moved row on the far side of its new neighbour, using the
  // neighbour just past THAT one as the other bound.
  const beforeIndex = direction === -1 ? target - 1 : target;
  const afterIndex = direction === -1 ? target : target + 1;
  const before = ordered[beforeIndex]?.position ?? null;
  const after = ordered[afterIndex]?.position ?? null;
  return positionBetween(before, after);
}

/**
 * One preset's editable row. Owns a local draft of `name` only, committed
 * on blur — `reminderPresetSchema` requires a non-empty name, and a
 * write-on-every-keystroke field bound straight to the store would either
 * write an intermediate empty string (violating the schema, only caught
 * later when a remote pull re-validates it) or, if that write is silently
 * skipped, snap the controlled input's value back to the old name on the
 * very next render — the user couldn't clear the field to retype it at
 * all. `emoji` and `time` stay write-on-change: `emoji` has no such
 * constraint, and `time`'s native browser input already only ever emits a
 * complete valid value or an empty one, guarded below.
 */
function PresetRow({
  preset,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
}: {
  preset: ReminderPreset;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [nameDraft, setNameDraft] = useState(preset.name);
  // The store's name changed out from under this draft (another device,
  // undo) — resync rather than let the field silently disagree with it.
  // React's documented render-time pattern for "adjust state when a prop
  // changes" (react.dev), not an effect: setState during render, gated on
  // an actual change, bails out before the browser ever paints the stale
  // value — an effect would paint the old draft for one frame first.
  const [lastSeenName, setLastSeenName] = useState(preset.name);
  if (preset.name !== lastSeenName) {
    setLastSeenName(preset.name);
    setNameDraft(preset.name);
  }

  const commitName = () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameDraft(preset.name); // Reject an empty name — revert the draft.
      return;
    }
    if (trimmed !== preset.name) void updateReminderPreset(preset.id, { name: trimmed });
  };

  return (
    <li className="flex items-center gap-2 rounded-md border px-3 py-2">
      <div className="flex flex-col">
        <button
          type="button"
          aria-label={`Move ${preset.name} up`}
          disabled={isFirst}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
          onClick={onMoveUp}
        >
          ▲
        </button>
        <button
          type="button"
          aria-label={`Move ${preset.name} down`}
          disabled={isLast}
          className="text-muted-foreground hover:text-foreground disabled:opacity-30"
          onClick={onMoveDown}
        >
          ▼
        </button>
      </div>
      <Input
        aria-label={`${preset.name} emoji`}
        value={preset.emoji ?? ""}
        onChange={(e) => void updateReminderPreset(preset.id, { emoji: e.target.value || null })}
        className="w-12 text-center"
      />
      <Input
        aria-label={`${preset.name} name`}
        value={nameDraft}
        onChange={(e) => setNameDraft(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitName();
        }}
        className="min-w-0 flex-1"
      />
      <Input
        aria-label={`${preset.name} time`}
        type="time"
        value={preset.time}
        onChange={(e) => {
          if (!e.target.value) return;
          void updateReminderPreset(preset.id, { time: e.target.value });
        }}
        className="w-32"
      />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete ${preset.name}`}
        onClick={() => void deleteReminderPreset(preset.id)}
      >
        <Trash2 className="size-4" aria-hidden />
      </Button>
    </li>
  );
}

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
 *
 * The permission prompt (formerly the whole of `NotificationsSection`) stays
 * on top; the reminder preset manager (EI-106 P3) goes beneath it — one
 * section for delivery AND the named times themselves, rather than two
 * settings entries about the same feature.
 */
export function RemindersSection() {
  const state = useSyncExternalStore(
    subscribeToNothing,
    notificationPermissionState,
    () => "default" as const,
  );
  const [pending, setPending] = useState<NotificationSupportState | null>(null);
  const shown = pending ?? state;

  const presets = useReminderPresets();
  const [name, setName] = useState("");
  const [time, setTime] = useState("");
  const [emoji, setEmoji] = useState("");

  const handleAdd = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || !time) return;
    await createReminderPreset(trimmedName, time, { emoji: emoji.trim() || null });
    setName("");
    setTime("");
    setEmoji("");
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Label>Reminder notifications</Label>
        <p className="text-sm text-muted-foreground">{STATE_COPY[shown]}</p>
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

      <div className="space-y-3">
        <Label>Reminder presets</Label>
        <p className="text-sm text-muted-foreground">
          Named times you can pick instead of typing — &quot;In the morning&quot;
          instead of 8:00. Editing a preset&apos;s time relabels reminders
          already sitting on the old time; it doesn&apos;t move them.
        </p>
        {presets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reminder presets yet.</p>
        ) : (
          <ul className="space-y-2">
            {presets.map((preset, i) => (
              <PresetRow
                key={preset.id}
                preset={preset}
                isFirst={i === 0}
                isLast={i === presets.length - 1}
                onMoveUp={() => {
                  const position = moveRow(presets, i, -1);
                  if (position) void updateReminderPreset(preset.id, { position });
                }}
                onMoveDown={() => {
                  const position = moveRow(presets, i, 1);
                  if (position) void updateReminderPreset(preset.id, { position });
                }}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="reminder-preset-name">Add a preset</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="reminder-preset-emoji"
            placeholder="🌅"
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            className="sm:w-14"
          />
          <Input
            id="reminder-preset-name"
            placeholder="Name — Morning, Gym…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            aria-label="Preset time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="sm:w-32"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleAdd()}
            disabled={!name.trim() || !time}
          >
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
