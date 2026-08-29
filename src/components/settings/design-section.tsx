"use client";

import { DEFAULT_FONT_PAIRING } from "@/lib/fonts";
import { LOCAL_OWNER_ID } from "@/lib/store/repositories";
import { mutateSettings } from "@/lib/store/mutate";
import { normalizeTheme } from "@/lib/theme";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { SettingsSectionProps } from "./types";
import { FontPairingField } from "./font-pairing-field";
import { ThemeField } from "./theme-field";

/**
 * Typography, appearance, and celebrations. No toasts on any field: the effect
 * is visible instantly and in place, so a toast would be noise — the palette's
 * font items don't toast for the same reason, and GOOD JOB mode announces
 * itself the next time you finish something.
 */
export function DesignSection({ settings }: SettingsSectionProps) {
  return (
    <div className="space-y-6">
      <FontPairingField
        value={settings?.fontPairing ?? DEFAULT_FONT_PAIRING}
        onChange={(id) => void mutateSettings(LOCAL_OWNER_ID, { fontPairing: id })}
      />
      <ThemeField
        value={normalizeTheme(settings?.theme)}
        onChange={(mode) => void mutateSettings(LOCAL_OWNER_ID, { theme: mode })}
      />
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="design-good-job-mode">GOOD JOB mode</Label>
          <p className="text-sm text-muted-foreground">
            Throw a spark of confetti when you complete a to-do, in that to-do&apos;s
            own colour. Won&apos;t-do items get nothing. Off if your system asks for
            reduced motion.
          </p>
        </div>
        <Switch
          id="design-good-job-mode"
          checked={settings?.goodJobMode ?? false}
          onCheckedChange={(checked) =>
            void mutateSettings(LOCAL_OWNER_ID, { goodJobMode: checked })
          }
        />
      </div>
    </div>
  );
}
