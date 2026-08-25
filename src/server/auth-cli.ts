import { createAuth } from "./auth";

/**
 * Dev-tooling entry point only — never imported by the worker.
 *
 * `createAuth` is a per-request factory (bindings only exist inside `fetch()`),
 * but `@better-auth/cli generate`/`migrate` need a plain `auth` export to
 * introspect the schema. A D1 binding is a live Cloudflare object with no local
 * stand-in, so this passes a stub: safe because schema generation only reads
 * `betterAuth()`'s config (plugins, fields), it never issues a query.
 *
 * Re-run after changing `auth.ts`'s `emailAndPassword`/`socialProviders`/plugin
 * config: `npx @better-auth/cli generate --config src/server/auth-cli.ts -y`.
 */
export const auth = createAuth({
  AUTH_DB: {} as unknown as CloudflareEnv["AUTH_DB"],
  EMAIL: {} as unknown as CloudflareEnv["EMAIL"],
  ASSETS: {} as unknown as CloudflareEnv["ASSETS"],
  USER_DO: {} as unknown as CloudflareEnv["USER_DO"],
  NEXTJS_ENV: "development",
  BETTER_AUTH_SECRET: "schema-generation-only",
  GITHUB_CLIENT_ID: "",
  GITHUB_CLIENT_SECRET: "",
  GOOGLE_CLIENT_ID: "",
  GOOGLE_CLIENT_SECRET: "",
  // Unused by Better Auth — present only because this literal must satisfy the
  // whole generated `CloudflareEnv`. Every new secret or `vars` entry has to be
  // added here too, or `npm run auth:schema` stops compiling.
  GOOGLE_PLACES_API_KEY: "",
  EMAIL_INGEST_DOMAIN: "in.myfaite.app",
  TURNSTILE_SECRET_KEY: "",
  CONTACT_RATE_LIMITER: {} as unknown as CloudflareEnv["CONTACT_RATE_LIMITER"],
  ATTACHMENTS: {} as unknown as CloudflareEnv["ATTACHMENTS"],
  // Cast rather than the literal wrangler generated from `vars`: repeating
  // the address list here would give it a second home to drift from, and
  // Better Auth never reads it.
  OWNER_EMAILS: "" as unknown as CloudflareEnv["OWNER_EMAILS"],
});
