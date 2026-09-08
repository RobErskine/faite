import { attachmentSchema, labelSchema, listSchema, tabSchema, todoSchema } from "@/lib/schema";

/**
 * The `/api/v1` resource map: which URL segment maps to which sync kind, the
 * Zod schema its rows are serialized through, and which HTTP methods the
 * dispatch actually implements.
 *
 * **Split out of `routes.ts` (A11, EI-291) so the OpenAPI generator can load
 * it without loading the routes.** `scripts/openapi/generate.ts` runs under
 * vite-node in plain Node, and imports this transitively via
 * `openapi/routes.ts`. `v1/routes.ts` itself pulls in `../auth`, the service
 * layer, and — as A13 through A17 split handlers into sibling modules — an
 * ever-growing chain of Worker-only code. This module imports schemas and
 * nothing else, on purpose. Keep it that way: a `cloudflare:workers` import
 * anywhere in its graph breaks `npm run openapi:generate`, which CI runs as a
 * drift check.
 *
 * `methods` exists so `openapi/routes.ts` can document exactly what the
 * dispatch serves without a second hand-maintained list — the same anti-drift
 * job `V1_RESOURCES` was created for. Before A11 that file hardcoded
 * `kind === "todo" ? { post } : {}`, which was already a second answer to
 * "which resources are writable."
 */
export const V1_RESOURCES = {
  todos: {
    kind: "todo",
    schema: todoSchema,
    methods: ["GET", "POST", "PATCH", "DELETE"],
  },
  lists: {
    kind: "list",
    schema: listSchema,
    methods: ["GET", "POST", "PATCH", "DELETE"],
  },
  labels: {
    kind: "label",
    schema: labelSchema,
    methods: ["GET", "POST", "PATCH", "DELETE"],
  },
  tabs: {
    kind: "tab",
    schema: tabSchema,
    methods: ["GET", "POST", "PATCH", "DELETE"],
  },
  /**
   * Read-only, and read-only on purpose (EI-242). A write here would have to
   * carry file bytes, and this API is JSON — uploads go to
   * `POST /api/attachments`, which is browser/session-only in v1.
   *
   * Each row carries the `id` a consumer needs to fetch the file itself:
   * `GET /api/attachments/{id}`. That URL is deliberately NOT a field on the
   * row — the dispatch returns `schema.parse(row)` verbatim and has nowhere
   * to inject a derived value, and a stored URL column would be a second
   * thing to keep true. See `docs/API.md`.
   */
  attachments: {
    kind: "attachment",
    schema: attachmentSchema,
    methods: ["GET"],
  },
} as const;

export type V1ResourcePath = keyof typeof V1_RESOURCES;
export type V1Kind = (typeof V1_RESOURCES)[V1ResourcePath]["kind"];
