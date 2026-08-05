/**
 * Custom worker entry.
 *
 * The default OpenNext build output cannot export a Durable Object class, so we
 * wrap it: delegate all HTTP handling to the OpenNext handler, and re-export the
 * DO class alongside it so the `USER_DO` binding in wrangler.jsonc can resolve.
 *
 * It also intercepts `/api/auth/*` for Better Auth (P2). That could not be a
 * Next.js Route Handler: `output: export` (the Capacitor build target, kept
 * green by CI) forbids Route Handlers that read `Request`, so the entire auth
 * backend lives here instead. Same reason `createAuth(env)` is a factory
 * called fresh per request rather than a module-level singleton — the D1 and
 * Email bindings only exist inside `fetch()`. See docs/ARCHITECTURE.md §2.12.
 *
 * Set as `main` in wrangler.jsonc via the build script (see package.json).
 */
import openNextHandler from "open-next/worker";
import { createAuth } from "./auth";

export { UserDurableObject } from "./user-do";

export default {
  fetch(request, env, ctx) {
    if (new URL(request.url).pathname.startsWith("/api/auth")) {
      return createAuth(env).handler(request);
    }
    // OpenNext always exports a fetch handler; the optional type is generic
    // ExportedHandler boilerplate, not a real possibility here.
    return openNextHandler.fetch!(request, env, ctx);
  },
} satisfies ExportedHandler<CloudflareEnv>;
