import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { attachmentSchema, todoSchema } from "@/lib/schema";
import { autocompleteRequestSchema, detailsRequestSchema } from "@/server/places/validate";
import { pushRequestSchema } from "@/server/sync/validate";
import { contactRequestSchema } from "@/server/contact/validate";
import { V1_RESOURCES } from "@/server/v1/routes";
import { createTodoRequestSchema, updateTodoRequestSchema } from "@/server/v1/validate";
import { SYNC_KINDS } from "@/lib/sync/wire";

/**
 * Hand-written path table for the routes that are NOT `/todos`-shaped
 * entities — `/api/sync/*`, `/api/places/*`, `/api/desktop/*`, `/api/email/*`,
 * `/api/contact` (A1, EI-226). These don't go through the entity-schema
 * pattern in `spec.ts` because their request/response shapes are wire
 * protocol (sync) or thin proxies (places/contact/desktop/email), not CRUD
 * on a `src/lib/schema.ts` entity.
 *
 * Every request schema below is IMPORTED from the route's own `validate.ts`,
 * never redefined — a second copy is exactly the drift this ticket exists to
 * close. Response shapes have no existing Zod schema (only hand-written TS
 * interfaces in `wire.ts`/`user-do.ts`), so they're defined here, once, next
 * to the paths that use them.
 *
 * Pure module: no Cloudflare bindings, no `Request`/`Response` globals — see
 * `places/validate.ts`'s own comment for why that matters (a route handler
 * needs a live D1 binding to test; a pure parser does not).
 */

const errorSchema = (exampleError: string) =>
  z.object({ error: z.string() }).meta({
    description: `Error envelope. Example: \`{ "error": "${exampleError}" }\`.`,
  });

// ---- /api/sync/* --------------------------------------------------------

const pushResponseSchema = z
  .object({
    acked: z.array(z.string()).describe("Entry ids the DO processed — delete these locally."),
    rejected: z.array(
      z.object({
        id: z.string(),
        reason: z.enum(["malformed-hlc", "unknown-kind", "empty-patch", "patch-too-large"]),
      }),
    ),
    highestVersion: z.number().int().describe("Diagnostic only. Never advance a cursor from this."),
    conflicts: z.array(z.object({ entityId: z.string(), fields: z.array(z.string()) })),
  })
  .meta({ id: "PushResponse" });

const wireChangeSchema = z.object({
  kind: z.enum(SYNC_KINDS),
  entityId: z.string(),
  patch: z.record(z.string(), z.unknown()),
  hlc: z.string(),
});

const pullResponseSchema = z
  .object({
    protocol: z.literal(1),
    changes: z.array(wireChangeSchema),
    cursor: z.number().int(),
    hasMore: z.boolean(),
  })
  .meta({ id: "PullResponse" });

const schemaInfoResponseSchema = z
  .object({
    migrations: z.array(z.object({ id: z.number().int(), name: z.string(), appliedAt: z.string() })),
    tables: z.record(z.string(), z.object({ columns: z.array(z.string()), rows: z.number().int() })),
    nextVersion: z.number().int(),
  })
  .meta({ id: "SchemaInfo" });

const unauthenticated = {
  description: "No session and no valid API key.",
  content: { "application/json": { schema: errorSchema("unauthenticated") } },
};

const insufficientScope = {
  description: 'A valid API key without the required scope (A2, EI-227). A cookie session or a full desktop-handoff key never sees this.',
  content: { "application/json": { schema: errorSchema("insufficient-scope") } },
};

