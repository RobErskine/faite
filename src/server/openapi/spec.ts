import { createDocument } from "zod-openapi";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import {
  dayNoteSchema,
  labelSchema,
  listSchema,
  placeSchema,
  projectSchema,
  reminderPresetSchema,
  settingsSchema,
  tabSchema,
  todoSchema,
} from "@/lib/schema";
import { internalOnlyPaths } from "./routes";

/**
 * The two-document OpenAPI builder (A1, EI-226) — a pure module with no
 * Cloudflare bindings, so it's unit-testable the same way
 * `src/server/places/validate.ts` is. `scripts/openapi/generate.ts` is the
 * only impure caller: it fetches Better Auth's own generated schema (which
 * DOES need a live `betterAuth()` instance, stub-bound the same way
 * `auth-cli.ts` already does for `@better-auth/cli`) and passes it in here.
 *
 * `openapi/openapi.json` (internal) documents everything this Worker
 * actually serves. `openapi/v1.json` (public) is the one A7 (EI-231)
 * publishes — `/api/v1` only, empty until A2 lands real routes there. Both
 * come from this one module so the entity schemas can never drift between
 * them.
 */

// `.meta({ id })` registers each schema in Zod's global registry under that
// name, which is what lets `zod-openapi` emit `$ref: "#/components/schemas/Todo"`
// instead of inlining the same shape at every use site. Mutates the schema
// objects imported above IN PLACE (Zod's registry is keyed by object
// identity) — safe because nothing else in the app ever reads
// `z.globalRegistry`; this module is the only consumer.
todoSchema.meta({ id: "Todo", description: "A to-do item." });
listSchema.meta({ id: "List", description: "A planning-half column." });
labelSchema.meta({ id: "Label", description: "A multi-assign tag." });
projectSchema.meta({ id: "Project", description: "A cross-cutting bucket of todos." });
tabSchema.meta({ id: "Tab", description: "A group of planning-half columns." });
dayNoteSchema.meta({ id: "DayNote", description: "A calendar day's journal entry." });
placeSchema.meta({ id: "Place", description: "A saved, named address." });
reminderPresetSchema.meta({ id: "ReminderPreset", description: "A named reminder time." });
settingsSchema.meta({ id: "Settings", description: "Per-user settings." });

// Illustrative shape only — NOT wired to any path yet. Kept registered so A2
// (EI-227) can reference it the moment `/api/v1/todos` reads land, per
// docs/API.md's note that a real write is a push, not a database write; see
// `src/lib/service/todos.ts`'s `CreateTodoInput`, which this mirrors by hand
// for the same reason that module can't import the other's types.
const createTodoInputSchema = todoSchema
  .pick({
    title: true,
    description: true,
    priority: true,
    scheduledDate: true,
    deadline: true,
    listId: true,
    projectId: true,
    labelIds: true,
    location: true,
    placeId: true,
    reminderTime: true,
  })
  .partial({
    description: true,
    priority: true,
    scheduledDate: true,
    deadline: true,
    listId: true,
    projectId: true,
    labelIds: true,
    location: true,
    placeId: true,
    reminderTime: true,
  })
  .meta({ id: "CreateTodoInput", description: "Fields accepted when creating a todo." });

const entitySchemas = {
  Todo: todoSchema,
  List: listSchema,
  Label: labelSchema,
  Project: projectSchema,
  Tab: tabSchema,
  DayNote: dayNoteSchema,
  Place: placeSchema,
  ReminderPreset: reminderPresetSchema,
  Settings: settingsSchema,
  CreateTodoInput: createTodoInputSchema,
};

/**
 * The shape of what `auth.api.generateOpenAPISchema()` (Better Auth's
 * `openAPI()` plugin) returns — a plain, already-built OpenAPI 3.1 document,
 * NOT Zod schemas, so it merges by object spread rather than through
 * `zod-openapi`. Its `paths` are relative to Better Auth's own mount point
 * (e.g. `/sign-in/email`), which `worker.ts` serves at `/api/auth/*`.
 */
