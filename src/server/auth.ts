import { APIError, betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./auth-schema";
import { sendEmail } from "./email";
import { apiTokenPlugin } from "./auth-tokens";

/** Also the CORS allow-list for `/api/sync/*` (`src/server/sync/routes.ts`) —
 * one list, so it can't drift between the two seams. */
export const TRUSTED_ORIGINS = [
  "https://myfaite.app",
  "http://localhost:3000",
  "http://localhost:8787",
  "http://localhost:8790",
  // Capacitor's WebView origin (P7, EI-51). Free to declare now, not a code
  // change later.
  "capacitor://localhost",
  // The Tauri desktop shell's webview origin (D2a). The actual SIGN-IN flow
  // never touches this origin — it runs in the system browser, since Better
  // Auth's client rejects `tauri://localhost` as a base URL outright (D0
  // §3.7) — but once the shell holds a bearer token (`docs/DESKTOP.md` §9),
  // `useSession()`, `/api/sync/*`, and `/api/desktop/exchange` all call back
  // to `https://myfaite.app` FROM here, genuinely cross-origin every time.
  "tauri://localhost",
];

/** Used only for schema generation, where no request exists — see auth-cli.ts. */
const FALLBACK_ORIGIN = "https://myfaite.app";

/**
 * Better Auth must be constructed per request: the D1 and Email bindings only
 * exist inside `fetch()`, so a module-level singleton fails at runtime (see
 * EI-45 and ARCHITECTURE §7). Call this fresh in the worker's fetch handler.
 *
 * `request` supplies the origin. **Do not hardcode `baseURL` per environment.**
 * Better Auth builds its origin check and every callback URL from it, so a
 * fixed value breaks auth on any host that isn't the one hardcoded — which is
 * every branch preview (`*-faite.bfmw-dev.workers.dev`) and both local ports.
 * Deriving it means production, previews, and local all work with no
 * environment branching at all.
 *
 * This is not a weakening of the origin check. A browser sets `Origin` from
 * the page's real origin and scripts cannot forge it, so a request from
 * evil.com to this worker still arrives with `Origin: evil.com` against a
 * `baseURL` of this host, and is still rejected. `TRUSTED_ORIGINS` remains the
 * allow-list for redirect targets.
 */
export function createAuth(env: CloudflareEnv, request?: Request) {
  const origin = request ? new URL(request.url).origin : FALLBACK_ORIGIN;
  const { hostname } = new URL(origin);
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1";

  /**
   * Gates password sign-in on a clicked verification link. GitHub and Google
   * hand over an already-verified address, so this only ever affects
   * email/password.
   *
   * **Off on localhost, on everywhere else** — a deadlock fix, not a
   * preference. The `send_email` binding does not deliver under local
   * `wrangler dev` (that needs `"remote": true`), so requiring verification
   * locally would strand every local signup with no way to reach the link.
   * Keyed on the request's hostname rather than `NEXTJS_ENV` so it cannot
   * disagree with the origin the request actually arrived on. Branch previews
   * are *not* local and stay strict — they share production's D1.
   */
  const requireEmailVerification = !isLocal;

  return betterAuth({
    baseURL: origin,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: TRUSTED_ORIGINS,

    database: drizzleAdapter(drizzle(env.AUTH_DB), {
      provider: "sqlite",
      schema,
    }),

    emailAndPassword: {
      enabled: true,
      requireEmailVerification,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(env, {
          to: user.email,
          subject: "Reset your Faite password",
          html: `<p>Someone requested a password reset for this account. If it was you, <a href="${url}">reset your password</a>. This link expires in 1 hour.</p><p>If it wasn't you, ignore this email.</p>`,
          text: `Reset your password: ${url}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
        }, isLocal);
      },
      // Avoids confirming to an attacker (or a fat-fingering user) whether an
      // email is already registered.
      onExistingUserSignUp: async ({ user }) => {
        await sendEmail(env, {
          to: user.email,
          subject: "Sign-up attempt on your Faite account",
          html: `<p>Someone tried to create a Faite account with this email, which already has one. If that was you, <a href="${origin}/forgot-password">reset your password</a> instead.</p>`,
          text: `Someone tried to create a Faite account with this email, which already has one. If that was you, reset your password: ${origin}/forgot-password`,
        }, isLocal);
      },
    },

    emailVerification: {
      sendVerificationEmail: async ({ user, token }) => {
        // A link to our own /verify-email page (which calls the API and shows
        // a result) rather than better-auth's generated `url` — that points
        // straight at the API endpoint, which would hand the browser raw JSON
        // instead of a page.
        const link = `${origin}/verify-email?token=${encodeURIComponent(token)}`;
        await sendEmail(env, {
          to: user.email,
          subject: "Verify your Faite email",
          html: `<p>Confirm this is your email address: <a href="${link}">verify email</a>.</p>`,
          text: `Verify your email: ${link}`,
        }, isLocal);
      },
    },

    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
      },
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },

    user: {
      deleteUser: {
        enabled: true,
        // A Durable Object has no foreign key to D1 — deleting the D1 user
        // row alone leaves this account's DO storage orphaned: paid for,
        // unreachable, still holding their to-dos (see docs/SYNC.md's
        // "Known traps"). The user row is already gone by the time this
        // runs, so a wipe failure here is logged, not thrown — it must not
        // roll back a deletion that already succeeded from the user's POV.
        afterDelete: async (user) => {
          try {
            await env.USER_DO.get(env.USER_DO.idFromName(user.id)).wipe();
          } catch (error) {
            console.error(`Failed to wipe Durable Object for deleted user ${user.id}`, error);
          }
        },
      },
    },

    // EI-50 P5 (scoped-down) token scaffold. New D1 table, new
    // `/api/auth/api-key/*` endpoints, zero change to any existing path —
    // see auth-tokens.ts's file-level comment for exactly why this is safe
    // to add without cutting anything over.
    plugins: [apiTokenPlugin],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * Every route that calls `auth.api.getSession()` directly (i.e. every
 * `/api/*` handler in `src/server` — none of them go through Better Auth's
 * own HTTP router, see `worker.ts`'s file comment) needs this instead of
 * the raw call. Found live, not in review: `auth-tokens.ts`'s
 * `apiTokenPlugin` (`enableSessionForAPIKeys: true`, D2a) recognizes
 * anything shaped like a bearer-style credential and, if it fails
 * validation, THROWS `APIError` rather than resolving to `null` the way an
 * unmatched cookie does. Better Auth's own router normally catches that and
 * translates it into the right HTTP response — a direct `.api.getSession()`
 * call bypasses that translation entirely, so an ordinary garbage
 * `Authorization: Bearer …` header 500'd every route that called it
 * un-wrapped, `/api/sync/*` included, against a real Durable Object.
 *
 * Only swallows `APIError` — a bad credential is "not authenticated" (the
 * caller returns 401), not a crash. Anything else (a real infra failure)
 * still propagates, same as before this existed.
 */
export async function getSessionSafe(
  auth: Auth,
  request: Request,
): Promise<Awaited<ReturnType<Auth["api"]["getSession"]>>> {
  try {
    return await auth.api.getSession({ headers: request.headers });
  } catch (error) {
    if (error instanceof APIError) return null;
    throw error;
  }
}