const syncPaths: ZodOpenApiPathsObject = {
  "/api/sync/ws": {
    get: {
      tags: ["sync"],
      summary: "Open the live-push WebSocket (P4).",
      description:
        "Requires the `Upgrade: websocket` header. A server push (e.g. an API " +
        "write) broadcasts to every device connected here.",
      operationId: "syncWebSocket",
      responses: {
        "101": { description: "Switching Protocols — the WebSocket is open." },
        "401": unauthenticated,
        "403": {
          description:
            "Origin not on the CORS allow-list (`forbidden-origin`), OR a " +
            "valid API key without the `sync` scope (`insufficient-scope`, " +
            "A2, EI-227).",
          content: { "application/json": { schema: errorSchema("forbidden-origin") } },
        },
        "426": {
          description: "Request did not carry a WebSocket upgrade.",
          content: { "application/json": { schema: errorSchema("expected-websocket-upgrade") } },
        },
      },
    },
  },
  "/api/sync/push": {
    post: {
      tags: ["sync"],
      summary: "Push local outbox entries — the CRDT write path.",
      description:
        "A write here is a push, not a database write: every entry goes " +
        "through `UserDurableObject.push()`, which allocates a `version` and " +
        "field-level HLC clocks atomically. See docs/API.md and docs/SYNC.md.",
      operationId: "syncPush",
      requestBody: {
        content: { "application/json": { schema: pushRequestSchema } },
      },
      responses: {
        "200": {
          description: "Per-entry ack/reject/conflict result.",
          content: { "application/json": { schema: pushResponseSchema } },
        },
        "400": {
          description: "Malformed request — bad protocol version, too many entries, or a malformed entry.",
          content: { "application/json": { schema: errorSchema("invalid-request") } },
        },
        "401": unauthenticated,
        "403": insufficientScope,
        "500": {
          description: "Unhandled server error.",
          content: { "application/json": { schema: errorSchema("internal-error") } },
        },
      },
    },
  },
  "/api/sync/pull": {
    get: {
      tags: ["sync"],
      summary: "Pull changes since a version cursor.",
      operationId: "syncPull",
      requestParams: {
        query: z.object({
          since: z.coerce.number().int().min(0).optional().describe("Defaults to 0."),
          limit: z.coerce.number().int().positive().optional().describe("Clamped server-side."),
        }),
      },
      responses: {
        "200": {
          description: "Changes above the cursor, newest allocation last.",
          content: { "application/json": { schema: pullResponseSchema } },
        },
        "400": {
          description: "Malformed cursor.",
          content: { "application/json": { schema: errorSchema("invalid-cursor") } },
        },
        "401": unauthenticated,
        "403": insufficientScope,
      },
    },
  },
  "/api/sync/schema": {
    get: {
      tags: ["sync"],
      summary: "Introspect this account's Durable Object schema.",
      operationId: "syncSchema",
      responses: {
        "200": {
          description: "Applied migrations, table shapes, and the next version allocator.",
          content: { "application/json": { schema: schemaInfoResponseSchema } },
        },
        "401": unauthenticated,
        "403": insufficientScope,
      },
    },
  },
  "/api/sync/reset": {
    post: {
      tags: ["sync"],
      summary: "Wipe this account's synced data.",
      description: "Irreversible. Every device must re-pull from cursor 0 afterward.",
      operationId: "syncReset",
      responses: {
        "200": {
          description: "Reset complete.",
          content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
        },
        "401": unauthenticated,
        "403": insufficientScope,
      },
    },
  },
};

// ---- /api/places/* -------------------------------------------------------

const placesNotConfigured = {
  description: "GOOGLE_PLACES_API_KEY is not set in this environment.",
  content: { "application/json": { schema: errorSchema("places-not-configured") } },
};

const upstreamResponses = {
  "429": {
    description: "Google rate-limited this server.",
    content: { "application/json": { schema: errorSchema("rate-limited") } },
  },
  "502": {
    description: "Google Places returned an error or was unreachable.",
    content: { "application/json": { schema: errorSchema("upstream-error") } },
  },
};

const placeSuggestionSchema = z
  .object({ placeId: z.string(), primary: z.string(), secondary: z.string() })
  .meta({ id: "PlaceSuggestion" });

