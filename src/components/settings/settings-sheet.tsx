"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Settings } from "@/lib/schema";
import { SETTINGS_SECTIONS } from "./sections";

interface SettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings | undefined;
}

/**
 * The app's catch-all settings surface: a wide sheet with a vertical left nav
 * so it reads like a page without the cost of one. See SettingsSection in
 * ./types for how to add a section.
 */
export function SettingsSheet({ open, onOpenChange, settings }: SettingsSheetProps) {
  const [sectionId, setSectionId] = useState(SETTINGS_SECTIONS[0].id);

  /**
   * Reset to the first section on dismissal, in the change handler rather
   * than an effect on `open` — syncing state to a prop in an effect causes a
   * cascading render, which React 19 lints against. Same pattern as the
   * command palette's handleOpenChange.
   */
  const handleOpenChange = (next: boolean) => {
    if (!next) setSectionId(SETTINGS_SECTIONS[0].id);
    onOpenChange(next);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      {/*
        The shared content hardcodes `data-[side=right]:sm:max-w-sm`, a
        variant-prefixed utility tailwind-merge won't dedupe against a plain
        `sm:max-w-*` — the full variant stack has to be matched to replace it.
        `gap-4` and `w-3/4` are likewise overridden for a two-pane layout.

        The overlay drops its blur (not its dim) so the Design panel doubles
        as a live preview: a font or theme change is visible on the actual
        board behind the sheet, not just in the cards inside it.
      */}
      <SheetContent
        className="flex w-full flex-col gap-0 data-[side=right]:sm:max-w-3xl"
        overlayClassName="supports-backdrop-filter:backdrop-blur-none"
      >
        {/* Leaves room for the close button pinned at the top right. */}
        <SheetHeader className="border-b pr-12">
          <SheetTitle>Settings</SheetTitle>
        </SheetHeader>

        <Tabs
          orientation="vertical"
          value={sectionId}
          onValueChange={(value) => setSectionId(value as string)}
          className="min-h-0 flex-1 gap-0"
        >
          <TabsList variant="line" className="w-44 shrink-0 border-r p-2">
            {SETTINGS_SECTIONS.map((section) => (
              <TabsTrigger key={section.id} value={section.id} className="w-full">
                <section.icon aria-hidden />
                {section.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {SETTINGS_SECTIONS.map((section) => (
            <TabsContent
              key={section.id}
              value={section.id}
              className="min-h-0 overflow-y-auto p-4"
            >
              <section.Component settings={settings} />
            </TabsContent>
          ))}
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
