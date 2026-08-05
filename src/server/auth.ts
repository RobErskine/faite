import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./auth-schema";
import { sendEmail } from "./email";

/**
 * Gates password sign-in on a clicked verification link. GitHub and Google
 * already hand over a verified address, so this affects email/password only.
 *
 * Flip to `true` once `myfaite.app` DNS is on Cloudflare and
 * `wrangler email sending enable myfaite.app` has run (see D3b/D3d in the P2
 * plan). Turning it on before mail can actually be delivered would lock every
 * signup — including ours — out of their own account.
 */
const REQUIRE_EMAIL_VERIFICATION = false;

const TRUSTED_ORIGINS = [
  "https://myfaite.app",
  "http://localhost:3000",
  "http://localhost:8787",
  // Capacitor's WebView origin (P7, EI-51). Free to declare now, not a code
  // change later.
  "capacitor://localhost",
];

/**
 * Better Auth must be constructed per request: the D1 and Email bindings only
 * exist inside `fetch()`, so a module-level singleton fails at runtime (see
 * EI-45 and ARCHITECTURE §7). Call this fresh in the worker's fetch handler.
 */
export function createAuth(env: CloudflareEnv) {
  const baseURL =
    env.NEXTJS_ENV === "development"
      ? "http://localhost:8787"
      : "https://myfaite.app";

  return betterAuth({
    baseURL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: TRUSTED_ORIGINS,

    database: drizzleAdapter(drizzle(env.AUTH_DB), {
      provider: "sqlite",
      schema,
    }),

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: REQUIRE_EMAIL_VERIFICATION,
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(env, {
          to: user.email,
          subject: "Reset your Faite password",
          html: `<p>Someone requested a password reset for this account. If it was you, <a href="${url}">reset your password</a>. This link expires in 1 hour.</p><p>If it wasn't you, ignore this email.</p>`,
          text: `Reset your password: ${url}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
        });
      },
      // Avoids confirming to an attacker (or a fat-fingering user) whether an
      // email is already registered.
      onExistingUserSignUp: async ({ user }) => {
        await sendEmail(env, {
          to: user.email,
          subject: "Sign-up attempt on your Faite account",
          html: `<p>Someone tried to create a Faite account with this email, which already has one. If that was you, <a href="${baseURL}/forgot-password">reset your password</a> instead.</p>`,
          text: `Someone tried to create a Faite account with this email, which already has one. If that was you, reset your password: ${baseURL}/forgot-password`,
        });
      },
    },

    emailVerification: {
      sendVerificationEmail: async ({ user, token }) => {
        // A link to our own /verify-email page (which calls the API and shows
        // a result) rather than better-auth's generated `url` — that points
        // straight at the API endpoint, which would hand the browser raw JSON
        // instead of a page.
        const link = `${baseURL}/verify-email?token=${encodeURIComponent(token)}`;
        await sendEmail(env, {
          to: user.email,
          subject: "Verify your Faite email",
          html: `<p>Confirm this is your email address: <a href="${link}">verify email</a>.</p>`,
          text: `Verify your email: ${link}`,
        });
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
  });
}

export type Auth = ReturnType<typeof createAuth>;
