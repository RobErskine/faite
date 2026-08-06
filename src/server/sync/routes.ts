import { createAuth, TRUSTED_ORIGINS } from "../auth";
import { clampPullArgs, parsePushRequest } from "./validate";
import { isAllowedWsOrigin, isWebSocketUpgrade, USER_ID_HEADER } from "./ws-server";

/**
 * `/api/sync/*` — the transport for EI-46/EI-48. Same seam as `/api/auth/*`
 * in `worker.ts`: not a Next.js Route Handler (`output: export` forbids one
 * that reads `Request`), so it lives here and is intercepted before the
 * OpenNext fallthrough.
 *
 * No session is a normal, permanent state for this app (§2.13) — but that's
 * true of the BOARD, which never calls this. A request that reaches this
 * file without a session is unauthenticated, full stop: 401, never a nag.
 */

function corsHeaders(origin: string | null): HeadersInit {
  if (!origin || !TRUSTED_ORIGINS.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, headers: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

function handleOptions(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(request.headers.get("Origin")),
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function handleSyncRequest(request: Request, env: CloudflareEnv): Promise<Response> {
  if (request.method === "OPTIONS") return handleOptions(request);

  const headers = corsHeaders(request.headers.get("Origin"));
  const url = new URL(request.url);

  const session = await createAuth(env, request).api.getSession({ headers: request.headers });
  if (!session) return json({ error: "unauthenticated" }, 401, headers);
  const userId = session.user.id;

  try {
    const stub = env.USER_DO.get(env.USER_DO.idFromName(userId));

    // Before push/pull: an upgrade is still an ordinary HTTP request until
    // the 101, so it has already passed the same session check above.
    if (url.pathname === "/api/sync/ws") {
      if (!isWebSocketUpgrade(request.headers.get("Upgrade"))) {
        return json({ error: "expected-websocket-upgrade" }, 426, headers);
      }
      // A WebSocket handshake bypasses CORS entirely — this check, not
      // `corsHeaders`, is what keeps evil.com off a logged-in board. See
      // `ws-server.ts`.
      if (!isAllowedWsOrigin(request.headers.get("Origin"), request.url)) {
        return json({ error: "forbidden-origin" }, 403, headers);
      }
      const doHeaders = new Headers(request.headers);
      doHeaders.set(USER_ID_HEADER, userId);
      // The 101 is returned VERBATIM, and is the one branch here that skips
      // `corsHeaders`: a Response carrying a `webSocket` cannot be rebuilt
      // (constructing a new Response drops the socket), and a handshake has
      // no use for CORS headers anyway. Do not "normalise" this to match the
      // branches below.
      return await stub.fetch(new Request(request, { headers: doHeaders }));
    }

    if (url.pathname === "/api/sync/push" && request.method === "POST") {
      // `parsePushRequest`/`clampPullArgs` are shared with the WebSocket
      // handler in `user-do.ts` — one implementation, not two that mirror
      // each other. See `validate.ts`.
      const parsed = parsePushRequest(await request.json());
      if (!parsed) return json({ error: "invalid-request" }, 400, headers);
      const result = await stub.push(userId, parsed);
      return json(result, 200, headers);
    }

    if (url.pathname === "/api/sync/pull" && request.method === "GET") {
      const args = clampPullArgs(
        url.searchParams.get("since") ?? undefined,
        url.searchParams.get("limit") ?? undefined,
      );
      if (!args) return json({ error: "invalid-cursor" }, 400, headers);
      const result = await stub.pull(args.cursor, args.limit);
      return json(result, 200, headers);
    }

    return json({ error: "not-found" }, 404, headers);
  } catch (error) {
    // A thrown error inside a DO RPC call surfaces as a thrown error here —
    // map it to a 500 rather than letting it escape into the OpenNext
    // fallthrough this branch preempts.
    console.error("sync route error", error);
    return json({ error: "internal-error" }, 500, headers);
  }
}