const resolvedPlaceSchema = z
  .object({
    placeId: z.string(),
    address: z.string(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
  })
  .meta({ id: "ResolvedPlace" });

const placesPaths: ZodOpenApiPathsObject = {
  "/api/places/autocomplete": {
    post: {
      tags: ["places"],
      summary: "Typeahead search, proxied to Google Places (EI-83).",
      operationId: "placesAutocomplete",
      requestBody: {
        content: { "application/json": { schema: autocompleteRequestSchema } },
      },
      responses: {
        "200": {
          description: "Suggestions ranked by Google.",
          content: {
            "application/json": {
              schema: z.object({ suggestions: z.array(placeSuggestionSchema) }),
            },
          },
        },
        "400": {
          description: "Malformed input or session token.",
          content: { "application/json": { schema: errorSchema("invalid-request") } },
        },
        "401": unauthenticated,
        "403": insufficientScope,
        "501": placesNotConfigured,
        ...upstreamResponses,
      },
    },
  },
  "/api/places/details": {
    post: {
      tags: ["places"],
      summary: "Resolve a place id to an address and coordinates.",
      operationId: "placesDetails",
      requestBody: {
        content: { "application/json": { schema: detailsRequestSchema } },
      },
      responses: {
        "200": {
          description: "The resolved place.",
          content: { "application/json": { schema: resolvedPlaceSchema } },
        },
        "400": {
          description: "Malformed input or session token.",
          content: { "application/json": { schema: errorSchema("invalid-request") } },
        },
        "401": unauthenticated,
        "403": insufficientScope,
        "501": placesNotConfigured,
        ...upstreamResponses,
      },
    },
  },
};

// ---- /api/desktop/* -------------------------------------------------------

const desktopPaths: ZodOpenApiPathsObject = {
  "/api/desktop/handoff": {
    post: {
      tags: ["desktop"],
      summary: "Mint a short-lived handoff code for the desktop shell (D2a).",
      description:
        "Called from the system browser with a live cookie session. Mints a " +
        "real, full-session-equivalent API key and returns an encrypted code " +
        "— never the key itself.",
      operationId: "desktopHandoff",
      responses: {
        "200": {
          description: "The handoff code, to be embedded in the `faite://auth-callback` redirect.",
          content: { "application/json": { schema: z.object({ code: z.string() }) } },
        },
        "401": unauthenticated,
      },
    },
  },
  "/api/desktop/exchange": {
    post: {
      tags: ["desktop"],
      summary: "Trade a handoff code for the real API key.",
      description: "Called from the desktop app after receiving the deep link.",
      operationId: "desktopExchange",
      security: [],
      requestBody: {
        content: { "application/json": { schema: z.object({ code: z.string().min(1) }) } },
      },
      responses: {
        "200": {
          description: "The API key. The only place it crosses the wire a second time.",
          content: { "application/json": { schema: z.object({ token: z.string() }) } },
        },
        "400": {
          description: "Missing code.",
          content: { "application/json": { schema: errorSchema("invalid-request") } },
        },
        "401": {
          description: "Code is unknown, expired, or already used.",
          content: { "application/json": { schema: errorSchema("invalid-or-expired-code") } },
        },
      },
    },
  },
};

// ---- /api/email/* -------------------------------------------------------

const emailAddressResponseSchema = z
  .object({
    address: z.string().nullable(),
    createdAt: z.string().nullable(),
    lastUsedAt: z.string().nullable(),
  })
  .meta({ id: "EmailIngestAddress" });

const emailPaths: ZodOpenApiPathsObject = {
  "/api/email/address": {
    get: {
      tags: ["email"],
      summary: "Reveal the caller's email-ingest address, if one exists (EI-186).",
      description: "Never provisions one as a side effect of reading.",
      operationId: "getEmailAddress",
      responses: {
        "200": {
          description: "The address, or nulls if none has been created yet.",
          content: { "application/json": { schema: emailAddressResponseSchema } },
        },
        "401": unauthenticated,
      },
    },
    post: {
      tags: ["email"],
      summary: "Provision the caller's email-ingest address. Idempotent.",
      operationId: "createEmailAddress",
      responses: {
        "200": {
          description: "The (possibly pre-existing) address.",
          content: { "application/json": { schema: emailAddressResponseSchema } },
        },
        "401": unauthenticated,
      },
    },
  },
  "/api/email/address/rotate": {
    post: {
      tags: ["email"],
      summary: "Retire the old address and issue a new one.",
      operationId: "rotateEmailAddress",
      responses: {
        "200": {
          description: "The new address.",
          content: { "application/json": { schema: emailAddressResponseSchema } },
        },
        "401": unauthenticated,
      },
    },
  },
};

// ---- /api/contact --------------------------------------------------------

const contactPaths: ZodOpenApiPathsObject = {
  "/api/contact": {
    post: {
      tags: ["contact"],
      summary: "Submit the public contact form (EI-206).",
      description: "No session required. Turnstile-gated and rate-limited by IP.",
      operationId: "submitContact",
      security: [],
      requestBody: {
        content: { "application/json": { schema: contactRequestSchema } },
      },
      responses: {
        "200": {
          description: "Delivered. Never echoes the submission back.",
          content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } },
        },
        "400": {
          description: "Malformed submission.",
          content: { "application/json": { schema: errorSchema("invalid-request") } },
        },
        "403": {
          description: "Turnstile verification failed.",
          content: { "application/json": { schema: errorSchema("turnstile-failed") } },
        },
        "429": {
          description: "Rate limit exceeded for this IP.",
          content: { "application/json": { schema: errorSchema("rate-limited") } },
        },
        "501": {
          description: "TURNSTILE_SECRET_KEY is not set in this environment.",
          content: { "application/json": { schema: errorSchema("contact-not-configured") } },
        },
        "500": {
          description: "Unhandled server error.",
          content: { "application/json": { schema: errorSchema("internal-error") } },
        },
      },
    },
  },
};

