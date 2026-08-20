import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Server Component, deliberately — no session check here. On `/` a signed-in
 * visitor is redirected to `/board` before this ever renders (see the inline
 * script in `app/page.tsx`), so anyone who sees it there is either logged out
 * or has JS disabled — "Log in" is the correct link either way. This header
 * also renders on every other static page (`/privacy`, `/help`, etc.), which
 * has no such redirect script, so a signed-in visitor CAN see "Log in / Sign
 * up" there — still the right thing to show, since this component has no
 * access to session state either way.
 */
export function MarketingHeader() {
  return (
    <header className="flex h-14 items-center justify-between px-4 sm:px-6">
      <Link href="/" className="font-heading text-base font-semibold tracking-tight">
        Faite
      </Link>

      <div className="flex items-center gap-2">
        <Link
          href="/login"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          Log in
        </Link>
        <Link
          href="/signup"
          className={cn(buttonVariants({ variant: "default", size: "sm" }))}
        >
          Sign up
        </Link>
      </div>
    </header>
  );
}
