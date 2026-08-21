import { describe, expect, it } from "vitest";
import { pageMetadata } from "./metadata";

describe("pageMetadata", () => {
  it("emits a complete openGraph object", () => {
    // Next REPLACES `openGraph` rather than merging it (mergeMetadata in
    // resolve-metadata.js). A partial object here means pages ship without
    // og:site_name / og:type / og:locale.
    const og = pageMetadata("/").openGraph!;
    expect(og).toMatchObject({ type: "website", siteName: "Faite", url: "/" });
    expect(og.title).toBeTruthy();
    expect(og.description).toBeTruthy();
  });

  it("omits `title` entirely for the home page rather than setting it undefined", () => {
    // The merge is a `for…in`: a present-but-undefined key still overwrites
    // the root layout's `title.default`, blanking <title> on "/".
    expect("title" in pageMetadata("/")).toBe(false);
  });

  it("never sets `twitter` — the card is pinned once in the root layout and the rest auto-fills", () => {
    expect(pageMetadata("/").twitter).toBeUndefined();
  });

  it("canonicalises relative to metadataBase", () => {
    expect(pageMetadata("/").alternates?.canonical).toBe("/");
  });

  it("throws for a path with no SITE_PAGES row", () => {
    expect(() => pageMetadata("/nope")).toThrow();
  });
});
