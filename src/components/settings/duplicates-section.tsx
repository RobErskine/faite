"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DuplicatesUnavailableError,
  fetchJevKeyStatus,
  JevKeyRejectedError,
  type JevKeyStatus,
  removeJevKey,
  saveJevKey,
} from "@/lib/duplicates-key";
import { mutateSettings } from "@/lib/store/mutate";
import { LOCAL_OWNER_ID } from "@/lib/store/owner";
import type { SettingsSectionProps } from "./types";

/**
 * Duplicate detection (EI-346): the user's own TypeSafe Jev key, and whether
 * every match is held off the board.
 *
 * With a key saved, every new to-do — typed here, sent from Raycast or MCP,
 * or forwarded by email — is compared against the open ones. The key is
 * write-only from here: the field never shows it again, only its last four.
 */
export function DuplicatesSection({ settings }: SettingsSectionProps) {
  const [status, setStatus] = useState<JevKeyStatus | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let canceled = false;
    fetchJevKeyStatus()
      .then((next) => {
        if (!canceled) setStatus(next);
      })
      .catch((error: unknown) => {
        if (canceled) return;
        setUnavailable(
          error instanceof DuplicatesUnavailableError ? error.message : "Could not load your key status.",
        );
      });
    return () => {
      canceled = true;
    };
  }, []);

  const save = async () => {
    const apiKey = draft.trim();
    if (!apiKey) return;
    setBusy(true);
    try {
      const next = await saveJevKey(apiKey);
      setStatus(next);
      setDraft("");
      if (next.check === "unverified") {
        toast.warning("Key saved, but TypeSafe could not be reached to check it.");
      } else {
        toast.success("Duplicate detection is on.");
      }
    } catch (error) {
      toast.error(
        error instanceof JevKeyRejectedError || error instanceof DuplicatesUnavailableError
          ? error.message
          : "Something went wrong.",
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      setStatus(await removeJevKey());
      toast.success("Duplicate detection is off.");
    } catch {
      toast.error("Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        With a key saved, each new to-do is checked against your open ones by TypeSafe&apos;s Jev
        model. A likely duplicate from Raycast, MCP, the API or email is held off your board until
        you review it under <strong>Duplicates</strong> in the account menu; one you type on the
        board stays put and is only flagged, unless you turn on <strong>Hold every
        duplicate</strong> below. Checks run on your own key and send the to-do&apos;s title and
        notes to TypeSafe.
      </p>

      {/* Only the key block needs the Worker. The switch below is a synced
          setting, so it stays usable when the key status cannot load. */}
      {unavailable ? (
        <p className="text-sm text-muted-foreground">{unavailable}</p>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="jev-key">TypeSafe API key</Label>
          {status?.connected ? (
            <div className="flex items-center gap-3">
              <p className="text-sm">
                Connected <span className="font-mono text-muted-foreground">••••{status.last4}</span>
              </p>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void remove()}>
                Remove
              </Button>
            </div>
          ) : null}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Input
              id="jev-key"
              type="password"
              autoComplete="off"
              placeholder={status?.connected ? "Paste a new key to replace it" : "Paste your key"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="font-mono text-xs"
            />
            <Button type="submit" disabled={busy || !draft.trim()}>
              Save
            </Button>
          </form>
          <p className="text-sm text-muted-foreground">
            Get a key at{" "}
            <a
              href="https://console.typesafe.ai/keys"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              console.typesafe.ai
            </a>
            .
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="hold-all-duplicates">Hold every duplicate</Label>
          <p className="text-sm text-muted-foreground">
            Keep every likely duplicate off your board, including ones you type on the board. It
            waits under Duplicates until you add it back or remove it.
          </p>
        </div>
        <Switch
          id="hold-all-duplicates"
          checked={settings?.holdAllDuplicates ?? false}
          onCheckedChange={(checked) => void mutateSettings(LOCAL_OWNER_ID, { holdAllDuplicates: checked })}
        />
      </div>
    </div>
  );
}
