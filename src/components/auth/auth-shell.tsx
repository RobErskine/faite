import Link from "next/link";

interface AuthShellProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * Shared chrome for the four auth pages (login/signup/forgot/reset) plus
 * verify-email. Plain client routes, not gated behind anything — see
 * ARCHITECTURE §2.4: the board works fully signed out, so these are reachable
 * but never forced.
 */
export function AuthShell({ title, description, children, footer }: AuthShellProps) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <Link href="/" className="font-heading text-lg font-semibold tracking-tight">
            Faite
          </Link>
        </div>

        <div className="space-y-6 rounded-xl border bg-background p-6 shadow-sm">
          <div className="space-y-1.5 text-center">
            <h1 className="font-heading text-lg font-semibold">{title}</h1>
            {description ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {children}
        </div>

        {footer ? (
          <div className="text-center text-sm text-muted-foreground">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
