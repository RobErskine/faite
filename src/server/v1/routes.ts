import { labelSchema, listSchema, tabSchema, todoSchema } from "@/lib/schema";
import { createAuth } from "../auth";
import { authorizeScope } from "../auth-scopes";
import { corsHeaders, handleOptions } from "../cors";
import type { UserDurableObject } from "../user-do";

/**
 * `/api/v1/*` — the public, versioned read API (A2, EI-227). Same seam as
 * `/api/sync/*`/`/api/places/*`: not a Next.js Route Handler, because
 * `output: export` forbids one that reads `Request`. See
 * `docs/ARCHITECTURE.md` §2.12.
 *
 * Every route requires the `read` scope (`authorizeScope`, `auth-scopes.ts`)
 * — a cookie session always has it; a narrow user-generated key (A3) gets it
 * by default (`auth-tokens.ts`'s `defaultPermissions`); a desktop key has it
 * too, incidentally, as part of full equivalence.
 *
 * Each response is the entity's OWN Zod schema (`src/lib/schema.ts`) run over
 * the Durable Object's raw row — not a hand-picked field list. That is what
 * strips `version` (a DO-only SQLite column the schema never declared) and
 * keeps `hlc`/hlc-adjacent wire metadata from ever reaching a response: they
 * simply aren't fields these schemas have. See `docs/API.md`'s "a documented
 * API probably wants an opaque `updatedAt` and nothing else."
 */

const KIND_BY_PATH = {
  todos: { kind: "todo", schema: todoSchema },
  lists: { kind: "list", schema: listSchema },
  labels: { kind: "label", schema: labelSchema },
  tabs: { kind: "tab", schema: tabSchema },
} as const;

type V1Kind = (typeof KIND_BY_PATH)[keyof typeof KIND_BY_PATH]["kind"];

function json(body: unknown, status: number, headers: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

/**
 * A `switch`, not `stub.listEntities(resource.kind)` with `kind` typed as the
 * union of all four — Cloudflare's generated `DurableObjectStub` RPC-proxy
 * type does not propagate a union-typed argument through cleanly (it
 * resolves the call to `never`, silently, rather than erroring on the call
 * itself). Each branch here passes a single string LITERAL, which the stub
 * type has no trouble with.
 */
function listEntities(
  stub: DurableObjectStub<UserDurableObject>,
  kind: V1Kind,
): ReturnType<UserDurableObject["listEntities"]> {
  switch (kind) {
    case "todo":
      return stub.listEntities("todo");
    case "list":
      return stub.listEntities("list");
    case "label":
      return stub.listEntities("label");
    case "tab":
      return stub.listEntities("tab");
  }
}

export async function handleV1Request(request: Request, env: CloudflareEnv): Promise<Response> {
  if (request.method === "OPTIONS") return handleOptions(request);

  const headers = corsHeaders(request.headers.get("Origin"));
  const url = new URL(request.url);

  const auth = await authorizeScope(createAuth(env, request), request, "read");
  if (!auth.ok) return json({ error: auth.error }, auth.status, headers);

  try {
    const segment = url.pathname.slice("/api/v1/".length) as keyof typeof KIND_BY_PATH;
    const resource = KIND_BY_PATH[segment];

    if (resource && request.method === "GET") {
      const stub = env.USER_DO.get(env.USER_DO.idFromName(auth.userId));
      const rows = await listEntities(stub, resource.kind);
      return json(
        rows.map((row) => resource.schema.parse(row)),
        200,
        headers,
      );
    }

    return json({ error: "not-found" }, 404, headers);
  } catch (error) {
    console.error("v1 route error", error);
    return json({ error: "internal-error" }, 500, headers);
  }
}

/** Exported for `openapi/routes.ts` — one source of the four resource names
 * and their response schemas, so the docs can't drift from the dispatch. */
export const V1_RESOURCES = KIND_BY_PATH;
