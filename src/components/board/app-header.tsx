"use client";

import Link from "next/link";
import { useState } from "react";
import { CircleHelp, LogIn, LogOut, Search, Settings } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { clearStoredAuthToken, isDesktopShell, startDesktopLogin } from "@/lib/desktop/bridge";
import { flushOutbox } from "@/components/sync/sync-provider";
import { clearDeviceData } from "@/lib/store/clear-device";
import { getBoundOwnerId } from "@/lib/store/owner";
import type { Settings as SettingsRow } from "@/lib/schema";

interface AppHeaderProps {
  /** Opens the command palette. Owned by Board, which also owns ⌘K. */
  onOpenPalette: () => void;
  /** Opens the settings sheet. */
  onOpenSettings: () => void;
  /** Opens the keyboard shortcut help sheet (EI-75) — same target as `?` and
   * the palette's "Keyboard shortcuts" item, just a mouse-discoverable one. */
  onOpenHelp: () => void;
  /** Raw Dexie row; undefined until the store has read it. */
  settings: SettingsRow | undefined;
  /**
   * The phone shell (`phone-board.tsx`, mobile plan M3). Swaps the search
   * FIELD (text label + ⌘K kbd hint, sized for a pointer that can read "Search
   * or run a command…" in passing) for a search ICON — there's no room for
   * the field at phone width, and ⌘K itself is a desktop-keyboard shortcut
   * with nothing to hint at on a device with no keyboard attached.
   */
  compact?: boolean;
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
export function AppHeader({
  onOpenPalette,
  onOpenSettings,
  onOpenHelp,
  settings,
  compact,
}: AppHeaderProps) {
  const { data: session } = useSession();
  const identity = useIdentity();
  const avatar = resolveAvatar(settings, identity);
  const shouldShowAuthNudges = useShouldShowAuthNudges();
  /** Non-null while the "you have unsynced changes" confirmation is open. */
  const [unsyncedCount, setUnsyncedCount] = useState<number | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  /**
   * Leave the board, hard.
   *
   * Not `router.push`: that keeps the SPA alive, so `useLiveQuery` caches, the
   * undo stack, board UI state and the engine's timers would all survive the
   * wipe still holding the previous user's values. A document navigation
   * throws all of it away at once.
   *
   * `replace`, not `assign`, so `/board` leaves the history stack and Back
   * cannot restore it from bfcache.
   *
   * App-shell builds reload instead. `NEXT_PUBLIC_APP_SHELL=1` is set by
   * `build:static` and used by BOTH Capacitor and Tauri, where `/` is only a
   * redirect stub and the windows open on `board.html` directly — a reload
   * gives the same clean-document guarantee and cannot 404. `app/page.tsx`
   * already keys off the same flag.
   */
  const leaveBoard = () => {
    if (process.env.NEXT_PUBLIC_APP_SHELL === "1") window.location.reload();
    else window.location.replace("/");
  };

  /**
   * Sign out, then erase this device.
   *
   * The order is not cosmetic. `signOut()` runs BEFORE `clearDeviceData()`:
   * wiping first would leave a live session against a cursor of 0, and the
   * still-mounted sync engine's next tick would pull the whole board straight
   * back down. Once signed out every request 401s into `SyncAuthError` and
   * the engine writes nothing.
   */
  const finishSignOut = async () => {
    // The desktop shell's bearer token lives in the OS keychain, entirely
    // outside Better Auth's cookie-based session `signOut()` clears (D2a —
    // see docs/DESKTOP.md §9). Without this, "Log out" would clear the
    // cookie-shaped session state everywhere else but leave the stored
    // token still authenticating every subsequent request.
    if (isDesktopShell()) await clearStoredAuthToken();
    await signOut();
    await clearDeviceData();
    leaveBoard();
  };

  const handleSignOut = async () => {
    const userId = session?.user?.id;
    // The same predicate as `SyncProvider`'s `isActive()`, and load-bearing
    // for the same reason. A device bound to user A with user B momentarily
    // signed in — the state `session-provider.tsx`'s "switch accounts?"
    // dialog puts us in, before anyone answers it — must sign out and touch
    // nothing else. Flushing would push A's board into B's Durable Object;
    // wiping would destroy A's board to fix B's mistake.
    if (!userId || getBoundOwnerId() !== userId) {
      if (isDesktopShell()) await clearStoredAuthToken();
      await signOut();
      toast.success("Signed out");
      return;
    }

    // While the cookie is still valid. Anything that fails to land here is
    // work the wipe below would destroy with no way back.
    const pending = await flushOutbox();
    if (pending > 0) {
      setUnsyncedCount(pending);
      return;
    }

    await finishSignOut();
  };

  const handleConfirmDiscard = async () => {
    setSigningOut(true);
    try {
      await finishSignOut();
    } finally {
      // `finishSignOut` ends in a document navigation, so this normally never
      // runs. It matters when the navigation is stubbed (tests) or blocked.
      setSigningOut(false);
      setUnsyncedCount(null);
    }
  };

  const handleDesktopSignIn = async (page: "login" | "signup" = "login") => {
    try {
      await startDesktopLogin(page);
    } catch (error) {
      console.error("[faite] couldn't open the system browser for sign-in", error);
      toast.error("Couldn't open your browser to sign in.");
    }
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
      <Link
        href="/board"
        className="font-heading text-sm font-semibold tracking-tight"
      >
        Faite
      </Link>

      {compact ? (
        <button
          type="button"
          onClick={onOpenPalette}
          aria-label="Search or run a command"
          className="ml-auto flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Search className="size-4" aria-hidden />
        </button>
      ) : (
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
      )}

      {shouldShowAuthNudges ? (
        isDesktopShell() ? (
          // Same reason as the account menu's Sign in below: the embedded
          // webview cannot complete a sign-up itself (D0 §3.7), so this
          // opens the system browser rather than navigating to a form that
          // can never succeed. See docs/DESKTOP.md §9.
          <Button size="sm" onClick={() => void handleDesktopSignIn("signup")}>
            Sign up
          </Button>
        ) : (
          <Button size="sm" nativeButton={false} render={<Link href="/signup" />}>
            Sign up
          </Button>
        )
      ) : null}

      {/* Mouse-discoverable route to the same sheet `?` opens (EI-75) — a
          keyboard shortcut that's only reachable by keyboard shortcut is a
          discoverability dead end for anyone who hasn't found it yet. */}
      <button
        type="button"
        onClick={onOpenHelp}
        aria-label="Keyboard shortcuts"
        className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <CircleHelp className="size-4" aria-hidden />
      </button>

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
            ) : isDesktopShell() ? (
              // The embedded webview cannot complete a sign-in itself (D0
              // §3.7: `tauri://localhost` cannot hold a session cookie) — a
              // click opens the system browser instead of navigating here.
              // See docs/DESKTOP.md §9.
              <DropdownMenuItem onClick={() => void handleDesktopSignIn()}>
                <LogIn aria-hidden />
                Sign in
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

      {/*
        Only ever seen when `flushOutbox()` could not get everything to the
        server — offline, or a server that is failing. A fully-synced sign-out
        is silent. Erasing silently here would be unrecoverable, and worse
        than the leak this whole change exists to close.

        Cancel does nothing at all on purpose: staying signed in is the only
        state from which those changes can still be saved.
      */}
      <AlertDialog
        open={unsyncedCount !== null}
        onOpenChange={(open) => {
          if (!open && !signingOut) setUnsyncedCount(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out with unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {unsyncedCount === 1
                ? "1 change hasn't"
                : `${unsyncedCount ?? 0} changes haven't`}{" "}
              reached the server yet — you may be offline. Signing out erases
              this device&apos;s board, including those changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={signingOut}>
              Stay signed in
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={signingOut}
              onClick={() => void handleConfirmDiscard()}
            >
              {signingOut ? "Signing out…" : "Sign out and erase"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}
