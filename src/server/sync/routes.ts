import { z } from "zod";
import { DEFAULT_PULL_LIMIT, MAX_PULL_LIMIT, MAX_PUSH_ENTRIES, SYNC_KINDS, SYNC_PROTOCOL_VERSION } from "@/lib/sync/wire";
import { createAuth, TRUSTED_ORIGINS } from "../auth";

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

const pushEntrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(SYNC_KINDS),
  entityId: z.string().min(1),
  patch: z.record(z.string(), z.unknown()),
  hlc: z.string().min(1),
});

const pushRequestSchema = z.object({
  protocol: z.literal(SYNC_PROTOCOL_VERSION),
  entries: z.array(pushEntrySchema).max(MAX_PUSH_ENTRIES),
});

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

    if (url.pathname === "/api/sync/push" && request.method === "POST") {
      const parsed = pushRequestSchema.safeParse(await request.json());
      if (!parsed.success) return json({ error: "invalid-request" }, 400, headers);
      const result = await stub.push(userId, parsed.data);
      return json(result, 200, headers);
    }

    if (url.pathname === "/api/sync/pull" && request.method === "GET") {
      const cursor = Number(url.searchParams.get("since") ?? "0");
      if (!Number.isFinite(cursor) || cursor < 0) {
        return json({ error: "invalid-cursor" }, 400, headers);
      }
      const requestedLimit = Number(url.searchParams.get("limit") ?? String(DEFAULT_PULL_LIMIT));
      const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, MAX_PULL_LIMIT)
        : DEFAULT_PULL_LIMIT;
      const result = await stub.pull(cursor, limit);
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
