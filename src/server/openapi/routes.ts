import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { autocompleteRequestSchema, detailsRequestSchema } from "@/server/places/validate";
import { pushRequestSchema } from "@/server/sync/validate";
import { contactRequestSchema } from "@/server/contact/validate";
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
          description: "Origin not on the CORS allow-list.",
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

/** Every hand-documented path, keyed the same way `worker.ts` dispatches. */
export const internalOnlyPaths: ZodOpenApiPathsObject = {
  ...syncPaths,
  ...placesPaths,
  ...desktopPaths,
  ...emailPaths,
  ...contactPaths,
};
