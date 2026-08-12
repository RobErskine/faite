"use client";

import { cn } from "@/lib/utils";

interface PhoneBottomBarProps {
  view: "days" | "lists";
  onSelectView: (view: "days" | "lists") => void;
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
export function PhoneBottomBar({ view, onSelectView }: PhoneBottomBarProps) {
  return (
    <nav
      aria-label="Board view"
      className="flex shrink-0 border-t bg-background pb-(--safe-bottom)"
    >
      <TabButton label="Days" active={view === "days"} onClick={() => onSelectView("days")} />
      <TabButton label="Lists" active={view === "lists"} onClick={() => onSelectView("lists")} />
    </nav>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
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
