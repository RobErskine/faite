import type { DesktopAssetBundle } from "@/lib/desktop/version";
import { SITE_ORIGIN } from "@/lib/site";

/**
 * Serves the hot-asset bundle (EI-255) and describes it to `/api/desktop/version`.
 *
 * ## Publishing is an upload, not a deploy
 *
 * The bundle's identity lives in `manifest.json` in R2, and this module reads
 * it per request rather than baking it into a constant. So shipping a new
 * frontend to every installed desktop app is `npm run desktop:publish` — two
 * objects into a bucket — with no Worker deploy and no client release. That is
 * the same principle EI-147 established for the version policy itself
 * (`docs/DESKTOP.md` §12.1): everything except *whether the client asks* is
 * data the server sends.
 *
 * ## Everything here fails towards "no bundle"
 *
 * A missing binding, an absent manifest, malformed JSON, a manifest whose
 * fields are the wrong shape — all of them return `undefined` and leave the
 * version response without an `assets` block. Clients read that as "nothing to
 * do" and keep running what they already have. The alternative, a 500 out of
 * `/api/desktop/version`, would take down the obsolete-client check too, which
 * is the more important of the two jobs that endpoint does.
 */

/** Object key of the manifest describing the currently published bundle. */
const MANIFEST_KEY = "manifest.json";

/** Everything this module serves lives under here, on `SITE_ORIGIN`. */
const ROUTE_PREFIX = "/api/desktop/assets";

/** The shape `bundle-assets.mjs` writes. Only the fields the client needs. */
interface PublishedManifest {
  version: string;
  minShellVersion: string;
  archive: { name: string };
}

function isManifest(value: unknown): value is PublishedManifest {
  if (!value || typeof value !== "object") return false;
  const { version, minShellVersion, archive } = value as Record<string, unknown>;
  if (typeof version !== "string" || version.length === 0) return false;
  if (typeof minShellVersion !== "string" || minShellVersion.length === 0) return false;
  if (!archive || typeof archive !== "object") return false;
  const { name } = archive as Record<string, unknown>;
  return typeof name === "string" && name.length > 0;
}

/**
 * Describes the published bundle for the version response, or `undefined` when
 * there isn't one this server is confident about.
 */
export async function publishedBundle(env: CloudflareEnv): Promise<DesktopAssetBundle | undefined> {
  const bucket = env.DESKTOP_ASSETS;
  if (!bucket) return undefined;

  try {
    const object = await bucket.get(MANIFEST_KEY);
    if (!object) return undefined;
    const manifest: unknown = await object.json();
    if (!isManifest(manifest)) return undefined;

    return {
      version: manifest.version,
      minShellVersion: manifest.minShellVersion,
      manifestUrl: `${SITE_ORIGIN}${ROUTE_PREFIX}/${MANIFEST_KEY}`,
      archiveUrl: `${SITE_ORIGIN}${ROUTE_PREFIX}/${manifest.archive.name}`,
    };
  } catch {
    return undefined;
  }
}

/**
 * `GET /api/desktop/assets/<key>` — the manifest and the archive.
 *
 * Unauthenticated, like `/api/desktop/version` and for the same reason: which
 * frontend is current is a public fact about the product, not about the
 * caller. The bytes served are the same bytes any visitor to `myfaite.app`
 * already downloads by loading the site.
 *
 * Returns `null` when the path is not ours, so the caller can go on matching.
 */
export async function handleAssetRequest(
  request: Request,
  env: CloudflareEnv,
  headers: HeadersInit,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${ROUTE_PREFIX}/`)) return null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers });
  }

  const key = url.pathname.slice(ROUTE_PREFIX.length + 1);
  // Flat namespace by construction: one manifest, and archives named by their
  // own content hash. Anything with a separator is not a key this ever wrote.
  if (!key || key.includes("/") || key.includes("..")) {
    return new Response("Not Found", { status: 404, headers });
  }

  const bucket = env.DESKTOP_ASSETS;
  if (!bucket) return new Response("Not Found", { status: 404, headers });

  const object = await bucket.get(key);
  if (!object) return new Response("Not Found", { status: 404, headers });

  const responseHeaders = new Headers(headers);
  object.writeHttpMetadata(responseHeaders);
  responseHeaders.set("etag", object.httpEtag);
  responseHeaders.set(
    "Cache-Control",
    // An archive is named by its content hash, so it can never change meaning
    // and is safe to cache forever. The manifest is the pointer that moves,
    // and a stale one costs a client one extra update cycle to notice.
    key === MANIFEST_KEY ? "public, max-age=300" : "public, max-age=31536000, immutable",
  );

  return new Response(request.method === "HEAD" ? null : object.body, {
    status: 200,
    headers: responseHeaders,
  });
}
