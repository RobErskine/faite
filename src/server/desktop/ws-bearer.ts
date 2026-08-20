import { WS_BEARER_PROTOCOL_PREFIX } from "@/lib/sync/wire";

/**
 * D2a: how the desktop shell's bearer token rides a WebSocket handshake.
 *
 * The `WebSocket` constructor has no way to set an `Authorization` header
 * (or any header at all) — cookies ride the handshake automatically for a
 * same-origin browser session, but `tauri://localhost` has no cookie to
 * ride (see `docs/DESKTOP.md` §7.4/§9) and needs another channel. The one
 * thing a browser WebSocket CAN set is `Sec-WebSocket-Protocol`
 * (`new WebSocket(url, protocols)`), which the client sends as an ordinary,
 * comma-separated request header — so the token rides as a subprotocol
 * value instead. `auth-tokens.ts`'s `customAPIKeyGetter` reads it the same
 * way it reads an `Authorization` header; `user-do.ts` echoes the offered
 * protocol back on the 101 response, which RFC 6455 requires for the
 * browser to consider the handshake complete.
 *
 * Deliberately its own dependency-free module rather than living in
 * `sync/ws-server.ts` (which already needs a helper like this, but also
 * needs `TRUSTED_ORIGINS` from `../auth`) — `auth-tokens.ts` needs this too,
 * and `auth.ts` imports `auth-tokens.ts`'s plugin, so a copy living in
 * `ws-server.ts` would make `auth-tokens.ts → ws-server.ts → auth.ts` a
 * cycle back to the file that imports `auth-tokens.ts` in the first place.
 * `WS_BEARER_PROTOCOL_PREFIX` itself lives in `@/lib/sync/wire` — the one
 * constant `src/lib/sync/ws-transport.ts` (client) and this file (server)
 * both import, so the two ends can't drift.
 */

export function extractWsBearerToken(protocolHeader: string | null): string | null {
  if (!protocolHeader) return null;
  for (const raw of protocolHeader.split(",")) {
    const entry = raw.trim();
    if (!entry.startsWith(WS_BEARER_PROTOCOL_PREFIX)) continue;
    const token = entry.slice(WS_BEARER_PROTOCOL_PREFIX.length);
    if (token) return token;
  }
  return null;
}
