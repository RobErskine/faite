"use client";

import { LogOut, Search, Settings } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface AppHeaderProps {
  /** Opens the command palette. Owned by Board, which also owns ⌘K. */
  onOpenPalette: () => void;
}

/**
 * Placeholder identity until P2 auth lands.
 *
 * Every record is written under `LOCAL_OWNER_ID` (src/lib/store/repositories.ts)
 * and the schema carries no name, email, or image, so there is nothing real to
 * bind to yet. Swapping this for the authenticated user is a one-line change.
 */
const PLACEHOLDER_NAME = "Local User";
const PLACEHOLDER_INITIALS = PLACEHOLDER_NAME.split(" ")
  .map((word) => word[0])
  .join("")
  .slice(0, 2)
  .toUpperCase();

/**
 * The app's only global chrome: wordmark, palette trigger, account menu.
 *
 * The palette trigger is styled as a search field because search and commands
 * are the same surface — one place to find anything and do anything. It is a
 * button rather than an <input> on purpose: the palette's own CommandInput is
 * the real field, and a second live input would duplicate value state and
 * fight it for focus.
 */
export function AppHeader({ onOpenPalette }: AppHeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
      <span className="font-heading text-sm font-semibold tracking-tight">
        Faite
      </span>

      <div className="flex flex-1 justify-center">
        <button
          type="button"
          onClick={onOpenPalette}
          aria-keyshortcuts="Meta+K Control+K"
          className="flex h-8 w-full max-w-md items-center gap-2 rounded-lg border bg-muted/40 px-2.5 text-left transition-colors outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Search className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="text-xs text-muted-foreground">
            Search or run a command…
          </span>
          <kbd className="ml-auto rounded border bg-background px-1 font-mono text-2xs text-muted-foreground">
            ⌘K
          </kbd>
        </button>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Account"
          className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Avatar>
            <AvatarFallback>{PLACEHOLDER_INITIALS}</AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        {/*
          The shared content sets `w-(--anchor-width)`, which would size the menu
          to the 28px trigger. Width has to be reclaimed here.
        */}
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>{PLACEHOLDER_NAME}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {/* Both land in P2: settings will host typography, and sign-out
              needs an actual session to end. */}
          <DropdownMenuItem disabled>
            <Settings aria-hidden />
            Settings
          </DropdownMenuItem>
          <DropdownMenuItem disabled variant="destructive">
            <LogOut aria-hidden />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
