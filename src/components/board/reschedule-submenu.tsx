"use client";

import { CalendarClock } from "lucide-react";
import {
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { quickRescheduleOptions } from "@/lib/quick-reschedule";
import { formatDay, formatShortDate } from "@/lib/scheduling";
import type { CivilDate } from "@/lib/schema";

/** "Sat, Aug 15" — the resolved date beside a reschedule row. */
function resolvedLabel(date: CivilDate): string {
  return `${formatDay(date).weekday.slice(0, 3)}, ${formatShortDate(date)}`;
}

interface RescheduleSubmenuProps {
  today: CivilDate;
  /** "Reschedule", "Reschedule 3" — the caller knows what it is counting. */
  label: string;
  onPick: (date: CivilDate) => void;
  disabled?: boolean;
}

/**
 * The Reschedule ▸ submenu, shared by the card menu (EI-285) and the list
 * group header menu (EI-337) — two call sites, the same bar `color-submenu.tsx`
 * cleared.
 *
 * Anchored on TODAY, never a card's own `scheduledDate` — a list-column card
 * has none, and a missed one still carries a date in the past, so measuring
 * from it would schedule into the past and roll straight back.
 * `quick-reschedule.ts` carries the full argument. Each row shows where it
 * lands, which is what keeps "In 2 days" from meaning something invisible.
 */
export function RescheduleSubmenu({ today, label, onPick, disabled }: RescheduleSubmenuProps) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger disabled={disabled}>
        <CalendarClock />
        {label}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {quickRescheduleOptions(today).map((option) => (
          <ContextMenuItem key={option.kind} onClick={() => onPick(option.date)}>
            {option.label}
            <ContextMenuShortcut>{resolvedLabel(option.date)}</ContextMenuShortcut>
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
