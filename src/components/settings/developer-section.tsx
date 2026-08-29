"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession } from "@/lib/auth-client";
import { seedOverflow } from "@/lib/dev-seed";
import { resetAccountData } from "@/lib/store/reset";
import { useSettings } from "@/lib/store/hooks";

/**
 * Local-development-only tools. Rendered solely when `isLocalDev()` (see
 * `sections.tsx`'s `devOnly` flag), so this never reaches a real user.
 *
 * Exists because resetting an account by hand is a three-part ritual that is
 * easy to get half-right: wipe the Durable Object, clear IndexedDB, and clear
 * the `faite:sync-cursor:*` / `faite:bound-owner-id` localStorage keys.
 * `resetAccountData()` does all three in the one order that survives a crash
 * at any point — see `src/lib/store/reset.ts` and `docs/SCHEMA-OPS.md`.
 *
 * `faite:last-hlc` is deliberately not in that list and never was: this
 * device's clock must stay monotone across a reset, or a later write could
 * lose an LWW comparison to a row this device itself pushed earlier.
 */
export function DeveloperSection() {
  const { data: session } = useSession();
  const settings = useSettings();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seedCount, setSeedCount] = useState(10);
  const [seeding, setSeeding] = useState(false);

  const handleSeedOverflow = async () => {
    if (!settings) return;
    setSeeding(true);
    try {
      const count = await seedOverflow(seedCount, {
        overflowAfterDays: settings.overflowAfterDays,
        timezone: settings.timezone,
      });
      toast.success(`Seeded ${count} to-dos into Overflow`, {
        description: "Backdated past the current Faite Loop threshold.",
      });
    } catch (error) {
      toast.error("Seeding failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSeeding(false);
    }
  };

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
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="font-medium">Seed Overflow</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Creates open to-dos backdated past the current Faite Loop
            threshold ({settings ? settings.overflowAfterDays : "…"} rolls),
            spread across your existing lists, so Overdrive has a realistic
            pile to work through.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={100}
            value={seedCount}
            onChange={(e) => setSeedCount(Math.max(1, Number(e.target.value) || 1))}
            className="w-20"
            aria-label="Number of to-dos to seed"
          />
          <Button
            variant="outline"
            onClick={() => void handleSeedOverflow()}
            disabled={seeding || !settings}
            className="w-fit"
          >
            {seeding ? "Seeding…" : `Seed Overflow (${seedCount})`}
          </Button>
        </div>
      </div>

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