export interface BetterAuthOpenApiDocument {
  paths: Record<string, unknown>;
  components?: {
    schemas?: Record<string, unknown>;
    securitySchemes?: Record<string, unknown>;
  };
}

function prefixAuthPaths(paths: Record<string, unknown>): ZodOpenApiPathsObject {
  const prefixed: Record<string, unknown> = {};
  for (const [path, item] of Object.entries(paths)) {
    prefixed[`/api/auth${path}`] = item;
  }
  // Better Auth's generated path items are plain OpenAPI JSON (schemas
  // included), not Zod schemas — `ZodOpenApiPathItemObject`'s content fields
  // accept a plain `SchemaObject` alongside a Zod one, so this is a type
  // adaptation at the one seam where untyped external JSON enters a typed
  // builder, not an unsafe cast over mismatched shapes.
  return prefixed as ZodOpenApiPathsObject;
}

/**
 * Builds the internal document. `authDoc` is optional: per EI-226's "watch
 * out", Better Auth's OpenAPI plugin has shipped invalid output for some
 * plugin combinations upstream — if the caller's own validation rejects it,
 * it should pass `undefined` here and fall back to zero auth documentation
 * rather than ship a broken spec. As of this writing (`better-auth@1.6.29`),
 * the merged output validates clean; see `spec.test.ts`.
 */
export function buildInternalDocument(authDoc?: BetterAuthOpenApiDocument) {
  const authPaths = authDoc ? prefixAuthPaths(authDoc.paths) : {};
  const authSchemas = authDoc?.components?.schemas ?? {};
  const authSecuritySchemes = authDoc?.components?.securitySchemes ?? {};

  // A same-named-but-different-shaped schema would silently corrupt the
  // merged doc (whichever spread lands last wins, with no error) rather than
  // fail loudly. Better Auth's names (User, Session, Account, Verification,
  // Apikey) don't collide with ours today; catch it early if that ever changes.
  const collision = Object.keys(authSchemas).find((key) => key in entitySchemas);
  if (collision) {
    throw new Error(`OpenAPI schema name collision between entitySchemas and Better Auth: "${collision}"`);
  }

  return createDocument({
    openapi: "3.1.0",
    info: {
      title: "Faite internal API",
      version: "0.1.0",
      description:
        "Every route this Worker actually serves: /api/sync/* (the CRDT " +
        "replication protocol — internal, never a stable public contract), " +
        "/api/places/*, /api/desktop/*, /api/email/*, /api/contact, and " +
        "/api/auth/* (merged from Better Auth's own openAPI() plugin). Also " +
        "carries the entity schemas the public surface (openapi/v1.json) " +
        "will reference as /api/v1 grows. Generated by " +
        "scripts/openapi/generate.ts — do not hand-edit.",
    },
    security: [{ bearerAuth: [] }, { apiKeyCookie: [] }],
    components: {
      securitySchemes: {
        ...authSecuritySchemes,
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "An API token minted via /api/auth/api-key/* or the desktop " +
            "handoff (/api/desktop/exchange). Currently full-session-" +
            "equivalent for every key — see src/server/auth-tokens.ts.",
        },
      },
      schemas: { ...entitySchemas, ...authSchemas },
    },
    paths: { ...internalOnlyPaths, ...authPaths },
  });
}

/**
 * The public document. Empty `paths` until A2 (EI-227) lands the first
 * `/api/v1` read endpoints — deliberate, not a placeholder bug (see EI-226's
 * scope note). Still a structurally valid OpenAPI 3.1 document on its own.
 */
export function buildPublicDocument() {
  return createDocument({
    openapi: "3.1.0",
    info: {
      title: "Faite API",
      version: "0.1.0",
      description:
        "The public, versioned Faite API. Empty until A2 (EI-227) adds the " +
        "first /api/v1 endpoints. Published by A7 (EI-231). Generated by " +
        "scripts/openapi/generate.ts — do not hand-edit.",
    },
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "A scoped API token minted from Settings → API Keys (A3, EI-228).",
        },
      },
      schemas: { ...entitySchemas },
    },
    paths: {},
  });
}
