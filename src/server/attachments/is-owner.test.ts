import { describe, expect, it } from "vitest";
import { isOwnerEmail } from "./is-owner";

const OWNERS = "rob@roberskine.com,roberskine13@gmail.com";

/**
 * The whole privilege model in the app is this function, so the tests that
 * matter are the ones about NOT granting it.
 */
describe("isOwnerEmail", () => {
  it("matches a listed, verified address", () => {
    expect(isOwnerEmail("rob@roberskine.com", true, OWNERS)).toBe(true);
    expect(isOwnerEmail("roberskine13@gmail.com", true, OWNERS)).toBe(true);
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    expect(isOwnerEmail("  Rob@RobErskine.com ", true, OWNERS)).toBe(true);
    expect(isOwnerEmail("rob@roberskine.com", true, " rob@roberskine.com , x@y.z ")).toBe(true);
  });

  it("REFUSES an unverified match — sign-up is open, so the address alone proves nothing", () => {
    expect(isOwnerEmail("rob@roberskine.com", false, OWNERS)).toBe(false);
    expect(isOwnerEmail("rob@roberskine.com", null, OWNERS)).toBe(false);
    expect(isOwnerEmail("rob@roberskine.com", undefined, OWNERS)).toBe(false);
  });

  it("REFUSES anyone not on the list", () => {
    expect(isOwnerEmail("someone@else.com", true, OWNERS)).toBe(false);
  });

  it("REFUSES a near-miss rather than matching loosely", () => {
    // No substring or suffix matching: an attacker who can register
    // `notrob@roberskine.com` or `rob@roberskine.com.evil.test` must not
    // inherit the raised cap.
    expect(isOwnerEmail("notrob@roberskine.com", true, OWNERS)).toBe(false);
    expect(isOwnerEmail("rob@roberskine.com.evil.test", true, OWNERS)).toBe(false);
    expect(isOwnerEmail("rob@roberskine.co", true, OWNERS)).toBe(false);
  });

  it("REFUSES everyone when the var is unset or empty — fails closed", () => {
    expect(isOwnerEmail("rob@roberskine.com", true, undefined)).toBe(false);
    expect(isOwnerEmail("rob@roberskine.com", true, "")).toBe(false);
  });

  it("does not treat an empty entry in the list as a wildcard", () => {
    // `"a@b.c,,"` splits to an empty string, which must never match an
    // account whose email is somehow blank.
    expect(isOwnerEmail("", true, "a@b.c,,")).toBe(false);
    expect(isOwnerEmail(null, true, "a@b.c,,")).toBe(false);
  });
});
