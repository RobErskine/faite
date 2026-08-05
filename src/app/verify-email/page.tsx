"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { authClient } from "@/lib/auth-client";

type Status = "verifying" | "verified" | "error";

function VerifyEmailContent() {
  const token = useSearchParams().get("token");
  const [status, setStatus] = useState<Status>(token ? "verifying" : "error");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    void authClient.$fetch("/verify-email", { query: { token } }).then(({ error }) => {
      if (!cancelled) setStatus(error ? "error" : "verified");
    });

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (status === "verifying") {
    return <AuthShell title="Verifying…" description="One moment.">{null}</AuthShell>;
  }

  if (status === "error") {
    return (
      <AuthShell title="Couldn't verify that email" description="This link may have expired.">
        <p className="text-sm text-muted-foreground">
          <Link
            href="/login"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Back to sign in
          </Link>
          , then request a new verification email.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Email verified" description="Your account is ready to go.">
      <p className="text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  );
}
