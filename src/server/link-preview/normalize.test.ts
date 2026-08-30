import { describe, expect, it } from "vitest";
import { normalizeLinkPreviewMeta } from "./normalize";

describe("normalizeLinkPreviewMeta", () => {
  const finalUrl = "https://example.com/page";

  it("prefers og: tags over fallbacks", () => {
    const meta = normalizeLinkPreviewMeta(
      {
        ogTitle: "OG Title",
        title: "<title> Title",
        ogDescription: "OG description",
        description: "meta description",
        ogSiteName: "Example",
      },
      finalUrl,
    );
    expect(meta.title).toBe("OG Title");
    expect(meta.description).toBe("OG description");
    expect(meta.siteName).toBe("Example");
  });

  it("falls back through twitter: then <title> when og: is absent", () => {
    const meta = normalizeLinkPreviewMeta(
      { twitterTitle: "Twitter Title", title: "Doc Title" },
      finalUrl,
    );
    expect(meta.title).toBe("Twitter Title");

    const meta2 = normalizeLinkPreviewMeta({ title: "Doc Title" }, finalUrl);
    expect(meta2.title).toBe("Doc Title");
  });

  it("returns null fields when nothing is present", () => {
    const meta = normalizeLinkPreviewMeta({}, finalUrl);
    expect(meta).toEqual({
      url: finalUrl,
      title: null,
      description: null,
      image: null,
      siteName: null,
      icon: null,
    });
  });

  it("resolves a relative image URL against the final response URL", () => {
    const meta = normalizeLinkPreviewMeta({ ogImage: "/static/card.png" }, finalUrl);
    expect(meta.image).toBe("https://example.com/static/card.png");
  });

  it("resolves a protocol-relative image URL", () => {
    const meta = normalizeLinkPreviewMeta({ ogImage: "//cdn.example.com/card.png" }, finalUrl);
    expect(meta.image).toBe("https://cdn.example.com/card.png");
  });

  it("prefers og:image over twitter:image", () => {
    const meta = normalizeLinkPreviewMeta(
      { ogImage: "https://example.com/og.png", twitterImage: "https://example.com/tw.png" },
      finalUrl,
    );
    expect(meta.image).toBe("https://example.com/og.png");
  });

  it("drops a non-http(s) image URL", () => {
    const meta = normalizeLinkPreviewMeta({ ogImage: "javascript:alert(1)" }, finalUrl);
    expect(meta.image).toBeNull();
  });

  it("drops an unparseable image URL", () => {
    const meta = normalizeLinkPreviewMeta({ ogImage: "   " }, finalUrl);
    expect(meta.image).toBeNull();
  });

  it("truncates a long title and description", () => {
    const longTitle = "a".repeat(500);
    const longDescription = "b".repeat(500);
    const meta = normalizeLinkPreviewMeta(
      { ogTitle: longTitle, ogDescription: longDescription },
      finalUrl,
    );
    expect(meta.title?.length).toBeLessThanOrEqual(200);
    expect(meta.title?.endsWith("…")).toBe(true);
    expect(meta.description?.length).toBeLessThanOrEqual(300);
    expect(meta.description?.endsWith("…")).toBe(true);
  });

  it("trims whitespace-only tags to null instead of an empty string", () => {
    const meta = normalizeLinkPreviewMeta({ ogTitle: "   ", ogDescription: "\n\t" }, finalUrl);
    expect(meta.title).toBeNull();
    expect(meta.description).toBeNull();
  });

  it("resolves the icon URL the same way as the image", () => {
    const meta = normalizeLinkPreviewMeta({ icon: "/favicon.ico" }, finalUrl);
    expect(meta.icon).toBe("https://example.com/favicon.ico");
  });
});
