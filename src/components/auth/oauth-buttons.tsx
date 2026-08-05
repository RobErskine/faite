"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { signIn } from "@/lib/auth-client";

// lucide-react ships no brand marks (trademarked logos), so these are plain
// inline SVGs — the standard workaround, not a new icon dependency.
function GithubMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4" fill="currentColor">
      <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.09 3.29 9.4 7.86 10.93.57.1.78-.25.78-.55v-2.1c-3.2.7-3.88-1.35-3.88-1.35-.53-1.33-1.29-1.69-1.29-1.69-1.05-.72.08-.7.08-.7 1.17.08 1.78 1.2 1.78 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.58.23 2.75.11 3.04.74.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .3.21.66.79.55A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.47a5.53 5.53 0 0 1-2.4 3.63v3.02h3.88c2.27-2.09 3.54-5.17 3.54-8.68Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.92l-3.87-3.02c-1.08.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.73-4.96H1.27v3.11A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.25a7.2 7.2 0 0 1 0-4.5V6.64H1.27a12 12 0 0 0 0 10.72l4-3.11Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.94 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.27 6.64l4 3.11C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  );
}

interface OAuthButtonsProps {
  /** Where the provider sends the browser back after a successful sign-in. */
  callbackURL?: string;
}

export function OAuthButtons({ callbackURL = "/board" }: OAuthButtonsProps) {
  const [pending, setPending] = useState<"github" | "google" | null>(null);

  const handle = async (provider: "github" | "google") => {
    setPending(provider);
    // Redirects the whole page to the provider; this only returns early on a
    // client-side failure (network, misconfigured provider) before that
    // happens, so resetting `pending` here is for that failure path only.
    await signIn.social({ provider, callbackURL });
    setPending(null);
  };

  return (
    <div className="grid gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={pending !== null}
        onClick={() => void handle("github")}
      >
        <GithubMark />
        {pending === "github" ? "Redirecting…" : "Continue with GitHub"}
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={pending !== null}
        onClick={() => void handle("google")}
      >
        <GoogleMark />
        {pending === "google" ? "Redirecting…" : "Continue with Google"}
      </Button>
    </div>
  );
}