// ---- /api/attachments/* (EI-242) -----------------------------------------

/**
 * The bytes half of attachments. Internal-only and NOT in `openapi/v1.json`:
 * it is session-authenticated (no bearer path), and it is the one route in
 * the app whose request and response bodies are binary rather than JSON.
 *
 * The metadata half is an ordinary `/api/v1` resource — see `v1Paths`.
 */
const attachmentPaths: ZodOpenApiPathsObject = {
  "/api/attachments": {
    post: {
      tags: ["attachments"],
      summary: "Upload a file's bytes and get back the row to write (EI-242).",
      description:
        "Raw body, not multipart. `Content-Type` describes the bytes and is " +
        "verified against them; `X-Filename` carries the percent-encoded " +
        "original name. Does NOT write the attachment row — the client does " +
        "that through the outbox, so bytes always land before the row that " +
        "references them. Cookie session only. See docs/ATTACHMENTS.md.",
      operationId: "uploadAttachment",
      requestBody: {
        content: {
          "application/octet-stream": {
            schema: z.string().meta({ format: "binary", description: "The file's bytes." }),
          },
        },
      },
      responses: {
        "201": {
          description: "Stored. Write an `attachment` row from this body.",
          content: { "application/json": { schema: attachmentSchema } },
        },
        "400": {
          description: "Empty file, or a missing todoId/id/filename.",
          content: { "application/json": { schema: errorSchema("missing-todo-id") } },
        },
        "401": {
          description: "No session.",
          content: { "application/json": { schema: errorSchema("unauthenticated") } },
        },
        "413": {
          description: "Over the per-file or per-account cap.",
          content: { "application/json": { schema: errorSchema("too-large") } },
        },
        "415": {
          description: "Type not allow-listed, or the bytes are not that type.",
          content: { "application/json": { schema: errorSchema("unsupported-type") } },
        },
        "500": {
          description: "Unhandled server error.",
          content: { "application/json": { schema: errorSchema("internal-error") } },
        },
      },
    },
  },
  "/api/attachments/{id}": {
    get: {
      tags: ["attachments"],
      summary: "Download one attachment's bytes.",
      description:
        "Always `Content-Disposition: attachment` with `X-Content-Type-Options: " +
        "nosniff` — an uploaded file is never rendered inline on this origin. " +
        "404s for another account's id, matching the not-found case exactly.",
      operationId: "downloadAttachment",
      requestParams: { path: z.object({ id: z.string() }) },
      responses: {
        "200": {
          description: "The file.",
          content: {
            "application/octet-stream": { schema: z.string().meta({ format: "binary" }) },
          },
        },
        "401": {
          description: "No session.",
          content: { "application/json": { schema: errorSchema("unauthenticated") } },
        },
        "404": {
          description: "No such attachment for this account, or its bytes are gone.",
          content: { "application/json": { schema: errorSchema("not-found") } },
        },
      },
    },
    delete: {
      tags: ["attachments"],
      summary: "Delete one attachment's bytes.",
      description:
        "Idempotent, and deliberately partial: this removes the OBJECT only. " +
        "The row is tombstoned separately by the client, because that is the " +
        "half that syncs. Tombstone first, then call this.",
      operationId: "deleteAttachment",
      requestParams: { path: z.object({ id: z.string() }) },
      responses: {
        "204": { description: "Gone, or never there." },
        "401": {
          description: "No session.",
          content: { "application/json": { schema: errorSchema("unauthenticated") } },
        },
      },
    },
  },
};

