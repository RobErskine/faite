"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import {
  AVATAR_KINDS,
  firstGrapheme,
  resolveAvatar,
  type AvatarKind,
} from "@/lib/profile";
import {
  AvatarImageTooLargeError,
  fileToAvatarDataUrl,
} from "@/lib/avatar-image";
import { useIdentity } from "@/lib/use-identity";
import { LOCAL_OWNER_ID } from "@/lib/store/repositories";
import { mutateSettings } from "@/lib/store/mutate";
import { cn } from "@/lib/utils";
import type { SettingsSectionProps } from "./types";

/**
 * Display name and avatar. The avatar preview reuses UserAvatar — the exact
 * component the header renders — so what's shown here is what appears there.
 */
export function ProfileSection({ settings }: SettingsSectionProps) {
  // Same fallback chain as the header, so the placeholder in the name field
  // shows what will actually render if they leave it blank.
  const identity = useIdentity();
  const avatar = resolveAvatar(settings, identity);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(settings?.displayName ?? "");
  const [uploading, setUploading] = useState(false);

  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed === (settings?.displayName ?? "")) return;
    void mutateSettings(LOCAL_OWNER_ID, { displayName: trimmed });
  };

  const setKind = (kind: AvatarKind) =>
    void mutateSettings(LOCAL_OWNER_ID, { avatarKind: kind });

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      await mutateSettings(LOCAL_OWNER_ID, {
        avatarImage: dataUrl,
        avatarKind: "image",
      });
    } catch (err) {
      toast.error(
        err instanceof AvatarImageTooLargeError
          ? err.message
          : "Couldn't read that image.",
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="settings-display-name">Display name</Label>
        <Input
          id="settings-display-name"
          value={name}
          placeholder={avatar.name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          className="max-w-sm"
        />
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Avatar</legend>

        <div className="flex items-center gap-4">
          <UserAvatar settings={settings} className="size-16 text-lg" />

          <div className="inline-flex rounded-lg border p-1">
            {AVATAR_KINDS.map((kind) => {
              const active = avatar.kind === kind.id;
              return (
                <button
                  key={kind.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setKind(kind.id)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    active
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {kind.label}
                </button>
              );
            })}
          </div>
        </div>

        {avatar.kind === "initials" ? (
          <div className="max-w-40 space-y-1.5">
            <Label htmlFor="settings-avatar-initials">Initials</Label>
            <Input
              id="settings-avatar-initials"
              value={settings?.avatarInitials ?? ""}
              placeholder={avatar.initials}
              maxLength={2}
              onChange={(e) =>
                void mutateSettings(LOCAL_OWNER_ID, {
                  avatarInitials: e.target.value.toUpperCase().slice(0, 2),
                })
              }
            />
          </div>
        ) : null}

        {avatar.kind === "emoji" ? (
          <div className="max-w-40 space-y-1.5">
            <Label htmlFor="settings-avatar-emoji">Emoji</Label>
            <Input
              id="settings-avatar-emoji"
              value={settings?.avatarEmoji ?? ""}
              placeholder="🙂"
              onChange={(e) =>
                void mutateSettings(LOCAL_OWNER_ID, {
                  avatarEmoji: firstGrapheme(e.target.value),
                })
              }
            />
          </div>
        ) : null}

        {avatar.kind === "image" ? (
          <div className="max-w-sm space-y-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? "Uploading…" : "Choose photo…"}
            </Button>
            <div className="space-y-1.5">
              <Label htmlFor="settings-avatar-url">Or an image URL</Label>
              <Input
                id="settings-avatar-url"
                type="url"
                value={
                  settings?.avatarImage?.startsWith("data:")
                    ? ""
                    : (settings?.avatarImage ?? "")
                }
                placeholder="https://…"
                onChange={(e) =>
                  void mutateSettings(LOCAL_OWNER_ID, {
                    avatarImage: e.target.value.trim(),
                  })
                }
              />
            </div>
          </div>
        ) : null}
      </fieldset>
    </div>
  );
}
