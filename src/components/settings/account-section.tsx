"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient, useSession } from "@/lib/auth-client";
import { resetLocalDataForNewOwner } from "@/lib/store/adopt-owner";

/**
 * Settings → Account. The self-serve counterpart to Settings → Developer →
 * Reset (`developer-section.tsx`): that clears this account's DATA and keeps
 * you signed in; this deletes the ACCOUNT itself and everything with it.
 *
 * Wired to Better Auth's `deleteUser` (`src/server/auth.ts`), whose
 * `afterDelete` hook wipes this account's Durable Object
 * (`UserDurableObject.wipe()` → `storage.deleteAll()`) — the round trip
 * EI-80 flagged as implemented but never verified end-to-end, because a CSRF
 * Origin check blocked exercising it against a nonstandard local port. This
 * component, run against a trusted origin (production or the Worker preview
 * on :8787 — both in `TRUSTED_ORIGINS`), is that verification.
 */
export function AccountSection() {
  const router = useRouter();
  const { data: session } = useSession();
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [open, setOpen] = useState(false);

  const email = session?.user.email ?? "";
  const confirmed = confirmText.trim().toLowerCase() === email.toLowerCase();

  const handleDelete = async () => {
    setDeleting(true);
    // No `password` sent: Better Auth falls back to a session-freshness
    // check (default 24h), which covers OAuth-only accounts that have no
    // password to provide at all. A session older than that gets a clear
    // "sign in again" error rather than a confusing silent failure.
    const { error } = await authClient.deleteUser({});

    if (error) {
      setDeleting(false);
      toast.error("Couldn't delete your account", {
        description:
          error.status === 400
            ? "Your session has been active a while — sign out and back in, then try again."
            : (error.message ?? "Something went wrong. Please try again."),
      });
      return;
    }

    // Same teardown `resetAccountData()` uses for the local half of a board
    // reset (`src/lib/store/reset.ts`) — clears every Dexie table, the bound
    // owner id, and the sync cursors. Reused rather than reimplemented so
    // this can't drift out of sync with the one place that already gets the
    // crash-safe ordering right.
    await resetLocalDataForNewOwner();

    toast.success("Account deleted");
    router.push("/");
  };

  if (!session) {
    return (
      <p className="text-sm text-muted-foreground">
        Sign in to manage or delete your account.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="font-medium">Signed in as</h3>
        <p className="mt-1 text-sm text-muted-foreground">{email}</p>
      </div>

      <div>
        <h3 className="font-medium text-destructive">Delete account</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Permanently deletes your account and every to-do, list, tab, and note in
          it — on this device and on the server. This cannot be undone.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          This is different from Settings → Developer → Reset, which clears your
          data but keeps your account and keeps you signed in.
        </p>
      </div>

      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setConfirmText("");
        }}
      >
        <AlertDialogTrigger render={<Button variant="destructive" className="w-fit" />}>
          Delete account
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              Everything you&apos;ve made in Faite goes with it, permanently. Type
              your email address to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="grid gap-1.5">
            <Label htmlFor="delete-confirm-email">Email</Label>
            <Input
              id="delete-confirm-email"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={email}
              autoComplete="off"
              autoFocus
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!confirmed || deleting}
              onClick={() => void handleDelete()}
            >
              {deleting ? "Deleting…" : "Delete my account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