// ---- /api/v1/* (A2, EI-227) ----------------------------------------------

/**
 * Built FROM `v1/routes.ts`'s own `V1_RESOURCES` — the same map the route
 * dispatch switches on — rather than a second hand-typed list of the four
 * resource names. A fifth kind added there without a doc entry here is
 * exactly the drift EI-226 exists to close.
 */
export const v1Paths: ZodOpenApiPathsObject = Object.fromEntries(
  Object.entries(V1_RESOURCES).map(([path, { kind, schema }]) => [
    `/api/v1/${path}`,
    {
      get: {
        tags: ["v1"],
        summary: `List the caller's ${path}.`,
        description:
          "Requires the `read` scope — every cookie session and every API " +
          "key has it by default. Soft-deleted rows are never included.",
        operationId: `listV1${kind[0].toUpperCase()}${kind.slice(1)}s`,
        responses: {
          "200": {
            // Not every resource has a `position` — attachments sort by
            // creation time (`ORDER_BY_KIND` in `user-do.ts`), so the blanket
            // "board order" would have been a documented untruth.
            description:
              path === "attachments"
                ? "attachments, oldest first."
                : `${path}, in board order.`,
            content: { "application/json": { schema: z.array(schema) } },
          },
          "401": unauthenticated,
          "403": insufficientScope,
          "500": {
            description: "Unhandled server error.",
            content: { "application/json": { schema: errorSchema("internal-error") } },
          },
        },
      },
      // Only `todos` writes exist yet (A5, EI-230) — `lists`/`labels`/`tabs`
      // stay read-only until a future ticket extends this the same way.
      ...(kind === "todo"
        ? {
            post: {
              tags: ["v1"],
              summary: "Create a todo.",
              description:
                "Requires the `write` scope — a cookie session and a " +
                "desktop-handoff key have it; a narrow user-generated key " +
                "(A3) does not by default. A write here is a push, not a " +
                "database write — see docs/API.md.",
              operationId: "createV1Todo",
              requestBody: {
                content: { "application/json": { schema: createTodoRequestSchema } },
              },
              responses: {
                "201": {
                  description: "The created todo.",
                  content: { "application/json": { schema } },
                },
                "400": {
                  description: "Malformed request — missing title, or a field fails validation.",
                  content: { "application/json": { schema: errorSchema("invalid-request") } },
                },
                "401": unauthenticated,
                "403": insufficientScope,
                "500": {
                  description: "Unhandled server error.",
                  content: { "application/json": { schema: errorSchema("internal-error") } },
                },
              },
            },
          }
        : {}),
    },
  ]),
);

export const patchTodoPath: ZodOpenApiPathsObject = {
  "/api/v1/todos/{id}": {
    patch: {
      tags: ["v1"],
      summary: "Patch an existing todo.",
      description:
        "Requires the `write` scope. Only the fields present in the request " +
        "body are touched — every other field on the todo is left exactly " +
        "as it was. A write here is a push, not a database write; see " +
        "docs/API.md.",
      operationId: "updateV1Todo",
      requestParams: {
        path: z.object({ id: z.string().min(1) }),
      },
      requestBody: {
        content: { "application/json": { schema: updateTodoRequestSchema } },
      },
      responses: {
        "200": {
          description: "The updated todo.",
          content: { "application/json": { schema: todoSchema } },
        },
        "400": {
          description: "Malformed request, or an empty patch.",
          content: { "application/json": { schema: errorSchema("invalid-request") } },
        },
        "401": unauthenticated,
        "403": insufficientScope,
        "404": {
          description: "No such todo, or it belongs to a different account, or it's deleted.",
          content: { "application/json": { schema: errorSchema("not-found") } },
        },
        "500": {
          description: "Unhandled server error.",
          content: { "application/json": { schema: errorSchema("internal-error") } },
        },
      },
    },
  },
};

/** Every hand-documented path, keyed the same way `worker.ts` dispatches. */
export const internalOnlyPaths: ZodOpenApiPathsObject = {
  ...syncPaths,
  ...placesPaths,
  ...desktopPaths,
  ...emailPaths,
  ...contactPaths,
  ...attachmentPaths,
  ...v1Paths,
  ...patchTodoPath,
};
