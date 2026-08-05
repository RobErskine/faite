"use client";

import { DEFAULT_FONT_PAIRING } from "@/lib/fonts";
import { LOCAL_OWNER_ID } from "@/lib/store/repositories";
import { mutateSettings } from "@/lib/store/mutate";
import { normalizeTheme } from "@/lib/theme";
import type { SettingsSectionProps } from "./types";
import { FontPairingField } from "./font-pairing-field";
import { ThemeField } from "./theme-field";

/**
 * Typography and appearance. No toasts on either field: the effect is visible
 * instantly and in place, so a toast would be noise — the palette's font
 * items don't toast for the same reason.
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
    </div>
  );
}
