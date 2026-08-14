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
  // whole generated `CloudflareEnv`. Every new secret has to be added here too,
  // or `npm run auth:schema` stops compiling.
  GOOGLE_PLACES_API_KEY: "",
});
