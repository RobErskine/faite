/**
 * Custom worker entry.
 *
 * The default OpenNext build output cannot export a Durable Object class, so we
 * wrap it: delegate all HTTP handling to the OpenNext handler, and re-export the
 * DO class alongside it so the `USER_DO` binding in wrangler.jsonc can resolve.
 *
 * Set as `main` in wrangler.jsonc via the build script (see package.json).
 */
import openNextHandler from "open-next/worker";

export { UserDurableObject } from "./user-do";

export default openNextHandler;
