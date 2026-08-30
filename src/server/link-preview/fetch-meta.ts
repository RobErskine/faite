import { normalizeLinkPreviewMeta, type LinkPreviewMeta, type RawLinkPreviewTags } from "./normalize";

/**
 * Fetches a page and extracts Open Graph / Twitter Card / plain `<title>`
 * metadata using Cloudflare's built-in `HTMLRewriter` — not a regex parser
 * and not an npm dependency. See `docs/LINK-PREVIEW.md` for why (in short:
 * every popular option — `open-graph-scraper`, `link-preview-js`,
 * `metascraper` — depends on `undici` and cannot run on Workers, and
 * `unfurl.js` is archived).
 *
 * Two gotchas that cost real debugging time, kept here rather than only in
 * the runbook:
 *
 * 1. `HTMLRewriter` is lazy — attaching handlers does nothing until the
 *    transformed body is actually consumed. `.arrayBuffer()` on the
 *    transformed response is what drains it; skip that and no handler ever
 *    fires.
 * 2. `text()` on a `<title>` element arrives in chunks, potentially split
 *    mid-word. Accumulate across calls rather than assigning the latest
 *    chunk.
 */

const FETCH_TIMEOUT_MS = 5000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; FaiteLinkPreview/1.0; +https://myfaite.app)";

export type FetchLinkPreviewResult =
  | { ok: true; meta: LinkPreviewMeta }
  | { ok: false };

class MetaTagCollector {
  tags: RawLinkPreviewTags = {};
  private titleBuffer = "";

  element(element: Element) {
    const property = element.getAttribute("property")?.toLowerCase();
    const name = element.getAttribute("name")?.toLowerCase();
    const content = element.getAttribute("content");
    if (content) {
      switch (property ?? name) {
        case "og:title":
          this.tags.ogTitle = content;
          break;
        case "twitter:title":
          this.tags.twitterTitle = content;
          break;
        case "og:description":
          this.tags.ogDescription = content;
          break;
        case "description":
          this.tags.description = content;
          break;
        case "og:image":
        case "og:image:url":
          this.tags.ogImage = content;
          break;
        case "twitter:image":
          this.tags.twitterImage = content;
          break;
        case "og:site_name":
          this.tags.ogSiteName = content;
          break;
      }
      return;
    }

    // <link rel="icon" href="...">
    const rel = element.getAttribute("rel")?.toLowerCase();
    if (rel && /(^|\s)icon(\s|$)/.test(rel)) {
      const href = element.getAttribute("href");
      if (href) this.tags.icon = href;
    }
  }

  title(text: Text) {
    this.titleBuffer += text.text;
    if (text.lastInTextNode) {
      this.tags.title = this.titleBuffer;
    }
  }
}

export async function fetchLinkPreviewMeta(url: URL): Promise<FetchLinkPreviewResult> {
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      // Cache a successful fetch for a day at Cloudflare's edge; never cache
      // a failure, so a transient upstream error doesn't stick around.
      cf: { cacheTtlByStatus: { "200-299": 86400, "400-599": 0 } },
    } satisfies RequestInit & { cf?: Record<string, unknown> });
  } catch {
    return { ok: false };
  }

  if (!response.ok) return { ok: false };

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return { ok: false };

  const collector = new MetaTagCollector();
  const rewritten = new HTMLRewriter()
    .on("meta", collector)
    .on('link[rel~="icon"]', collector)
    .on("title", collector)
    .transform(response);

  try {
    // Draining the body is what actually runs the handlers above —
    // HTMLRewriter does nothing until the transformed stream is consumed.
    await rewritten.arrayBuffer();
  } catch {
    return { ok: false };
  }

  return { ok: true, meta: normalizeLinkPreviewMeta(collector.tags, response.url || url.toString()) };
}
