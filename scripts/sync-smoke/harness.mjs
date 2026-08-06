// Shared plumbing for the sync smoke harnesses. See README.md.
import { readFileSync } from "node:fs";

export const PORT = process.env.FAITE_SMOKE_PORT ?? "8790";
export const BASE = `http://localhost:${PORT}`;
export const WS_URL = `ws://localhost:${PORT}/api/sync/ws`;
export const COOKIE_JAR = process.env.FAITE_SMOKE_COOKIES ?? "/tmp/faite-p4/cookies.txt";

/**
 * Reads a curl cookie jar into a `Cookie` header value.
 *
 * NB: curl writes httpOnly cookies with a literal `#HttpOnly_` prefix on the
 * domain field, so the obvious "skip comment lines" filter drops exactly the
 * Better Auth session cookie you need — and every request then 401s in a way
 * that looks like an auth bug rather than a parsing one. Ask how I know.
 */
export function loadCookie(path = COOKIE_JAR) {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.replace(/^#HttpOnly_/, ""))
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("\t"))
    .filter((parts) => parts.length >= 7)
    .map((parts) => `${parts[5]}=${parts[6]}`)
    .join("; ");
}

/** A syntactically valid HLC (`hlc-core.ts`'s `isHlc`), stamped at `ms`. */
export function hlc(ms, node = "smoke-node") {
  return `${ms.toString(16).padStart(12, "0")}:0000:${node}`;
}

export function createReporter() {
  const state = { pass: 0, fail: 0 };
  return {
    state,
    check(name, ok, detail = "") {
      if (ok) {
        state.pass += 1;
        console.log(`  ok   ${name}`);
      } else {
        state.fail += 1;
        console.log(`  FAIL ${name} ${detail}`);
      }
    },
    finish() {
      console.log(`\n${state.pass} passed, ${state.fail} failed\n`);
      process.exit(state.fail === 0 ? 0 : 1);
    },
  };
}
