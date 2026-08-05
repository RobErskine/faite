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
}
