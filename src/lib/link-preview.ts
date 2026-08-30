import { apiUrl } from "@/lib/api-origin";

/**
 * The client half of `/api/link-preview` — fetch-on-view metadata for the
 * Notes-field link-preview card.
 *
 * Unlike `src/lib/places/transport.ts`, there is no permanent-vs-transient
 * error taxonomy here: every failure (network error, non-200, a 200 with
 * `{ ok: false }`, an unparseable body) collapses to the same `null`, which
 * the card component renders as its fallback (hostname + raw URL). This is a
 * UI affordance, not a paid API — there is nothing to latch against and
 * nothing worth distinguishing to the user.
 */

export interface LinkPreviewMeta {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  icon: string | null;
}

/**
 * De-duplicates in-flight requests for the same URL, so two cards for the
 * same link on one page (or reopening the same sheet before the first fetch
 * lands) share one network request. Not a cache of RESOLVED values —
 * `Cache-Control: public, max-age=86400` on the response is what makes a
 * second, later fetch cheap; this map only exists for requests that overlap
 * in time. Module-level and never evicted: entries are promises, not
 * payloads, and there are at most a handful of distinct URLs open in the
 * Notes field at once.
 */
const inFlight = new Map<string, Promise<LinkPreviewMeta | null>>();

async function requestLinkPreview(url: string): Promise<LinkPreviewMeta | null> {
  try {
    const response = await fetch(apiUrl(`/api/link-preview?url=${encodeURIComponent(url)}`), {
      credentials: "include",
    });
    if (!response.ok) return null;

    const body = (await response.json()) as { ok: boolean; meta?: LinkPreviewMeta };
    return body.ok && body.meta ? body.meta : null;
  } catch {
    return null;
  }
}

export function fetchLinkPreview(url: string): Promise<LinkPreviewMeta | null> {
  const existing = inFlight.get(url);
  if (existing) return existing;

  const promise = requestLinkPreview(url).finally(() => {
    inFlight.delete(url);
  });
  inFlight.set(url, promise);
  return promise;
}
