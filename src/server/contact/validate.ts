import { z } from "zod";

/**
 * Request validation for `POST /api/contact` (EI-206). Same convention as
 * `src/server/places/validate.ts`: parse to `null`, let the caller map that
 * to a 400, never throw.
 */

// Exported for `src/server/openapi/routes.ts` (A1, EI-226) — reused rather
// than hand-mirrored a second time.
export const contactRequestSchema = z.object({
  // `.trim()` before the length checks so whitespace-only input is rejected
  // as empty rather than delivered as a blank report.
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  message: z.string().trim().min(1).max(5000),
  turnstileToken: z.string().min(1).max(4096),
});

export type ContactRequest = z.infer<typeof contactRequestSchema>;

export function parseContactRequest(body: unknown): ContactRequest | null {
  const parsed = contactRequestSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}
