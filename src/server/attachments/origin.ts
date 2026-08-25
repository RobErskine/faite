/**
 * Which origin serves attachment BYTES (EI-244).
 *
 * Attachment bytes live on `files.myfaite.app`, a different origin from the
 * app, so a previewed PDF renders cross-origin. That is what contains it: a
 * cross-origin iframe is isolated by the same-origin policy WITHOUT a
 * `sandbox` attribute — and the attribute was never an option, because
 * Chrome's PDF viewer refuses to render in a sandboxed frame at all (EI-243,
 * measured).
 *
 * ## Why this is configured and not derived
 *
 * The obvious implementation reads the request's hostname and returns the
 * file origin only in production. It does not work, and the reason is worth
 * recording because it costs an hour to rediscover:
 *
 * **`wrangler dev` faithfully simulates the configured `routes`.** Locally,
 * `url.hostname`, the `Host` header, AND `request.cf` all report production
 * — measured, all three. There is no runtime signal that distinguishes a
 * local preview from the real thing, so a derived answer sends local
 * development redirecting to a hostname that does not resolve, and the
 * feature looks broken on every laptop.
 *
 * So it is an explicit var, with `.dev.vars` as the local override that
 * wrangler already provides for exactly this. See `docs/SETUP.md`.
 */

/** The user-content hostname. Kept here so routing and minting agree. */
const FILE_HOST = "files.myfaite.app";

/** True when this request arrived on the user-content origin. */
export function isFileOriginRequest(url: URL): boolean {
  return url.hostname === FILE_HOST;
}

/**
 * The origin a signed byte URL should point at.
 *
 * `configured` is `ATTACHMENTS_ORIGIN`. Empty or unset means **same origin**,
 * which is the local-development answer: functional, and deliberately NOT
 * isolated, since there is no untrusted content on a developer's laptop that
 * was not already there. `isIsolated` exists so that difference can be
 * asserted rather than assumed.
 *
 * Returns an ORIGIN with no trailing slash; the caller appends the path.
 */
export function fileOriginFor(url: URL, configured: string | undefined): string {
  const trimmed = configured?.trim().replace(/\/+$/, "");
  return trimmed ? trimmed : url.origin;
}

/**
 * Whether bytes and app are genuinely on different origins — i.e. whether
 * the isolation EI-244 exists for is actually in effect.
 */
export function isIsolated(url: URL, configured: string | undefined): boolean {
  return fileOriginFor(url, configured) !== url.origin;
}
