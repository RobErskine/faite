import { describe, expect, it } from "vitest";
import { isLocalRuntime } from "./auth";

/**
 * `isLocalRuntime` switches off email verification, so both directions
 * matter: a local worker that reads as production strands every local signup
 * (EI-215), and a deployed worker that reads as local lets anyone sign in to
 * an address they do not own.
 */
describe("isLocalRuntime", () => {
  it("is local with LOCAL_DEV=1 even when the request reports production (EI-215)", () => {
    // `wrangler dev` simulates the configured routes, so a request to
    // localhost:8787 arrives with this origin.
    expect(isLocalRuntime({ LOCAL_DEV: "1" }, "https://myfaite.app")).toBe(true);
  });

  it("is not local on the production origin without the flag", () => {
    expect(isLocalRuntime({}, "https://myfaite.app")).toBe(false);
  });

  it("is not local on a branch preview without the flag — previews share production's D1", () => {
    expect(isLocalRuntime({ LOCAL_DEV: "" }, "https://ei-1-faite.bfmw-dev.workers.dev")).toBe(false);
  });

  it("only treats the exact value 1 as set", () => {
    expect(isLocalRuntime({ LOCAL_DEV: "true" }, "https://myfaite.app")).toBe(false);
  });

  it("is local on a localhost origin without the flag", () => {
    expect(isLocalRuntime({ LOCAL_DEV: "" }, "http://localhost:8787")).toBe(true);
    expect(isLocalRuntime({ LOCAL_DEV: "" }, "http://127.0.0.1:8787")).toBe(true);
  });
});
