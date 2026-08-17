import { afterEach, describe, expect, it } from "vitest";
import { isDesktopShell } from "./bridge";

afterEach(() => {
  // `isTauri()` reads `globalThis.isTauri` — clean up whatever a test set.
  delete (globalThis as { isTauri?: boolean }).isTauri;
});

describe("isDesktopShell", () => {
  it("is false in a plain test/browser environment", () => {
    expect(isDesktopShell()).toBe(false);
  });

  it("is true once Tauri's webview has injected its flag", () => {
    (globalThis as { isTauri?: boolean }).isTauri = true;
    expect(isDesktopShell()).toBe(true);
  });
});
