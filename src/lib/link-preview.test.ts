import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchLinkPreview } from "./link-preview";

describe("fetchLinkPreview", () => {
  const url = "https://example.com/page";

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves the meta from a successful response", async () => {
    const meta = { url, title: "Title", description: null, image: null, siteName: null, icon: null };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, meta }), { status: 200 }),
    );

    expect(await fetchLinkPreview(url)).toEqual(meta);
  });

  it("de-duplicates two concurrent requests for the same URL into one fetch", async () => {
    let resolveFetch!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const first = fetchLinkPreview(url);
    const second = fetchLinkPreview(url);

    expect(fetch).toHaveBeenCalledTimes(1);

    const meta = { url, title: null, description: null, image: null, siteName: null, icon: null };
    resolveFetch(new Response(JSON.stringify({ ok: true, meta }), { status: 200 }));

    expect(await first).toEqual(meta);
    expect(await second).toEqual(meta);
  });

  it("issues a fresh request once the previous one has settled", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: false }), { status: 200 }),
    );

    await fetchLinkPreview(url);
    await fetchLinkPreview(url);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("returns null on a non-200 response", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }));
    expect(await fetchLinkPreview(url)).toBeNull();
  });

  it("returns null on a { ok: false } body", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: false }), { status: 200 }),
    );
    expect(await fetchLinkPreview(url)).toBeNull();
  });

  it("returns null on a network error instead of throwing", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));
    await expect(fetchLinkPreview(url)).resolves.toBeNull();
  });
});
