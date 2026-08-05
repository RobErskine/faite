import { Palette, User } from "lucide-react";
import type { SettingsSection } from "./types";
import { ProfileSection } from "./profile-section";
import { DesignSection } from "./design-section";

/**
 * The settings surface's left nav, as data. Adding a section is one new file
 * plus one entry here — nothing else has to change.
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: "profile",
    label: "Profile",
    description: "Your name and how your avatar appears.",
    icon: User,
    Component: ProfileSection,
  },
  {
    id: "design",
    label: "Design",
    description: "How the board looks: typeface and appearance.",
    icon: Palette,
    Component: DesignSection,
  },
];
