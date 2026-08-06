// Shared target resolution for the schema scripts. See README.md.
import { loadCookie, PORT } from "../sync-smoke/harness.mjs";

const PROD = "https://myfaite.app";

/**
 * Where to point, and how to authenticate.
 *
 * Local reuses `scripts/sync-smoke/`'s cookie jar wholesale rather than
 * growing a second auth path — it already solves the one genuinely tricky
 * part (curl writes httpOnly cookies with a `#HttpOnly_` prefix, and the
 * obvious way to skip comment lines drops exactly the session cookie).
 *
 * Production needs its own jar, because local D1 is a completely separate
 * database from production (`docs/SETUP.md`) and the accounts do not overlap.
 */
export function resolveTarget(argv) {
  const prod = argv.includes("--prod");
  const jar = prod
    ? (process.env.FAITE_PROD_COOKIES ?? "/tmp/faite-prod/cookies.txt")
    : undefined;

  return {
    prod,
    base: prod ? PROD : `http://localhost:${PORT}`,
    label: prod ? "PRODUCTION (myfaite.app)" : `local wrangler dev (port ${PORT})`,
    cookie: loadCookie(jar),
  };
}

export async function call(target, path, init = {}) {
  const response = await fetch(`${target.base}${path}`, {
    ...init,
    headers: { ...init.headers, Cookie: target.cookie },
  });
  if (response.status === 401) {
    throw new Error(
      `401 from ${path}. The cookie jar is missing or stale — see scripts/schema/README.md.`,
    );
  }
  if (!response.ok) {
    throw new Error(`${path} responded ${response.status}: ${await response.text()}`);
  }
  return response.json();
}
