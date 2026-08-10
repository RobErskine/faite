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
import { handleOptions, withCors } from "./cors";
import { handleSyncRequest } from "./sync/routes";

export { UserDurableObject } from "./user-do";

export default {
  fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;

    if (pathname.startsWith("/api/auth")) {
      // CORS is applied HERE rather than inside Better Auth because Better Auth
      // does not do it: `trustedOrigins` gates CSRF and redirect targets, not
      // response headers. `next dev` (:3000 → the worker's :8787) and Capacitor
      // at P7 are both genuinely cross-origin, so without this the preflight
      // 404s and sign-in fails as an opaque "Failed to fetch". See ./cors.ts.
      if (request.method === "OPTIONS") return handleOptions(request);
      const origin = request.headers.get("Origin");
      // `request` is passed so Better Auth derives its baseURL from the origin
      // this actually arrived on — production, a branch preview, or localhost.
      // See createAuth's doc comment for why hardcoding it breaks previews.
      return createAuth(env, request)
        .handler(request)
        .then((response) => withCors(response, origin));
    }
    if (pathname.startsWith("/api/sync")) {
      // Same reasoning as /api/auth above: EI-46's push/pull routes read
      // `Request`, so they can't be a Next.js Route Handler either.
      return handleSyncRequest(request, env);
    }
    // OpenNext always exports a fetch handler; the optional type is generic
    // ExportedHandler boilerplate, not a real possibility here.
    return openNextHandler.fetch!(request, env, ctx);
  },
} satisfies ExportedHandler<CloudflareEnv>;
