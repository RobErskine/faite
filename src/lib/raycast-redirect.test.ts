import { describe, expect, it } from "vitest";
import { isAllowedRaycastRedirect } from "./raycast-redirect";

/**
 * This is the guard standing between a signed-in user and an attacker-chosen
 * redirect that would collect a working API key. Every case below is a way
 * that guard could be written wrong.
 */
describe("isAllowedRaycastRedirect", () => {
  it("accepts Raycast's real redirect, with and without its query param", () => {
    expect(isAllowedRaycastRedirect("https://raycast.com/redirect")).toBe(true);
    expect(isAllowedRaycastRedirect("https://raycast.com/redirect?packageName=Extension")).toBe(true);
  });

  /** A prefix check (`startsWith("https://raycast.com")`) would accept every
   * one of these. That is the classic way this guard gets written wrong. */
  it("rejects lookalike hosts", () => {
    for (const target of [
      "https://raycast.com.evil.test/redirect",
      "https://raycast.com.evil.test/redirect?packageName=Extension",
      "https://evil.test/redirect?x=https://raycast.com/redirect",
      "https://notraycast.com/redirect",
      "https://raycast.co/redirect",
    ]) {
      expect(isAllowedRaycastRedirect(target), target).toBe(false);
    }
  });

  /** A subdomain is a different origin, and Raycast's Web redirect method
   * does not use one. */
  it("rejects subdomains of the allowed host", () => {
    expect(isAllowedRaycastRedirect("https://api.raycast.com/redirect")).toBe(false);
  });

  it("rejects the right host on the wrong path", () => {
    expect(isAllowedRaycastRedirect("https://raycast.com/")).toBe(false);
    expect(isAllowedRaycastRedirect("https://raycast.com/redirect/evil")).toBe(false);
    expect(isAllowedRaycastRedirect("https://raycast.com/evil")).toBe(false);
  });

  /** Downgrading the scheme would put the code on the wire in plaintext. */
  it("rejects a non-HTTPS scheme", () => {
    expect(isAllowedRaycastRedirect("http://raycast.com/redirect")).toBe(false);
  });

  /** A custom scheme is exactly the confused-deputy case: the OS hands the
   * URL to whatever app registered it. */
  it("rejects custom schemes", () => {
    expect(isAllowedRaycastRedirect("raycast://extensions/Rob/faite/x")).toBe(false);
    expect(isAllowedRaycastRedirect("javascript:alert(1)")).toBe(false);
  });

  it("rejects anything that is not a URL, and absent values", () => {
    for (const target of ["", "   ", "/redirect", "raycast.com/redirect", null, undefined]) {
      expect(isAllowedRaycastRedirect(target as string), String(target)).toBe(false);
    }
  });
});
