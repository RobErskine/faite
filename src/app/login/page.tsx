"use client";

import { Suspense, type FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { DesktopAuthNotice } from "@/components/auth/desktop-auth-notice";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { isDesktopShell } from "@/lib/desktop/bridge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { signIn } from "@/lib/auth-client";

function LoginForm() {
  const router = useRouter();
  // useSearchParams needs a Suspense boundary under `output: export` — see
  // the wrapper below. D2a: the desktop shell's system-browser login opens
  // this page with `?callbackURL=/desktop-handoff` so BOTH sign-in paths
  // (this form and <OAuthButtons>) land there instead of /board — see
  // desktop-handoff/page.tsx.
  const callbackURL = useSearchParams().get("callbackURL") ?? "/board";

  // Reached inside the Tauri webview: render the browser handoff, never
  // the form — a sign-in attempted here cannot hold a session cookie and
  // silently returns to a signed-out board. See DesktopAuthNotice.
  const desktop = isDesktopShell();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const { error: signInError } = await signIn.email({ email, password });

    setSubmitting(false);
    if (signInError) {
      setError(signInError.message ?? "Couldn't sign in with those details.");
      return;
    }
    router.push(callbackURL);
  };

  if (desktop) return <DesktopAuthNotice page="login" />;

  return (
    <AuthShell
      title="Sign in"
      description="Welcome back."
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Sign up
          </Link>
        </>
      }
    >
      <OAuthButtons callbackURL={callbackURL} />

      <div className="flex items-center gap-2">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">or</span>
        <Separator className="flex-1" />
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="login-email">Email</Label>
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="login-password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
