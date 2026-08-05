"use client";

import Link from "next/link";
import { LogIn, LogOut, Search, Settings } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { resolveAvatar } from "@/lib/profile";
import { useIdentity } from "@/lib/use-identity";
import { signOut, useSession } from "@/lib/auth-client";
import { useShouldShowAuthNudges } from "@/lib/auth-nudge";
import type { Settings as SettingsRow } from "@/lib/schema";

interface AppHeaderProps {
  /** Opens the command palette. Owned by Board, which also owns ⌘K. */
  onOpenPalette: () => void;
  /** Opens the settings sheet. */
  onOpenSettings: () => void;
  /** Raw Dexie row; undefined until the store has read it. */
  settings: SettingsRow | undefined;
}

/**
 * The app's only global chrome: wordmark, palette trigger, account menu.
 *
 * The palette trigger is styled as a search field because search and commands
 * are the same surface — one place to find anything and do anything. It is a
 * button rather than an <input> on purpose: the palette's own CommandInput is
 * the real field, and a second live input would duplicate value state and
 * fight it for focus.
 */
export function AppHeader({ onOpenPalette, onOpenSettings, settings }: AppHeaderProps) {
  const { data: session } = useSession();
  const identity = useIdentity();
  const avatar = resolveAvatar(settings, identity);
  const shouldShowAuthNudges = useShouldShowAuthNudges();

  const handleSignOut = async () => {
    await signOut();
    toast.success("Signed out");
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
      <Link
        href="/board"
        className="font-heading text-sm font-semibold tracking-tight"
      >
        Faite
      </Link>

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

      {shouldShowAuthNudges ? (
        <Button size="sm" nativeButton={false} render={<Link href="/signup" />}>
          Sign up
        </Button>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Account"
          className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <UserAvatar settings={settings} />
        </DropdownMenuTrigger>
        {/*
          The shared content sets `w-(--anchor-width)`, which would size the menu
          to the 28px trigger. Width has to be reclaimed here.
        */}
        <DropdownMenuContent align="end" className="w-48">
          {/*
            The group is load-bearing, not decoration: DropdownMenuLabel is
            Base UI's Menu.GroupLabel, which throws outright when it cannot
            find a Menu.Group to name. It also gives the account actions the
            accessible name the label carries.
          */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              {avatar.name}
              {/*
                `avatar.name` above already prefers a local display name, then
                the account's name, then its email (resolveAvatar). Showing the
                email again underneath is only additive when it is not already
                the line above it.
              */}
              {session && avatar.name !== session.user.email ? (
                <span className="mt-0.5 block truncate text-xs font-normal text-muted-foreground">
                  {session.user.email}
                </span>
              ) : null}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onOpenSettings}>
              <Settings aria-hidden />
              Settings
            </DropdownMenuItem>
            {session ? (
              <DropdownMenuItem
                variant="destructive"
                onClick={() => void handleSignOut()}
              >
                <LogOut aria-hidden />
                Log out
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem render={<Link href="/login" />}>
                <LogIn aria-hidden />
                Sign in
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
