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
import { signUp } from "@/lib/auth-client";

function SignupForm() {
  const router = useRouter();
  // useSearchParams needs a Suspense boundary under `output: export` — see
  // the wrapper below. Same D2a purpose as login/page.tsx.
  const callbackURL = useSearchParams().get("callbackURL") ?? "/board";

  // Reached inside the Tauri webview: render the browser handoff, never
  // the form — a sign-in attempted here cannot hold a session cookie and
  // silently returns to a signed-out board. See DesktopAuthNotice.
  const desktop = isDesktopShell();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set once sign-up succeeds but verification is required before a session
  // exists — see REQUIRE_EMAIL_VERIFICATION in src/server/auth.ts. Once that
  // flag flips on, this is the branch every signup takes.
  const [awaitingVerification, setAwaitingVerification] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const { data, error: signUpError } = await signUp.email({ name, email, password });

    setSubmitting(false);
    if (signUpError) {
      setError(signUpError.message ?? "Couldn't create that account.");
      return;
    }
    if (data?.token) {
      router.push(callbackURL);
      return;
    }
    setAwaitingVerification(true);
  };

  if (awaitingVerification) {
    return (
      <AuthShell title="Check your email" description={`We sent a verification link to ${email}.`}>
        <p className="text-sm text-muted-foreground">
          Click the link to finish creating your account, then{" "}
          <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
            sign in
          </Link>
          .
        </p>
      </AuthShell>
    );
  }

  if (desktop) return <DesktopAuthNotice page="signup" />;

  return (
    <AuthShell
      title="Create an account"
      footer={
        <>
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Sign in
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
          <Label htmlFor="signup-name">Name</Label>
          <Input
            id="signup-name"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="signup-email">Email</Label>
          <Input
            id="signup-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="signup-password">Password</Label>
          <Input
            id="signup-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthShell>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}
