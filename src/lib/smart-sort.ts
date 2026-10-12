import { apiUrl } from "@/lib/api-origin";

/**
 * The client half of `POST /api/smart-sort/suggest` (EI-367): proposed lists
 * for Quick sort to pre-select. Same conventions as `lib/duplicates-key.ts` —
 * `credentials: "include"` for the session cookie, `apiUrl()` because
 * `next dev` runs no Worker.
 *
 * Never throws. A pre-selection is a convenience, so every failure — signed
 * out, no Worker, no key, Jev down — is the same answer: `null`, nothing to
 * pre-select.
 */
export async function fetchListSuggestions(todoIds: string[]): Promise<Record<string, string | null> | null> {
  if (todoIds.length === 0) return {};
  try {
    const response = await fetch(apiUrl("/api/smart-sort/suggest"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ todoIds }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { suggestions?: Record<string, string | null> };
    return body.suggestions ?? null;
  } catch {
    return null;
  }
}
