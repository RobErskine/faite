import { z } from "zod";
import {
  MAX_QUERY_LENGTH,
  SESSION_TOKEN_PATTERN,
  type AutocompleteRequest,
  type DetailsRequest,
} from "@/lib/places/wire";

/**
 * Request validation for `/api/places/*` — EI-83.
 *
 * Same convention as `src/server/sync/validate.ts`: parse to `null`, let the
 * caller map that to a 400, **never throw**. Kept in its own module for the
 * same reason too — a route handler needs a live D1 binding to test, a pure
 * parser does not, and this is where the guard that actually matters lives.
 *
 * That guard is `sessionToken`. It is interpolated into the Place Details
 * query string, so it is the one field here whose shape is a security
 * property rather than a convenience. See `SESSION_TOKEN_PATTERN`.
 */

const sessionTokenSchema = z.string().regex(SESSION_TOKEN_PATTERN);

// Exported for `src/server/openapi/routes.ts` (A1, EI-226) — the OpenAPI doc
// reuses these rather than hand-mirroring the request shape a second time.
export const autocompleteRequestSchema = z.object({
  // `.trim()` before the length checks so "   " is rejected as empty rather
  // than spending a billable request on whitespace.
  input: z.string().trim().min(1).max(MAX_QUERY_LENGTH),
  sessionToken: sessionTokenSchema,
});

export const detailsRequestSchema = z.object({
  // Google place ids are opaque and have no documented maximum; 255 is a sanity
  // bound, not a spec. The value is percent-encoded into the URL path by
  // `buildDetailsUrl`, so its contents are not an injection concern the way the
  // token's are — only its size is.
  placeId: z.string().min(1).max(255),
  sessionToken: sessionTokenSchema,
});

export function parseAutocompleteRequest(body: unknown): AutocompleteRequest | null {
  const parsed = autocompleteRequestSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

export function parseDetailsRequest(body: unknown): DetailsRequest | null {
  const parsed = detailsRequestSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}
