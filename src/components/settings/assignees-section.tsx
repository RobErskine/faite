"use client";

import { useState } from "react";
import { Check, Copy, KeyRound, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mintApiKey } from "@/lib/api-key-expiry";
import { authClient } from "@/lib/auth-client";
import { ACCENT_COLORS } from "@/lib/colors";
import type { Assignee, AssigneeKind } from "@/lib/schema";
import { useAssignees } from "@/lib/store/hooks";
import { createAssignee, deleteAssignee, updateAssignee } from "@/lib/store/repositories";

const KINDS: readonly { value: AssigneeKind; label: string }[] = [
  { value: "agent", label: "Agent" },
  { value: "person", label: "Person" },
];

/** One swatch per accent color, plus "none". Used by the add form and the row editor. */
function ColorPicker({
  value,
  onChange,
  label,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        role="radio"
        aria-checked={value === null}
        aria-label="No color"
        onClick={() => onChange(null)}
        className="flex size-6 items-center justify-center rounded-full border text-xs text-muted-foreground aria-checked:ring-2 aria-checked:ring-ring"
      >
        –
      </button>
      {ACCENT_COLORS.map((color) => (
        <button
          key={color.value}
          type="button"
          role="radio"
          aria-checked={value === color.value}
          aria-label={color.name}
          onClick={() => onChange(color.value)}
          style={{ backgroundColor: color.value }}
          className="flex size-6 items-center justify-center rounded-full aria-checked:ring-2 aria-checked:ring-ring aria-checked:ring-offset-2"
        />
      ))}
    </div>
  );
}

function KindPicker({
  value,
  onChange,
}: {
  value: AssigneeKind;
  onChange: (kind: AssigneeKind) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Kind" className="flex gap-1.5">
      {KINDS.map((kind) => (
        <Button
          key={kind.value}
          type="button"
          role="radio"
          aria-checked={value === kind.value}
          variant={value === kind.value ? "secondary" : "outline"}
          size="sm"
          onClick={() => onChange(kind.value)}
        >
          {kind.label}
        </Button>
      ))}
    </div>
  );
}

