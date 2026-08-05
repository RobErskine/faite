import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Server Component, deliberately — no session check here. A signed-in
 * visitor is redirected to /board before this ever renders (see the inline
 * script in `app/page.tsx`); anyone who does see this is either logged out or
 * has JS disabled, and "Log in" is the correct link either way.
 */
export function MarketingHeader() {
  return (
    <header className="flex h-14 items-center justify-between px-4 sm:px-6">
      <span className="font-heading text-base font-semibold tracking-tight">
        Faite
      </span>

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
