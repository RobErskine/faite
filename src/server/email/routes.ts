import { createAuth } from "../auth";
import { corsHeaders, handleOptions } from "../cors";
import {
  activeAddressFor,
  ensureAddressFor,
  ingestAddress,
  rotateAddressFor,
  type ActiveAddress,
} from "./addresses";

/**
 * `/api/email/address` — reveal and rotate the caller's ingest address
 * (EI-186).
 *
 * Same seam as `/api/sync/*` and `/api/places/*`: not a Next.js Route
 * Handler, because `output: export` (the Capacitor build target) forbids one
 * that reads `Request`. See `docs/ARCHITECTURE.md` §2.12.
 *
 * Scoped entirely to `session.user.id` — there is no path here that takes a
 * user id from the request. Revealing someone else's address would hand over
 * write access to their board.
 */

function json(body: unknown, status: number, headers: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

function present(address: ActiveAddress | null, domain: string) {
  return {
    address: address ? ingestAddress(address.localPart, domain) : null,
    createdAt: address?.createdAt.toISOString() ?? null,
    lastUsedAt: address?.lastUsedAt?.toISOString() ?? null,
  };
}

export async function handleEmailRequest(
  request: Request,
  env: CloudflareEnv,
): Promise<Response> {
  if (request.method === "OPTIONS") return handleOptions(request);

  const headers = corsHeaders(request.headers.get("Origin"));
  const url = new URL(request.url);
  const domain = env.EMAIL_INGEST_DOMAIN;

  const session = await createAuth(env, request).api.getSession({ headers: request.headers });
  if (!session) return json({ error: "unauthenticated" }, 401, headers);
  const userId = session.user.id;

  try {
    if (url.pathname === "/api/email/address") {
      // GET never provisions. Issuing an address as a side effect of reading
      // one would mint a live inbox for every account that ever opened the
      // Settings sheet, including accounts that never wanted the feature.
      if (request.method === "GET") {
        return json(present(await activeAddressFor(env.AUTH_DB, userId), domain), 200, headers);
      }
      // Idempotent: returns the existing address rather than issuing a
      // second one, so a double-click on "Create" cannot leave a user with
      // two live addresses and no way to see the first.
      if (request.method === "POST") {
        return json(present(await ensureAddressFor(env.AUTH_DB, userId), domain), 200, headers);
      }
    }

    if (url.pathname === "/api/email/address/rotate" && request.method === "POST") {
      return json(present(await rotateAddressFor(env.AUTH_DB, userId), domain), 200, headers);
    }

    return json({ error: "not-found" }, 404, headers);
  } catch (error) {
    console.error("[faite] email address route failed", error);
    return json({ error: "internal-error" }, 500, headers);
  }
}
