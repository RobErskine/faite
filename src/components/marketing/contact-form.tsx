"use client";

import Script from "next/script";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiUrl } from "@/lib/api-origin";

declare global {
  interface Window {
    turnstile?: {
      render(
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
        },
      ): string;
      reset(widgetId: string): void;
    };
  }
}

type Status = "idle" | "submitting" | "success" | "error";

/**
 * The one static page with real client JS — a client-side `fetch`, which is
 * fine under `output: "export"` since nothing here is server-rendered.
 *
 * Uses `apiUrl()` (`src/lib/api-origin.ts`), not a relative `fetch`. Inside
 * the Capacitor/Tauri shell a relative `/api/contact` would resolve against
 * the local webview origin, not `myfaite.app` — `apiUrl()` is the existing,
 * tested mechanism every other `/api/*` seam already uses for exactly this,
 * so this reuses it rather than inventing a second origin variable.
 *
 * Turnstile is rendered explicitly (not the implicit `cf-turnstile` div
 * scan) specifically so `turnstile.reset(widgetId)` is reachable after a
 * failed submit — tokens are single-use and expire after 300s, so a bare
 * retry with the same token would silently fail server-side.
 */
export function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  const renderWidget = () => {
    if (!widgetRef.current || !window.turnstile || !siteKey) return;
    widgetIdRef.current = window.turnstile.render(widgetRef.current, {
      sitekey: siteKey,
      callback: (t) => setToken(t),
      "error-callback": () => setToken(null),
      "expired-callback": () => setToken(null),
    });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!token) return;

    const form = e.currentTarget;
    const data = new FormData(form);
    setStatus("submitting");
    setErrorMessage(null);

    try {
      const res = await fetch(apiUrl("/api/contact"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.get("name"),
          email: data.get("email"),
          message: data.get("message"),
          turnstileToken: token,
        }),
      });

      if (!res.ok) {
        setStatus("error");
        setErrorMessage(
          res.status === 429
            ? "Too many submissions — please wait a minute and try again."
            : "Something went wrong. Please try again.",
        );
        // The token that just failed is either wrong or already spent — a
        // bare retry without a fresh widget interaction will fail again.
        setToken(null);
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
        }
        return;
      }

      setStatus("success");
      form.reset();
    } catch {
      setStatus("error");
      setErrorMessage("Something went wrong. Please try again.");
      setToken(null);
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current);
      }
    }
  };

  if (status === "success") {
    return (
      <p className="rounded-lg border bg-muted/40 p-4 text-sm text-foreground">
        Thanks — that&apos;s sent. We&apos;ll get back to you.
      </p>
    );
  }

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={renderWidget}
      />

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <div className="grid gap-1.5">
          <Label htmlFor="contact-name">Name</Label>
          <Input id="contact-name" name="name" required maxLength={200} />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="contact-email">Email</Label>
          <Input id="contact-email" name="email" type="email" required maxLength={320} />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="contact-message">Message</Label>
          <Textarea id="contact-message" name="message" required maxLength={5000} rows={6} />
        </div>

        <div ref={widgetRef} />

        {status === "error" && errorMessage ? (
          <p className="text-sm text-destructive">{errorMessage}</p>
        ) : null}

        <Button type="submit" disabled={!token || status === "submitting"}>
          {status === "submitting" ? "Sending…" : "Send"}
        </Button>
      </form>
    </>
  );
}
