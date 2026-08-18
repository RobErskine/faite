import { Bell, CornerDownRight, Mail, MapPin, Palette, User, Wrench } from "lucide-react";
import type { SettingsSection } from "./types";
import { ProfileSection } from "./profile-section";
import { DesignSection } from "./design-section";
import { LoopSection } from "./loop-section";
import { RemindersSection } from "./reminders-section";
import { PlacesSection } from "./places-section";
import { EmailSection } from "./email-section";
import { DeveloperSection } from "./developer-section";

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
    id: "loop",
    label: "Faite Loop",
    description:
      "How long a missed to-do rolls before it falls into Overflow, when the Overdrive button appears, and whether a staged day auto-confirms.",
    icon: CornerDownRight,
    Component: LoopSection,
  },
  {
    id: "design",
    label: "Design",
    description: "How the board looks: typeface and appearance.",
    icon: Palette,
    Component: DesignSection,
  },
  {
    id: "reminders",
    label: "Reminders",
    description: "Delivery, and named times you can pick instead of typing.",
    icon: Bell,
    Component: RemindersSection,
  },
  {
    id: "places",
    label: "Places",
    description: "Saved locations you can attach to a to-do.",
    icon: MapPin,
    Component: PlacesSection,
  },
  {
    id: "email",
    label: "Email capture",
    description: "A private address that turns forwarded email into to-dos.",
    icon: Mail,
    Component: EmailSection,
  },
  {
    id: "developer",
    label: "Developer",
    description: "Local-only tools for working on the app itself.",
    icon: Wrench,
    Component: DeveloperSection,
    devOnly: true,
  },
];
