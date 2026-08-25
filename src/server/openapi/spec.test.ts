import { describe, expect, it } from "vitest";
import { Validator } from "@seriousme/openapi-schema-validator";
import { auth } from "@/server/auth-cli";
import { buildInternalDocument, buildPublicDocument } from "./spec";

// `Validator.validate` types its parameter as `Record<string, unknown>`;
// `createDocument`'s return type has no index signature, and TS's
// index-signature assignability check requires the SOURCE to declare one
// too, so a direct cast needs the `unknown` hop even though every property
// here is individually assignable.
const asSpecData = (document: object) => document as unknown as Record<string, unknown>;

/**
 * Pins two things EI-226 exists to guarantee:
 *
 * 1. Every route `worker.ts` actually dispatches to appears as a documented
 *    path — so an endpoint added to a route file without a matching entry
 *    here fails a fast unit test, not a slow "nobody noticed" drift.
 * 2. Both generated documents, INCLUDING the merge with Better Auth's own
 *    `openAPI()` plugin output, validate against a real OpenAPI 3.1
 *    JSON-schema validator — the concrete form of "watch out, Better Auth's
 *    plugin has shipped invalid schemas before" from the ticket.
 */

// Mirrors worker.ts's dispatch table exactly (see its own file comment) so
// this list can only drift from the real routing by someone editing both
// files and forgetting one — the same failure mode as the OpenAPI doc
// itself, just one file closer to the source of truth.
const EXPECTED_INTERNAL_PATHS = [
  "/api/sync/ws",
  "/api/sync/push",
  "/api/sync/pull",
  "/api/sync/schema",
  "/api/sync/reset",
  "/api/places/autocomplete",
  "/api/places/details",
  "/api/desktop/handoff",
  "/api/desktop/exchange",
  "/api/email/address",
  "/api/email/address/rotate",
  "/api/contact",
  "/api/attachments",
  "/api/attachments/{id}",
  "/api/v1/todos",
  "/api/v1/todos/{id}",
  "/api/v1/lists",
  "/api/v1/labels",
  "/api/v1/tabs",
  "/api/v1/attachments",
];

describe("buildInternalDocument", () => {
  it("documents every real route worker.ts dispatches to", () => {
    const document = buildInternalDocument();
    for (const path of EXPECTED_INTERNAL_PATHS) {
      expect(document.paths, `missing path: ${path}`).toHaveProperty(path);
    }
  });

  it("does not resurrect the aspirational /todos paths (EI-226's whole point)", () => {
    const document = buildInternalDocument();
    expect(document.paths).not.toHaveProperty("/todos");
    expect(document.paths).not.toHaveProperty("/todos/{id}");
  });

  it("validates as OpenAPI 3.1 on its own, with no Better Auth merge", async () => {
    const result = await new Validator().validate(asSpecData(buildInternalDocument()));
    expect(result.errors).toBeUndefined();
    expect(result.valid).toBe(true);
  });

  it("throws on a schema name collision instead of silently overwriting one", () => {
    expect(() =>
      buildInternalDocument({
        paths: {},
        components: { schemas: { Todo: { type: "object" } } },
      }),
    ).toThrow(/collision/i);
  });

  it("merges Better Auth's real generated schema and stays valid (the actual EI-226 risk)", async () => {
    const authSchema = await auth.api.generateOpenAPISchema();
    const document = buildInternalDocument(authSchema);

    // Spot-check a couple of real Better Auth endpoints landed under the
    // right prefix — worker.ts routes ALL of /api/auth/* to Better Auth's
    // own handler, so these are genuinely live, not illustrative.
    expect(document.paths).toHaveProperty("/api/auth/sign-in/email");
    expect(document.paths).toHaveProperty("/api/auth/get-session");

    const result = await new Validator().validate(asSpecData(document));
    expect(result.errors).toBeUndefined();
    expect(result.valid).toBe(true);
  });
});

describe("buildPublicDocument", () => {
  it("documents A2 (EI-227) reads plus A5's (EI-230) two todo writes, nothing else", () => {
    expect(Object.keys(buildPublicDocument().paths ?? {}).sort()).toEqual(
      [
        "/api/v1/attachments",
        "/api/v1/labels",
        "/api/v1/lists",
        "/api/v1/tabs",
        "/api/v1/todos",
        "/api/v1/todos/{id}",
      ].sort(),
    );
  });

  it("todos gained POST; every other resource stays GET-only", () => {
    const paths = buildPublicDocument().paths ?? {};
    expect(paths["/api/v1/todos"]).toHaveProperty("post");
    expect(paths["/api/v1/lists"]).not.toHaveProperty("post");
    expect(paths["/api/v1/labels"]).not.toHaveProperty("post");
    expect(paths["/api/v1/tabs"]).not.toHaveProperty("post");
    // EI-242: a write here would have to carry file bytes, and this API is
    // JSON. Uploads go to POST /api/attachments, which is session-only.
    expect(paths["/api/v1/attachments"]).not.toHaveProperty("post");
  });

  it("validates as OpenAPI 3.1", async () => {
    const result = await new Validator().validate(asSpecData(buildPublicDocument()));
    expect(result.errors).toBeUndefined();
    expect(result.valid).toBe(true);
  });
});
