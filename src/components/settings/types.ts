import type { LucideIcon } from "lucide-react";
import type { Settings } from "@/lib/schema";

export interface SettingsSectionProps {
  /** Raw Dexie row — may predate any given field. Normalize before reading. */
  settings: Settings | undefined;
}

export interface SettingsSection {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  Component: React.ComponentType<SettingsSectionProps>;
  /**
   * Render only when `isLocalDev()` (`src/lib/dev.ts`). Filtered in
   * `SettingsSheet`, not inside the section itself, so a dev-only section is
   * never mounted — and so the left nav can't show a tab whose panel is
   * empty.
   *
   * Note this hides the affordance, not the capability: everything a dev
   * section can do is reachable from a console or a script regardless. Do not
   * use it as a security boundary (§2.13).
   */
  devOnly?: boolean;
}
