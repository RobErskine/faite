"use client";

import { useEffect, useRef, useState } from "react";
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
import { signOut, useSession } from "@/lib/auth-client";
import { adoptLocalData, resetLocalDataForNewOwner } from "@/lib/store/adopt-owner";
import { ensureDefaultTab, seedIfEmpty } from "@/lib/store/repositories";

/**
 * Bridges the Better Auth session to the local store. Mounted once from
 * `Board`, not `layout.tsx` — auth must never become a render dependency (see
 * ARCHITECTURE §2.4/§2.12), and this component renders nothing for the common
 * cases (signed out, already adopted). The only visible UI is the rare
 * "this device belongs to someone else" confirmation.
 */
export function SessionProvider() {
  const { data: session } = useSession();
  const processedUserId = useRef<string | null>(null);
  const [conflictUserId, setConflictUserId] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || processedUserId.current === userId) return;
    processedUserId.current = userId;

    void adoptLocalData(userId).then((result) => {
      if (result === "adopted") {
        toast.success("This device's board is now linked to your account.");
      } else if (result === "different-user") {
        setConflictUserId(userId);
      }
    });
  }, [session?.user?.id]);

  const handleConfirmSwitch = async () => {
    if (!conflictUserId) return;
    setResetting(true);
    try {
      await resetLocalDataForNewOwner();
      await seedIfEmpty();
      await ensureDefaultTab();
      await adoptLocalData(conflictUserId);
      toast.success("Switched accounts. This device's board has been reset.");
    } finally {
      setResetting(false);
      setConflictUserId(null);
    }
  };

  // Fires on every dismissal path (Cancel button, Escape, overlay click) —
  // deliberately NOT wired to the Action button too, which closes the dialog
  // itself by clearing conflictUserId once the switch succeeds.
  const handleCancelSwitch = async () => {
    setConflictUserId(null);
    processedUserId.current = null;
    await signOut();
    toast.info("Signed out to keep this device's existing board intact.");
  };

  return (
    <AlertDialog
      open={conflictUserId !== null}
      onOpenChange={(open) => {
        if (!open) void handleCancelSwitch();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Switch accounts on this device?</AlertDialogTitle>
          <AlertDialogDescription>
            This device already has a board linked to a different account.
            Continuing will erase the current local board and start fresh —
            it will not touch that account&apos;s data anywhere else.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={resetting}>
            Cancel and sign out
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={resetting}
            onClick={() => void handleConfirmSwitch()}
          >
            {resetting ? "Switching…" : "Erase and switch"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
