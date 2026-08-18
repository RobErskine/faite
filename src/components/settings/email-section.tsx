"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createIngestAddress,
  fetchIngestAddress,
  IngestUnavailableError,
  MAX_EMAIL_MB,
  RATE_LIMIT,
  rotateIngestAddress,
  type IngestAddress,
} from "@/lib/email-ingest";

/**
 * The email capture address (EI-186): forward anything here and it lands in
 * Backlog with the plaintext body as its notes.
 *
 * **Not provisioned on load.** The GET never mints an address, so opening
 * this panel out of curiosity does not give the account a live inbox — the
 * user has to ask. That also means the empty state is a real state, not a
 * loading artifact.
 *
 * The address IS the credential (there is no sender check — envelope `from`
 * is trivially spoofed), which is what the rotate button is for and why its
 * copy says the old one stops working rather than "you can rotate this".
 */
export function EmailSection() {
  const [state, setState] = useState<IngestAddress | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchIngestAddress()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setUnavailable(
          error instanceof IngestUnavailableError
            ? error.message
            : "Could not load your capture address.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(async (action: () => Promise<IngestAddress>, success: string) => {
    setBusy(true);
    try {
      setState(await action());
      toast.success(success);
    } catch (error) {
      toast.error(
        error instanceof IngestUnavailableError ? error.message : "Something went wrong.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const handleCopy = async () => {
    if (!state?.address) return;
    try {
      await navigator.clipboard.writeText(state.address);
      toast.success("Address copied.");
    } catch {
      // Clipboard access is permission-gated and absent over plain http on a
      // LAN address. The field is selectable, so this is a nudge, not a dead
      // end.
      toast.error("Could not copy — select the address and copy it manually.");
    }
  };

  if (unavailable) {
    return <p className="text-sm text-muted-foreground">{unavailable}</p>;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="ingest-address">Your capture address</Label>
        {state?.address ? (
          <>
            <div className="flex gap-2">
              <Input
                id="ingest-address"
                readOnly
                value={state.address}
                onFocus={(e) => e.currentTarget.select()}
                className="font-mono text-xs"
              />
              <Button variant="outline" onClick={() => void handleCopy()} aria-label="Copy address">
                <Copy className="size-4" aria-hidden />
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Forward or send anything here and it becomes a to-do in Backlog — the subject is
              the title, the plaintext body becomes the notes. Attachments are dropped.
            </p>
            {/*
              Stated plainly because the cap DESTROYS mail rather than delaying
              it: a rejection is a permanent SMTP error, so the sender never
              retries and nothing arrives later. A limit with that consequence
              cannot be a detail buried in the docs — see `RATE_LIMIT` in
              `src/server/email/addresses.ts`.
            */}
            <p className="text-sm text-muted-foreground">
              Limits: up to <strong>{RATE_LIMIT} emails per hour</strong> and {MAX_EMAIL_MB} MB per
              message. Anything over either limit is <strong>rejected, not queued</strong> — the
              sender gets a bounce and it will not arrive later.
            </p>
            <p className="text-sm text-muted-foreground">
              {state.lastUsedAt
                ? `Last used ${new Date(state.lastUsedAt).toLocaleString()}.`
                : "Nothing has arrived on it yet."}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              You don&apos;t have one yet. Creating it gives you a private address that turns
              forwarded email into to-dos.
            </p>
            <Button
              disabled={busy}
              onClick={() => void run(createIngestAddress, "Capture address created.")}
            >
              Create my address
            </Button>
          </>
        )}
      </div>

      {state?.address && (
        <div className="space-y-2">
          <Label>Rotate</Label>
          <p className="text-sm text-muted-foreground">
            Anyone who knows this address can add to-dos to your board — there is no other
            check, because a sender address can be faked. Rotate it if it leaks. The old
            address stops working immediately and is never reissued.
          </p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void run(rotateIngestAddress, "New capture address issued.")}
          >
            <RefreshCw className="size-4" aria-hidden />
            Rotate address
          </Button>
        </div>
      )}
    </div>
  );
}
