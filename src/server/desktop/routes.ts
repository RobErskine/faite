import { createAuth, getSessionSafe } from "../auth";
import { DESKTOP_KEY_NAME, DESKTOP_KEY_PERMISSIONS } from "../auth-scopes";
import { corsHeaders, handleOptions } from "../cors";
import { handleAssetRequest, publishedBundle } from "./assets";
import { decodeHandoffCode, encodeHandoffCode } from "./handoff-code";
import { DESKTOP_VERSION_POLICY } from "./version";

/**
 * `/api/desktop/*` — D2a's login handoff, plus EI-147's build-version check.
 * Same seam as `/api/auth/*` and `/api/sync/*` in `worker.ts`: not a Next.js
 * Route Handler, for the same `output: export` reason (see `worker.ts`'s file
 * comment).
 *
 * Three endpoints, three different callers:
 *
 * - `/handoff` is called from the SYSTEM BROWSER (real `https://myfaite.app`
 *   origin, same-origin, cookie session already present) right after a
 *   normal sign-in. It mints a real API key — named per-device (EI-261) from
 *   an optional `deviceName` in the body — and hands back an encrypted,
 *   short-lived code — never the key itself — for the browser to put in the
 *   `faite://auth-callback` redirect. Every sign-in mints a NEW key; nothing
 *   here revokes a previous one, so the same account can hold one live key
 *   per device at once (a deliberate choice — see EI-261's ticket).
 * - `/exchange` is called from the DESKTOP APP (`tauri://localhost`,
 *   genuinely cross-origin, no cookie) once it receives that deep link. It
 *   trades the code for the real key. This is the only place the plaintext
 *   key crosses the wire a second time, and it never touches a URL or
 *   browser history — see `docs/DESKTOP.md` §9 and `handoff-code.ts`'s file
 *   comment for why the indirection exists at all.
 * - `/version` is called by the desktop app on launch and on a timer, and it
 *   is the one route here with NO auth at all. That is the point: an app too
 *   old to sync is very likely an app that cannot authenticate either, and
 *   what it needs back ("you are obsolete, here is the download") is a public
 *   fact about the product, not about the caller. See `./version.ts` and
 *   `docs/DESKTOP.md` §12.
 */

