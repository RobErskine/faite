"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient, useSession } from "@/lib/auth-client";

/** Mirrors the plugin's two named configurations (`src/server/auth-tokens.ts`,
 * EI-259) — the only two values `configId` may take. A key's `configId`
 * itself isn't part of what `apiKey.list()` returns, so scope is read back
 * from `permissions` via `scopeSummary` below, not from this type. */
type KeyConfigId = "default" | "read-write";

/** Never changes within a page's life — same rationale as `useIsLocalDev`
 * in settings-sheet.tsx and `subscribeToNothing` in reminders-section.tsx. */
const subscribeToNothing = () => () => {};

/** Only `false` is trusted — it means definitely offline. `true` lies behind
 * a captive portal. Wrapped in `useSyncExternalStore` (rather than read
 * directly) because `navigator` doesn't exist during the static export's
 * prerender — see `use-place-search.ts`'s identical guard and
 * `useIsLocalDev`'s doc comment for the same pattern. */
function useOnline(): boolean {
  return useSyncExternalStore(subscribeToNothing, () => navigator.onLine !== false, () => true);
}

interface ApiKeyRow {
  id: string;
  name: string | null;
  start: string | null;
  prefix: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  permissions: Record<string, string[]> | null;
}

function scopeSummary(permissions: Record<string, string[]> | null): string {
  const actions = permissions?.api ?? [];
  if (actions.length === 0) return "No access";
  if (actions.includes("sync") || actions.includes("places")) return "Full access";
  if (actions.includes("write")) return "Read & write";
  return "Read-only";
}

function formatDate(value: Date): string {
  return value.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * One key's row. Revoke uses the two-click "armed" confirm pattern from
 * `developer-section.tsx` rather than a dialog — a single destructive action
 * with no undo, same reasoning that pattern already settled.
 */
function ApiKeyRowItem({ apiKey, onRevoked }: { apiKey: ApiKeyRow; onRevoked: () => void }) {
  const [armed, setArmed] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const handleRevoke = async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setRevoking(true);
    const { error } = await authClient.apiKey.delete({ keyId: apiKey.id });
    setRevoking(false);
    if (error) {
      toast.error("Couldn't revoke key", {
        description: error.message ?? "Something went wrong. Please try again.",
      });
      return;
    }
    toast.success(`Revoked "${apiKey.name ?? apiKey.id}"`);
    onRevoked();
  };

  return (
    <li className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{apiKey.name ?? "Unnamed key"}</p>
        <p className="truncate text-xs text-muted-foreground">
          {apiKey.prefix ?? ""}
          {apiKey.start ?? ""}… · <span>{scopeSummary(apiKey.permissions)}</span> · created{" "}
          {formatDate(apiKey.createdAt)}
          {apiKey.expiresAt && <> · expires {formatDate(apiKey.expiresAt)}</>}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {armed && !revoking && (
          <Button variant="ghost" size="sm" onClick={() => setArmed(false)}>
            Cancel
          </Button>
        )}
        <Button
          variant={armed ? "destructive" : "ghost"}
          size={armed ? "sm" : "icon-sm"}
          // Only icon-only (unarmed) needs an aria-label — armed, the
          // visible "Really revoke"/"Revoking…" text already IS the
          // accessible name, and an aria-label would override it instead.
          aria-label={armed ? undefined : `Revoke ${apiKey.name ?? "key"}`}
          disabled={revoking}
          onClick={() => void handleRevoke()}
        >
          {armed ? (revoking ? "Revoking…" : "Really revoke") : <Trash2 className="size-4" aria-hidden />}
        </Button>
      </div>
    </li>
  );
}

/**
 * Reveals a freshly-created key exactly once — Better Auth never returns the
 * plaintext again after this response (`getApiKey`/`listApiKeys` return
 * everything else but not `key`, per `auth-tokens.ts`'s own doc comment), so
 * closing this without copying means generating a new one.
 */
