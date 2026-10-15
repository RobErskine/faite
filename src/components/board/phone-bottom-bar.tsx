"use client";

import { cn } from "@/lib/utils";

interface PhoneBottomBarProps {
  view: "days" | "lists";
  onSelectView: (view: "days" | "lists") => void;
  /**
   * DOM `id`s for the tabs (EI-386). While a skip link's column is on the
   * other page, its `href` names the tab that shows that page instead.
   */
  tabIds?: { days?: string; lists?: string };
}

/**
 * The phone shell's mode switch (mobile plan M3) — declined the literal
 * "swipe up/down between lists/day views" request in favor of this: any
 * vertical PAGING gesture either steals the primary reading scroll axis
 * (unusable while a column has any cards in it) or only fires at a scroll
 * boundary (misfires constantly, unreachable on a column shorter than the
 * viewport). See docs/GESTURES.md.
 *
 * `env(safe-area-inset-bottom)` via `--safe-bottom` (globals.css) — this is
 * the last thing before the home-indicator gesture strip on an iPhone.
 */
export function PhoneBottomBar({ view, onSelectView, tabIds }: PhoneBottomBarProps) {
  return (
    <nav
      aria-label="Board view"
      className="flex shrink-0 border-t bg-background pb-(--safe-bottom)"
    >
      <TabButton
        id={tabIds?.days}
        label="Days"
        active={view === "days"}
        onClick={() => onSelectView("days")}
      />
      <TabButton
        id={tabIds?.lists}
        label="Lists"
        active={view === "lists"}
        onClick={() => onSelectView("lists")}
      />
    </nav>
  );
}

function TabButton({
  id,
  label,
  active,
  onClick,
}: {
  id?: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      id={id}
      type="button"
      aria-current={active ? "true" : undefined}
      onClick={onClick}
      className={cn(
        "flex h-14 flex-1 items-center justify-center text-sm font-medium transition-colors",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {label}
    </button>
  );
}
