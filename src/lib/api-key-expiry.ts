/**
 * The expiry choices Settings offers when minting an API key (A19, EI-299).
 *
 * **Dependency-free, and exported rather than inlined, so the UNITS are
 * unit-testable without standing up a live plugin.** That is the direct
 * lesson of EI-260, where `defaultExpiresIn` was set in milliseconds against
 * a plugin that reads seconds and shipped keys expiring in the year 2273 —
 * nothing caught it because `maxExpiresIn` only validates a CALLER-supplied
 * value, never the default.
 *
 * The units in `@better-auth/api-key` are genuinely inconsistent, and this is
 * the module that has to get them right:
 *
 * - `createApiKey`'s `expiresIn` is **seconds**…
 * - …but it validates that value in **days** (`expiresIn / (3600 * 24)`
 *   against `minExpiresIn` / `maxExpiresIn`).
 * - `keyExpiration.defaultExpiresIn` is **seconds**.
 *
 * `null` means never. Reaching that takes two calls — see
 * `api-keys-section.tsx` for why, and why a third plugin configuration was
 * the wrong way to do it.
 */

export type ExpiryOption = "7d" | "30d" | "90d" | "365d" | "never";

const DAY_SECONDS = 60 * 60 * 24;

/**
 * Ordered for the dropdown. `90d` matches `auth-tokens.ts`'s
 * `DEFAULT_KEY_EXPIRES_IN_SECONDS`, so picking nothing changes nothing.
 *
 * Nothing here exceeds `maxExpiresIn` (365 days) — "never" is reached by
 * clearing the expiry, not by requesting an enormous one, so that ceiling
 * never needs raising.
 */
export const EXPIRY_OPTIONS: { value: ExpiryOption; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "365d", label: "1 year" },
  { value: "never", label: "Never" },
];

export const DEFAULT_EXPIRY_OPTION: ExpiryOption = "90d";

/**
 * Seconds for a finite option, `null` for "never".
 *
 * `null` here does NOT mean "pass `expiresIn: null` to `createApiKey`" — that
 * call silently falls back to `defaultExpiresIn` (90 days) rather than
 * meaning forever. Only `updateApiKey` honors null. The caller is responsible
 * for that second step; this function only names the value.
 */
export function expiryOptionSeconds(option: ExpiryOption): number | null {
  switch (option) {
    case "7d":
      return 7 * DAY_SECONDS;
    case "30d":
      return 30 * DAY_SECONDS;
    case "90d":
      return 90 * DAY_SECONDS;
    case "365d":
      return 365 * DAY_SECONDS;
    case "never":
      return null;
  }
}

/* ------------------------------------------------------------ minting */

/** The two Better Auth calls minting a key may need, injected so the dance
 * below is testable without a live client or a rendered dropdown. */
export interface MintDeps {
  create: (input: {
    name: string;
    configId: string;
    expiresIn?: number;
  }) => Promise<{ data?: { id: string; key: string } | null; error?: { message?: string } | null }>;
  update: (input: {
    keyId: string;
    /** REQUIRED, not optional. See `mintApiKey`. */
    configId: string;
    expiresIn: null;
  }) => Promise<{ error?: { message?: string } | null }>;
}

export type MintResult =
  | { ok: false; message: string }
  /** `expiryWarning` means the key EXISTS and works, but clearing its expiry
   * failed — so it expires on the plugin's default schedule rather than
   * never. The caller must say so rather than reporting success or failure. */
  | { ok: true; key: string; expiryWarning: boolean };

/**
 * Mint a key, honoring "never" — which takes two calls.
 *
 * `createApiKey({ expiresIn: null })` does NOT mean forever: the plugin
 * treats a null as "unspecified" and falls back to `defaultExpiresIn`
 * (90 days). Only `updateApiKey` sets `expiresAt` to null. So "never" is
 * create-then-clear, and the interesting case is the second call failing.
 *
 * Extracted from the component so that case has a test that does not depend
 * on driving a popover — same instinct as the rest of this codebase, where
 * everything decidable lives in a module a unit test can reach.
 *
 * **The `update` call MUST carry the same `configId` the key was created
 * with.** `updateApiKey` resolves a configuration from the `configId` in the
 * request body — defaulting to `"default"` when absent — and then rejects the
 * key outright if `configIdMatches(apiKey.configId, lookupOpts.configId)`
 * fails. So omitting it 404s every `read-write` key, which is precisely the
 * scope a real integration asks for. Caught by a live run against the plugin;
 * a mocked `update` cannot see it, which is why the mock's type now demands
 * the field rather than accepting whatever the caller passes.
 */
export async function mintApiKey(
  deps: MintDeps,
  input: { name: string; configId: string; expiry: ExpiryOption },
): Promise<MintResult> {
  const expiresIn = expiryOptionSeconds(input.expiry);

  // Omitted entirely rather than passed as null — see above.
  const created = await deps.create(
    expiresIn === null
      ? { name: input.name, configId: input.configId }
      : { name: input.name, configId: input.configId, expiresIn },
  );

  if (created.error || !created.data) {
    return {
      ok: false,
      message: created.error?.message ?? "Something went wrong. Please try again.",
    };
  }

  if (expiresIn !== null) {
    return { ok: true, key: created.data.key, expiryWarning: false };
  }

  const cleared = await deps.update({
    keyId: created.data.id,
    // Not optional — see the doc comment. A read-write key 404s without it.
    configId: input.configId,
    expiresIn: null,
  });
  return { ok: true, key: created.data.key, expiryWarning: Boolean(cleared.error) };
}