function json(body: unknown, status: number, headers: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

async function readCode(request: Request): Promise<string | null> {
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !("code" in body)) return null;
  const code = (body as { code: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

// Capped well under `auth-tokens.ts`'s `maximumNameLength` (96), which also
// has to fit the `"Faite desktop — "` prefix (16 chars) — leaves headroom
// even for an unusually long hostname, and `createApiKey` would otherwise
// reject the whole handoff with `INVALID_NAME_LENGTH` over one bad name.
const MAX_DEVICE_NAME_LENGTH = 64;

/** `deviceName` is optional and best-effort (EI-261): an old desktop build
 * that predates this field, or a caller that doesn't send one, still gets a
 * working — just unlabeled — key. Never throws on a malformed body; a
 * device name is a display nicety, not something worth failing sign-in
 * over. */
export async function readDeviceName(request: Request): Promise<string | null> {
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !("deviceName" in body)) return null;
  const deviceName = (body as { deviceName: unknown }).deviceName;
  if (typeof deviceName !== "string") return null;
  const trimmed = deviceName.trim().slice(0, MAX_DEVICE_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

/** Display only — see the SECURITY note on `scopeGranted` (`auth-scopes.ts`)
 * for why this name is never treated as anything more than a label. */
export function desktopKeyName(deviceName: string | null): string {
  return deviceName ? `${DESKTOP_KEY_NAME} — ${deviceName}` : DESKTOP_KEY_NAME;
}

export async function handleDesktopRequest(request: Request, env: CloudflareEnv): Promise<Response> {
  if (request.method === "OPTIONS") return handleOptions(request);

  const headers = corsHeaders(request.headers.get("Origin"));
  const url = new URL(request.url);

  // Before `createAuth`, and reached without a session on purpose (see the
  // file comment). `max-age` is short because raising `minimum` is how an
  // emergency block reaches the field: five minutes of edge cache is worth
  // having, an hour of it is not.
  if (url.pathname === "/api/desktop/version" && request.method === "GET") {
    // EI-255: the hot-asset block is read from R2 per request rather than
    // baked in, so publishing a new frontend is an upload and not a deploy.
    // `publishedBundle` resolves to `undefined` for every failure it can have,
    // which leaves the response exactly as it was before EI-255 — the
    // obsolete-client check keeps working even when the asset pipeline does
    // not.
    const assets = await publishedBundle(env);
    const response = json(assets ? { ...DESKTOP_VERSION_POLICY, assets } : DESKTOP_VERSION_POLICY, 200, headers);
    response.headers.set("Cache-Control", "public, max-age=300");
    return response;
  }

  // The bundle itself. Unauthenticated for the same reason `/version` is.
  const assetResponse = await handleAssetRequest(request, env, headers);
  if (assetResponse) return assetResponse;

  const auth = createAuth(env, request);

  if (url.pathname === "/api/desktop/handoff" && request.method === "POST") {
    // `getSessionSafe`, not `auth.api.getSession()` directly — see its own
    // doc comment (`auth.ts`). This route is normally cookie-only (called
    // from the system browser), but a malformed `Authorization` header sent
    // here by mistake would still throw rather than resolve to `null`.
    const session = await getSessionSafe(auth, request);
    if (!session) return json({ error: "unauthenticated" }, 401, headers);

    // Named for the eventual revocation UI (EI-50/auth-tokens.ts's own
    // "requireName" comment: an unnamed key is one nobody can identify six
    // months from now).
    //
    // Deliberately NO `headers` on this call, and an EXPLICIT `userId` —
    // the opposite of what an earlier version of this comment said, and for
    // a reason worth recording: `permissions` (A2, EI-227) is a
    // server-only property, and `@better-auth/api-key` decides "is this a
    // server call" by checking `ctx.request || ctx.headers` — ANY headers
    // at all, not specifically a session cookie. Passing `request.headers`
    // (needed, before this ticket, only so the plugin could resolve the
    // caller's own session internally) made this call look identical to a
    // public client request, and silently threw `SERVER_ONLY_PROPERTY` the
    // moment `permissions` was added. `session` is already resolved above
    // via `getSessionSafe`, so this call supplies its id directly instead
    // and needs the request only for the optional device name below.
    //
    // `deviceName` (EI-261) rides in the POST body, put there by
    // `desktop-handoff/page.tsx` from its own `?device=` query param, which
    // in turn came from `bridge.ts`'s `startDesktopLogin()` reading the
    // Tauri shell's OS hostname before ever opening the system browser —
    // this route never talks to Tauri directly. It is a LABEL ONLY: see
    // `desktopKeyName`'s doc comment and `scopeGranted`'s SECURITY note for
    // why it plays no part in the actual access grant below.
    const deviceName = await readDeviceName(request);
    const created = await auth.api.createApiKey({
      body: {
        name: desktopKeyName(deviceName),
        permissions: DESKTOP_KEY_PERMISSIONS,
        userId: session.user.id,
      },
    });

    const code = await encodeHandoffCode(created.key, env.BETTER_AUTH_SECRET);
    return json({ code }, 200, headers);
  }

  if (url.pathname === "/api/desktop/exchange" && request.method === "POST") {
    const code = await readCode(request);
    if (!code) return json({ error: "invalid-request" }, 400, headers);

    const token = await decodeHandoffCode(code, env.BETTER_AUTH_SECRET);
    if (!token) return json({ error: "invalid-or-expired-code" }, 401, headers);

    return json({ token }, 200, headers);
  }

  return json({ error: "not-found" }, 404, headers);
}
