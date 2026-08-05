import { describe, expect, it } from "vitest";
import { deriveInitials, firstGrapheme, resolveAvatar } from "./profile";

describe("deriveInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(deriveInitials("Rob Erskine")).toBe("RE");
  });

  it("handles a single word", () => {
    expect(deriveInitials("Cher")).toBe("C");
  });

  it("returns empty for an empty string", () => {
    expect(deriveInitials("")).toBe("");
  });
});

describe("firstGrapheme", () => {
  it("returns the intact family emoji rather than shattering the ZWJ sequence", () => {
    expect(firstGrapheme("👨‍👩‍👧x")).toBe("👨‍👩‍👧");
  });

  it("returns empty for an empty string", () => {
    expect(firstGrapheme("")).toBe("");
  });

  it("returns a plain character unchanged", () => {
    expect(firstGrapheme("hi")).toBe("h");
  });
});

describe("resolveAvatar", () => {
  it("falls back to the placeholder name and derived initials when settings is undefined", () => {
    const avatar = resolveAvatar(undefined);
    expect(avatar.name).toBe("Local User");
    expect(avatar.initials).toBe("LU");
    expect(avatar.kind).toBe("initials");
  });

  it("lets custom initials override the derived ones", () => {
    const avatar = resolveAvatar({
      displayName: "Rob Erskine",
      avatarInitials: "RX",
    });
    expect(avatar.initials).toBe("RX");
  });

  it("falls back to initials for an unrecognized avatarKind", () => {
    const avatar = resolveAvatar({ avatarKind: "hologram" });
    expect(avatar.kind).toBe("initials");
  });

  describe("session fallback", () => {
    it("uses the account name and its initials when no local display name is set", () => {
      const avatar = resolveAvatar(undefined, {
        name: "Rob Erskine",
        email: "rob@roberskine.com",
      });
      expect(avatar.name).toBe("Rob Erskine");
      expect(avatar.initials).toBe("RE");
    });

    it("falls back to the email when the account has no name", () => {
      const avatar = resolveAvatar(undefined, {
        name: null,
        email: "rob@roberskine.com",
      });
      expect(avatar.name).toBe("rob@roberskine.com");
      expect(avatar.initials).toBe("R");
    });

    it("treats a blank account name as absent rather than rendering an empty header", () => {
      const avatar = resolveAvatar(undefined, {
        name: "   ",
        email: "rob@roberskine.com",
      });
      expect(avatar.name).toBe("rob@roberskine.com");
    });

    /**
     * The precedence that matters: Settings > Profile is something the user
     * explicitly typed on this device, so signing in must not silently
     * overwrite it with the provider's name.
     */
    it("prefers a local display name over the account's", () => {
      const avatar = resolveAvatar(
        { displayName: "Bob Smith" },
        { name: "Rob Erskine", email: "rob@roberskine.com" },
      );
      expect(avatar.name).toBe("Bob Smith");
      // Initials follow the winning name, not the account's ("RE").
      expect(avatar.initials).toBe("BS");
    });

    it("still reaches the placeholder when signed out with nothing set", () => {
      const avatar = resolveAvatar(undefined, undefined);
      expect(avatar.name).toBe("Local User");
      expect(avatar.initials).toBe("LU");
    });
  });
});
