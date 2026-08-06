"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { resetAccountData } from "@/lib/store/reset";

/**
 * Local-development-only tools. Rendered solely when `isLocalDev()` (see
 * `sections.tsx`'s `devOnly` flag), so this never reaches a real user.
 *
 * Exists because resetting an account by hand is a three-part ritual that is
 * easy to get half-right: wipe the Durable Object, clear IndexedDB, and clear
 * the `faite:sync-cursor:*` / `faite:last-hlc` / `faite:bound-owner-id`
 * localStorage keys. `resetAccountData()` does all three in the one order
 * that survives a crash at any point — see `src/lib/store/reset.ts` and
 * `docs/SCHEMA-OPS.md`.
 */
export function DeveloperSection() {
  const { data: session } = useSession();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleReset = async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    try {
      await resetAccountData(session?.user.id ?? null);
      toast.success("Board reset", {
        description: "Fresh Backlog and default tab, as on a first sign-in.",
      });
      setArmed(false);
    } catch (error) {
      // Deliberately NOT a partial-success message. A failed server wipe
      // leaves the account holding the old data, and saying "reset" would
      // send someone off to debug a schema change against a board that was
      // never actually cleared.
      toast.error("Reset failed — the board was not cleared", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="font-medium">Reset this account</h3>
        <p className="text-muted-foreground mt-1 text-sm">
          Deletes every to-do, list, and tab — on this device and on the
          server — then reseeds an empty board with Backlog and the default
          tab, exactly as a first sign-in would. Your account and session are
          untouched, so you stay signed in.
        </p>
        <p className="text-muted-foreground mt-2 text-sm">
          Local development only. Other devices signed into this account will
          notice on their next sync and re-read from scratch.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant={armed ? "destructive" : "outline"}
          onClick={handleReset}
          disabled={busy}
          className="w-fit"
        >
          {busy ? "Resetting…" : armed ? "Really reset — this cannot be undone" : "Reset board"}
        </Button>
        {armed && !busy && (
          <Button variant="ghost" onClick={() => setArmed(false)}>
            Cancel
          </Button>
        )}
      </div>

      {!session && (
        <p className="text-muted-foreground text-sm">
          Signed out — this will clear local data only, since there is no
          server-side board to wipe.
        </p>
      )}
    </div>
  );
}
