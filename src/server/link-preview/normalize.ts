/**
 * Turns the raw tags `fetch-meta.ts` collected via `HTMLRewriter` into the
 * response shape the client renders — pure, unit-tested, no network.
 */

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 300;

export interface RawLinkPreviewTags {
  ogTitle?: string;
  twitterTitle?: string;
  title?: string;
  ogDescription?: string;
  description?: string;
  ogImage?: string;
  twitterImage?: string;
  ogSiteName?: string;
  icon?: string;
}

export interface LinkPreviewMeta {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  icon: string | null;
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max - 1).trimEnd() + "…" : trimmed;
}

function firstNonEmpty(...values: (string | undefined)[]): string | null {
  for (const value of values) {
    if (value && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Resolves a possibly-relative image/icon URL against the page's FINAL
 * response URL (post-redirect), and drops anything that doesn't resolve to
 * http(s) — a `data:` or `javascript:` URI in an `og:image` tag renders as a
 * broken image either way, so there is nothing to gain from passing it
 * through, and it saves the client its own validation pass.
 */
function resolveMediaUrl(raw: string | undefined, baseUrl: string): string | null {
  if (!raw || !raw.trim()) return null;
  try {
    const resolved = new URL(raw.trim(), baseUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

export function normalizeLinkPreviewMeta(
  tags: RawLinkPreviewTags,
  finalUrl: string,
): LinkPreviewMeta {
  const title = firstNonEmpty(tags.ogTitle, tags.twitterTitle, tags.title);
  const description = firstNonEmpty(tags.ogDescription, tags.description);

  return {
    url: finalUrl,
    title: title ? truncate(title, MAX_TITLE_LENGTH) : null,
    description: description ? truncate(description, MAX_DESCRIPTION_LENGTH) : null,
    image: resolveMediaUrl(firstNonEmpty(tags.ogImage, tags.twitterImage) ?? undefined, finalUrl),
    siteName: firstNonEmpty(tags.ogSiteName),
    icon: resolveMediaUrl(tags.icon, finalUrl),
  };
}