/** Reveals a freshly-minted agent key exactly once — same contract as the API Keys tab. */
function NewKeyDialog({ apiKey, onClose }: { apiKey: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(apiKey ?? "").then(() => {
      setCopied(true);
      toast.success("Copied to clipboard");
    });
  };

  return (
    <Dialog
      open={apiKey !== null}
      onOpenChange={(open) => {
        if (!open) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your agent&apos;s API key</DialogTitle>
          <DialogDescription>
            Copy it now — you won&apos;t be able to see it again. Give it to the agent; it can
            read and write your to-dos. If you lose it, delete this assignee and create a new
            one.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input
            readOnly
            value={apiKey ?? ""}
            aria-label="API key"
            className="font-mono text-xs"
            onFocus={(e) => e.target.select()}
          />
          <Button variant="outline" size="icon" aria-label="Copy key" onClick={handleCopy}>
            <Copy className="size-4" aria-hidden />
          </Button>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              setCopied(false);
              onClose();
            }}
            disabled={!copied}
          >
            {copied ? "Done" : "Copy it first"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssigneeRow({
  assignee,
  onKey,
}: {
  assignee: Assignee;
  onKey: (key: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(assignee.name);
  const [color, setColor] = useState(assignee.color);
  const [instructions, setInstructions] = useState(assignee.instructions ?? "");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const isAgent = assignee.kind === "agent";

  const startEditing = () => {
    setName(assignee.name);
    setColor(assignee.color);
    setInstructions(assignee.instructions ?? "");
    setEditing(true);
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await updateAssignee(assignee.id, {
      name: trimmed,
      color,
      ...(isAgent ? { instructions: instructions.trim() || null } : {}),
    });
    setEditing(false);
  };

  const handleCreateKey = async () => {
    setBusy(true);
    let keyId: string | null = null;
    const result = await mintApiKey(
      {
        create: async (payload) => {
          const response = await authClient.apiKey.create(payload);
          keyId = response.data?.id ?? null;
          return response;
        },
        update: (payload) => authClient.apiKey.update(payload),
      },
      // Read + write, never expiring: an unattended agent should not go quiet in 90 days.
      { name: `Agent: ${assignee.name}`, configId: "read-write", expiry: "never" },
    );
    if (!result.ok || !keyId) {
      setBusy(false);
      toast.error("Couldn't create key", {
        description: result.ok ? undefined : result.message,
      });
      return;
    }
    await updateAssignee(assignee.id, { apiKeyId: keyId });
    setBusy(false);
    if (result.expiryWarning) {
      toast.warning("Key created, but it expires in 90 days");
    }
    onKey(result.key);
  };

  const handleDelete = async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    if (assignee.apiKeyId) {
      const { error } = await authClient.apiKey.delete({ keyId: assignee.apiKeyId });
      if (error) {
        // Don't strand the assignee: the key may already be gone or we may be
        // offline. Say so, and let the user finish in Settings → API Keys.
        toast.warning("Couldn't revoke the agent's key", {
          description: "Revoke it in Settings → API Keys.",
        });
      }
    }
    await deleteAssignee(assignee.id);
    setBusy(false);
  };

  return (
    <li className="space-y-2 rounded-md border px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="size-3 shrink-0 rounded-full border"
            style={assignee.color ? { backgroundColor: assignee.color } : undefined}
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{assignee.name}</p>
            <p className="text-xs text-muted-foreground">
              {isAgent ? "Agent" : "Person"}
              {isAgent && (assignee.apiKeyId ? " · key created" : " · no key yet")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isAgent && !assignee.apiKeyId && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void handleCreateKey()}
            >
              <KeyRound className="size-4" aria-hidden />
              {busy ? "Creating…" : "Create key"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit ${assignee.name}`}
            onClick={startEditing}
          >
            <Pencil className="size-4" aria-hidden />
          </Button>
          {armed && !busy && (
            <Button variant="ghost" size="sm" onClick={() => setArmed(false)}>
              Cancel
            </Button>
          )}
          <Button
            variant={armed ? "destructive" : "ghost"}
            size={armed ? "sm" : "icon-sm"}
            aria-label={armed ? undefined : `Delete ${assignee.name}`}
            disabled={busy}
            onClick={() => void handleDelete()}
          >
            {armed ? "Really delete" : <Trash2 className="size-4" aria-hidden />}
          </Button>
        </div>
      </div>
      {armed && (
        <p className="text-xs text-muted-foreground">
          Its to-dos go back to you
          {assignee.apiKeyId ? ", and its API key is revoked" : ""}.
        </p>
      )}
      {editing && (
        <div className="space-y-2 border-t pt-2">
          <Input
            aria-label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <ColorPicker value={color} onChange={setColor} label="Color" />
          {isAgent && (
            <textarea
              aria-label="Instructions"
              placeholder="Standing instructions for this agent"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
              className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
            />
          )}
          <div className="flex gap-2">
            <Button size="sm" disabled={!name.trim()} onClick={() => void handleSave()}>
              <Check className="size-4" aria-hidden />
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel edit
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Settings → Assignees (EI-402): the agents and people a to-do can be
 * assigned to. A null `assigneeId` is you, so you are not listed.
 *
 * An agent can be given its own read & write API key. The key's id is stored
 * on the assignee (`apiKeyId`) so the server can attribute the key's work to
 * it; the secret is shown once and never stored. Deleting an assignee hands
 * its to-dos back to you and revokes the key.
 */
export function AssigneesSection() {
  const assignees = useAssignees();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AssigneeKind>("agent");
  const [color, setColor] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  const handleAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await createAssignee(trimmed, kind, { color });
    setName("");
    setColor(null);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Label>Assignees</Label>
        {assignees.length === 0 ? (
          <p className="text-sm text-muted-foreground">No assignees yet.</p>
        ) : (
          <ul className="space-y-2">
            {assignees.map((assignee) => (
              <AssigneeRow key={assignee.id} assignee={assignee} onKey={setNewKey} />
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="assignee-name">Add an assignee</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="assignee-name"
            placeholder="Name — Claude, Sam…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAdd();
            }}
          />
          <Button variant="outline" size="sm" onClick={() => void handleAdd()} disabled={!name.trim()}>
            Add
          </Button>
        </div>
        <KindPicker value={kind} onChange={setKind} />
        <ColorPicker value={color} onChange={setColor} label="New assignee color" />
      </div>

      <NewKeyDialog apiKey={newKey} onClose={() => setNewKey(null)} />
    </div>
  );
}
