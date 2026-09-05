"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { detectPlatform, formatCombo, type Hotkey, type Platform } from "@/lib/keyboard";
import { shortcutCatalog, type ShortcutEntry } from "@/lib/shortcuts";

/** Never changes within a page's life — same rationale as `usePlatform` in todo-sheet.tsx. */
const subscribeToNothing = () => () => {};

/** Display-only platform sniff, client-safe. See todo-sheet.tsx's `usePlatform` for why
 * this needs `useSyncExternalStore` rather than reading `navigator` directly. */
function usePlatform(): Platform {
  return useSyncExternalStore(subscribeToNothing, detectPlatform, () => "other");
}

/** Display order — most-used surfaces first, library-owned last (there are none here;
 * this sheet only lists shortcuts this app owns, per EI-84/§1's "do not re-bind" list). */
const SCOPE_ORDER: ShortcutEntry["scope"][] = [
  "Global",
  "Board navigation",
  "To-do card",
  "To-do sheet",
  "Command palette",
  "Overdrive",
  "Quick add & mentions",
  "Rails & split",
  "Editor",
];

interface HelpSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hotkeys: Hotkey[];
}

/**
 * The keyboard shortcut reference (EI-75), opened with `?`.
 *
 * Global entries are derived from the `Hotkey[]` registry and cannot drift
 * from what is actually bound; everything else is hand-authored in
 * `src/lib/shortcuts.ts` — see that module's doc comment for why the split
 * exists rather than pretending the whole list is generated. `docs/KEYBOARD.md`
 * §5 has the recipe for keeping a new shortcut reflected here.
 */
export function HelpSheet({ open, onOpenChange, hotkeys }: HelpSheetProps) {
  const platform = usePlatform();
  const catalog = useMemo(() => shortcutCatalog(hotkeys), [hotkeys]);

  const byScope = useMemo(() => {
    const groups = new Map<ShortcutEntry["scope"], ShortcutEntry[]>();
    for (const entry of catalog) {
      const list = groups.get(entry.scope) ?? [];
      list.push(entry);
      groups.set(entry.scope, list);
    }
    return groups;
  }, [catalog]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-sm">
        <SheetHeader className="pr-10">
          <SheetTitle>Keyboard shortcuts</SheetTitle>
          <SheetDescription className="text-xs">
            Global shortcuts work anywhere. Everything else applies only where
            it&apos;s listed — most of the board is a click-or-Tab surface
            first, with a shortcut as the accelerator.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {SCOPE_ORDER.map((scope) => {
            const entries = byScope.get(scope);
            if (!entries || entries.length === 0) return null;
            return (
              <section key={scope} className="pb-4">
                <h3 className="type-eyebrow py-2">
                  {scope}
                </h3>
                <ul className="divide-y">
                  {entries.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-center justify-between gap-4 py-2 text-sm"
                    >
                      <span className="min-w-0">{entry.label}</span>
                      <kbd
                        data-slot="kbd"
                        className="shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-2xs text-muted-foreground"
                      >
                        {formatCombo(entry.combo, platform)}
                      </kbd>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
