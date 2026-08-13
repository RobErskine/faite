"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { describeLoop } from "@/lib/rollover-events";
import { todayIn } from "@/lib/scheduling";
import { LOCAL_OWNER_ID } from "@/lib/store/repositories";
import { mutateSettings } from "@/lib/store/mutate";
import type { SettingsSectionProps } from "./types";
import { LoopExampleCards } from "./loop-example";
import { LoopRollsField } from "./loop-rolls-field";

/**
 * The Faite Loop: how long a missed todo rolls forward onto today before it
 * falls into Overflow. `overflowAfterDays`/`workdaysOnly` were already synced
 * settings before this section existed (`overflowAfterDays` only reachable
 * via its DB default of 3) — see docs/FAITE-LOOP.md.
 */
export function LoopSection({ settings }: SettingsSectionProps) {
  const timezone = settings?.timezone ?? "UTC";
  const overflowAfterDays = settings?.overflowAfterDays ?? 3;
  const workdaysOnly = settings?.workdaysOnly ?? false;
  const workdays = settings?.workdays ?? [1, 2, 3, 4, 5];

  const loopCtx = {
    today: todayIn(timezone),
    overflowAfterDays,
    workdaysOnly,
    workdays,
  };
  /** Kept for screen readers — the three boxes below are its visual
   * replacement, but a sighted-only redesign would leave AT users with
   * nothing. See feedback item #5. */
  const example = describeLoop(loopCtx);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        A todo missed on its scheduled day rolls forward onto today instead of
        sitting on a date that&apos;s already passed. After it&apos;s rolled
        this many times, it falls into{" "}
        <span className="font-medium text-foreground">Overflow</span> — put
        off that long, it probably wasn&apos;t important. From there you can
        send it back to the backlog, another list, or a new day.
      </p>

      <LoopRollsField
        value={overflowAfterDays}
        onChange={(rolls) =>
          void mutateSettings(LOCAL_OWNER_ID, { overflowAfterDays: rolls })
        }
      />

      <div>
        <p className="sr-only">{example}</p>
        <LoopExampleCards ctx={loopCtx} />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="loop-workdays-only">Roll over on workdays only</Label>
          <p className="text-sm text-muted-foreground">
            A Friday miss lands on Monday instead of Saturday. Todos you
            explicitly scheduled on a weekend still show up then.
          </p>
        </div>
        <Switch
          id="loop-workdays-only"
          checked={workdaysOnly}
          onCheckedChange={(checked) =>
            void mutateSettings(LOCAL_OWNER_ID, { workdaysOnly: checked })
          }
        />
      </div>
    </div>
  );
}
