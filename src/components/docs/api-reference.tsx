"use client";

import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";
import spec from "../../../openapi/v1.json";

/**
 * Renders `openapi/v1.json` (A7, EI-231) — the public document, never the
 * internal one. The spec is imported at build time rather than fetched at
 * runtime: this app also ships as a static Capacitor export with no server
 * to fetch from, and a build-time import means a spec that fails the CI
 * drift check (`openapi:generate && git diff --exit-code`) fails the build
 * before this page can ever ship a stale copy.
 *
 * Client Component: `ApiReferenceReact` renders its own interactive
 * reference UI (search, try-it panel) that only makes sense hydrated.
 */
export function ApiReference() {
  return <ApiReferenceReact configuration={{ content: spec }} />;
}
