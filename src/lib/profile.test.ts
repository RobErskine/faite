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
});
