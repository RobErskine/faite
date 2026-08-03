/**
 * The OpenNext build emits `.open-next/worker.js` at build time, so it does not
 * exist in a clean checkout. This declaration is matched via the `open-next/worker`
 * path alias in tsconfig.worker.json, so `tsc` passes in CI before any build has run.
 *
 * Ambient `declare module` cannot match a relative specifier, which is why the
 * worker entry imports the alias rather than "../../.open-next/worker.js".
 */
declare module "open-next/worker" {
  const handler: ExportedHandler;
  export default handler;
}
