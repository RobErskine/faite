/**
 * Is this a local development build, as judged by the origin the page was
 * actually served from?
 *
 * Deliberately a hostname check and NOT `process.env.NODE_ENV`, mirroring
 * `createAuth`'s `isLocal` in `src/server/auth.ts` — which makes the same
 * call for the same reason. Two reasons the env var is wrong here:
 *
 * 1. `npm run preview` runs a **production** build against the real Workers
 *    runtime on localhost. `NODE_ENV` reads "production" there, so an
 *    env-gated dev tool would vanish from the one local setup that most needs
 *    it.
 * 2. The client is a static bundle whose `NODE_ENV` is frozen at build time,
 *    so it cannot disagree with the origin — but it also cannot describe it.
 *    The hostname can.
 *
 * Branch previews (`*-faite.bfmw-dev.workers.dev`) are deliberately NOT local:
 * they share production's D1 and its real accounts, exactly as they do for
 * email verification.
 */
export function isLocalDev(): boolean {
  if (typeof location === "undefined") return false;
  return location.hostname === "localhost" || location.hostname === "127.0.0.1";
}