function NewKeyDialog({ apiKey, onClose }: { apiKey: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(apiKey ?? "").then(() => {
      setCopied(true);
      toast.success("Copied to clipboard");
    });
  };

  return (
    <Dialog open={apiKey !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your new API key</DialogTitle>
          <DialogDescription>
            Copy it now — you won&apos;t be able to see it again. If you lose it,
            revoke this key and create a new one.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input readOnly value={apiKey ?? ""} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
          <Button variant="outline" size="icon" aria-label="Copy key" onClick={handleCopy}>
            <Copy className="size-4" aria-hidden />
          </Button>
        </div>

        <DialogFooter>
          <Button onClick={onClose} disabled={!copied}>
            {copied ? "Done" : "Copy it first"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Settings → API Keys (A3, EI-228) — the first Settings section whose
 * content requires the network: the list of keys lives in D1
 * (`auth-tokens.ts`'s `apiKey` plugin table), not the local-first Dexie
 * store every other section reads.
 *
 * Every key created here gets one of the plugin's two named configurations
 * (`src/server/auth-tokens.ts`, EI-259) — `default`'s `{ api: ["read"] }`
 * unless the Write checkbox is ticked, in which case `read-write`'s
 * `{ api: ["read", "write"] }`. Either way it's `/api/v1` reads (plus writes,
 * if chosen), never `/api/sync/*` or `/api/places/*` (A2, EI-227) — the
 * checkbox only ever selects between two FIXED, server-defined permission
 * sets; the client cannot request a scope outside them. A key's scope is
 * fixed at creation and cannot be widened later (the plugin rejects
 * `permissions` on `update` the same as on `create`) — to change it, make a
 * new key and revoke the old one. The full-access key the desktop shell
 * mints for itself (`/api/desktop/handoff`) is not manageable from here on
 * purpose: it is bound to a device, not something a user creates by hand.
 */
export function ApiKeysSection() {
  const { data: session, isPending, error: sessionError } = useSession();
  const online = useOnline();

  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState("");
  const [write, setWrite] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (!session || !online) return;
    let cancelled = false;

    void authClient.apiKey.list().then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data) {
        setLoadError(true);
        return;
      }
      setLoadError(false);
      setKeys(data.apiKeys as ApiKeyRow[]);
    });

    return () => {
      cancelled = true;
    };
  }, [session, online, refreshToken]);

  const refresh = () => setRefreshToken((n) => n + 1);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    // `configId` picks one of the two FIXED configurations in
    // `auth-tokens.ts` by name — it's the only scope-related field the
    // client is allowed to set at all (see this file's header comment).
    const configId: KeyConfigId = write ? "read-write" : "default";
    const { data, error } = await authClient.apiKey.create({ name: trimmed, configId });
    setCreating(false);
    if (error || !data) {
      toast.error("Couldn't create key", {
        description: error?.message ?? "Something went wrong. Please try again.",
      });
      return;
    }
    setName("");
    setWrite(false);
    setNewKey(data.key);
    refresh();
  };

  if (isPending) return null;

  if (!session) {
    return (
      <p className="text-sm text-muted-foreground">
        {sessionError
          ? "Couldn't check your sign-in status — try again once you're back online."
          : "Sign in to create and manage API keys."}
      </p>
    );
  }

  if (!online) {
    return (
      <p className="text-sm text-muted-foreground">
        API keys require a network connection — try again once you&apos;re back
        online.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Label>Your API keys</Label>
        <p className="text-sm text-muted-foreground">
          Scoped to{" "}
          <a href="/api/v1" className="underline">
            /api/v1
          </a>{" "}
          — never full account access. Choose read-only or read &amp; write
          when you create one; see the public API docs for what you can do
          with each.
        </p>
        {loadError ? (
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t load your keys. Try again in a moment.
          </p>
        ) : keys === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No API keys yet.</p>
        ) : (
          <ul className="space-y-2">
            {keys.map((apiKey) => (
              <ApiKeyRowItem key={apiKey.id} apiKey={apiKey} onRevoked={refresh} />
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="api-key-name">Create a key</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="api-key-name"
            placeholder="Name — Pointer, my script…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleCreate()}
            disabled={!name.trim() || creating}
          >
            {creating ? "Creating…" : "Create"}
          </Button>
        </div>
        {/* Scope is fixed once the key is created (see this file's header
            comment) — these two are the entire choice. Read is always on:
            there is no key with zero access, so showing it disabled rather
            than omitting it is what tells the reader access is happening at
            all. */}
        <div className="flex flex-col gap-2 pt-1">
          <div className="flex items-center gap-2">
            <Checkbox id="api-key-scope-read" checked disabled />
            <Label htmlFor="api-key-scope-read" className="font-normal text-muted-foreground">
              Read — always included
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="api-key-scope-write" checked={write} onCheckedChange={setWrite} />
            <Label htmlFor="api-key-scope-write" className="font-normal">
              Write — create and update todos (needed for MCP tools)
            </Label>
          </div>
        </div>
      </div>

      <NewKeyDialog apiKey={newKey} onClose={() => setNewKey(null)} />
    </div>
  );
}
