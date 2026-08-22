/**
 * Custom worker entry.
 *
 * The default OpenNext build output cannot export a Durable Object class, so we
 * wrap it: delegate all HTTP handling to the OpenNext handler, and re-export the
 * DO class alongside it so the `USER_DO` binding in wrangler.jsonc can resolve.
 *
 * `email()` sits beside `fetch()` for the same structural reason (EI-186):
 * an inbound Email Routing message is delivered to a handler export on the
 * Worker entry, and this file is the Worker entry. No new Worker, no new
 * deploy target, no `wrangler.jsonc` change for receiving — Email Routing
 * rules are zone configuration.
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
import { handleContactRequest } from "./contact/routes";
import { handleOptions, withCors } from "./cors";
import { handleDesktopRequest } from "./desktop/routes";
import { handleEmail } from "./email/ingest";
import { handleEmailRequest } from "./email/routes";
import { handlePlacesRequest } from "./places/routes";
import { handleSyncRequest } from "./sync/routes";
import { handleV1Request } from "./v1/routes";

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
    if (pathname.startsWith("/api/desktop")) {
      // D2a's login handoff — deliberately its own prefix, not under
      // `/api/auth`, since that prefix goes straight to Better Auth's own
      // handler above and these two routes are ours. See ./desktop/routes.ts.
      return handleDesktopRequest(request, env);
    }
    if (pathname.startsWith("/api/sync")) {
      // Same reasoning as /api/auth above: EI-46's push/pull routes read
      // `Request`, so they can't be a Next.js Route Handler either.
      return handleSyncRequest(request, env);
    }
    if (pathname.startsWith("/api/email")) {
      // Same seam again (EI-186): reveal/rotate the caller's own secret
      // ingest address. See ./email/routes.ts.
      return handleEmailRequest(request, env);
    }
    if (pathname.startsWith("/api/places")) {
      // Same reasoning again (EI-83), plus one of its own: this is the only
      // place `GOOGLE_PLACES_API_KEY` can live. It is a Worker secret, and
      // the whole point of proxying Google rather than calling it from the
      // browser is that the key never reaches client JS. See ./places/routes.ts.
      return handlePlacesRequest(request, env);
    }
    if (pathname.startsWith("/api/contact")) {
      // Same reasoning again (EI-206): TURNSTILE_SECRET_KEY is a Worker
      // secret and must never reach client JS. See ./contact/routes.ts.
      return handleContactRequest(request, env);
    }
    if (pathname.startsWith("/api/v1")) {
      // The public, versioned read API (A2, EI-227). Same reasoning again —
      // see ./v1/routes.ts.
      return handleV1Request(request, env);
    }
    // OpenNext always exports a fetch handler; the optional type is generic
    // ExportedHandler boilerplate, not a real possibility here.
    return openNextHandler.fetch!(request, env, ctx);
  },

  /**
   * Inbound mail for `in.myfaite.app` (EI-186). Everything is in
   * `./email/ingest.ts`; this stays a one-liner so the entry file keeps
   * reading as a routing table.
   *
   * `handleEmail` never throws — an uncaught exception here would be
   * captured verbatim by Workers Logs, and a MIME parser's error message
   * quotes the bytes it choked on. See the privacy invariants in
   * `docs/EMAIL-INGEST.md`.
   */
  email(message, env) {
    return handleEmail(message, env);
  },
} satisfies ExportedHandler<CloudflareEnv>;
