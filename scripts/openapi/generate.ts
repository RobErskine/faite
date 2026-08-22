/**
 * Generates BOTH OpenAPI 3.1 documents (A1, EI-226) from the pure builders
 * in `src/server/openapi/spec.ts`:
 *
 *   - `openapi/openapi.json` — internal, everything this Worker serves
 *   - `openapi/v1.json` — public, `/api/v1` only (empty until A2, EI-227)
 *
 * Run by hand or in CI:
 *
 *   npm run openapi:generate && git diff --exit-code
 *
 * That second command is the drift check `.github/workflows/ci.yml` runs —
 * it fails the build if a schema changed without regenerating.
 *
 * ## Why `zod-openapi`
 *
 * Zod v4 (this repo pins `^4.4.3`) ships a native `z.toJSONSchema()` plus a
 * `.meta()`/`z.globalRegistry` metadata system. `zod-openapi`
 * (`samchungy/zod-openapi`, v6.0.1) was built around that registry from the
 * start — no monkey-patching, and its only peer dependency is `zod: ^4.0.0`,
 * which this repo already has.
 *
 * ## Merging Better Auth's own OpenAPI plugin
 *
 * `auth.ts` registers `openAPI({ disableDefaultReference: true })`, which
 * adds a read-only `generateOpenAPISchema` server function (no new HTTP
 * route beyond what the plugin already owns under `/api/auth/*`). This
 * script calls it directly — no HTTP hop — via the stub-bound `auth` export
 * in `auth-cli.ts`, the same instance `@better-auth/cli generate` already
 * uses, which is safe here for the same reason: generating a schema only
 * inspects `betterAuth()`'s config, it issues no D1 query.
 *
 * Better Auth's OpenAPI plugin has shipped invalid schemas for some plugin
 * combinations upstream (better-auth#2097, #6250, #3263). Both documents are
 * validated below with an OpenAPI 3.1 JSON-schema validator before being
 * written; if the merge ever produces something invalid, this throws rather
 * than silently shipping a broken spec — see `buildInternalDocument`'s doc
 * comment for the fallback (pass `undefined`, drop the plugin's output).
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Validator } from "@seriousme/openapi-schema-validator";
import { auth } from "@/server/auth-cli";
import { buildInternalDocument, buildPublicDocument } from "@/server/openapi/spec";

async function validateOrThrow(label: string, document: object): Promise<void> {
  // `Validator.validate` types its parameter as `Record<string, unknown>`.
  // `createDocument`'s return type is a concrete interface with no index
  // signature, and TS's structural check for index-signature targets
  // requires the SOURCE to declare one too, even though every property is
  // individually assignable to `unknown` — hence the `unknown` hop.
  const result = await new Validator().validate(document as unknown as Record<string, unknown>);
  if (!result.valid) {
    throw new Error(`${label} failed OpenAPI 3.1 validation:\n${JSON.stringify(result.errors, null, 2)}`);
  }
}

async function writeDocument(relativePath: string, document: unknown): Promise<void> {
  const outFile = resolve(dirname(fileURLToPath(import.meta.url)), "../../", relativePath);
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, JSON.stringify(document, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outFile}`);
}

async function main() {
  const authSchema = await auth.api.generateOpenAPISchema();

  const internal = buildInternalDocument(authSchema);
  const publicDoc = buildPublicDocument();

  await validateOrThrow("openapi/openapi.json", internal);
  await validateOrThrow("openapi/v1.json", publicDoc);

  await writeDocument("openapi/openapi.json", internal);
  await writeDocument("openapi/v1.json", publicDoc);
}

await main();
