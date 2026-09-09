// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { serializeSource } from "@/lib/capture-source";
import { CaptureSourceBadge } from "./capture-source-badge";

afterEach(cleanup);

const AT = "2026-08-17T12:00:00.000Z";

describe("CaptureSourceBadge", () => {
  it("renders nothing when the todo was created by hand", () => {
    const { container } = render(<CaptureSourceBadge source={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for a malformed blob rather than throwing", () => {
    const { container } = render(<CaptureSourceBadge source="{not json" />);
    expect(container.innerHTML).toBe("");
  });

  it("names the sender for an email capture", () => {
    render(
      <CaptureSourceBadge
        source={serializeSource({
          v: 1,
          kind: "email",
          at: AT,
          email: { from: "coach@example.com", subject: "Practice" },
        })}
      />,
    );
    expect(screen.getByText("From email · coach@example.com")).toBeTruthy();
  });

  it("falls back to the bare label when an email capture has no sender", () => {
    render(<CaptureSourceBadge source={serializeSource({ v: 1, kind: "email", at: AT })} />);
    expect(screen.getByText("From email")).toBeTruthy();
  });

  /**
   * The contract in `capture-source.ts`: an unrecognized kind is generic
   * capture, never a throw. This is what lets a client shipped today survive
   * a blob written by a client shipped next year.
   */
  it("renders 'Captured' for a kind this build has never heard of, and does not throw", () => {
    expect(() =>
      render(
        <CaptureSourceBadge
          source={serializeSource({ v: 1, kind: "share-sheet-from-the-future", at: AT })}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByText("Captured")).toBeTruthy();
  });

  it("renders nothing for a future schema version", () => {
    const { container } = render(
      <CaptureSourceBadge source={JSON.stringify({ v: 2, kind: "email", at: AT })} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("handles the D5 desktop kinds it was built generic for", () => {
    const { rerender } = render(
      <CaptureSourceBadge
        source={serializeSource({ v: 1, kind: "browser", at: AT, pageTitle: "Docs" })}
      />,
    );
    expect(screen.getByText("From browser · Docs")).toBeTruthy();

    rerender(
      <CaptureSourceBadge
        source={serializeSource({ v: 1, kind: "app", at: AT, app: { name: "Figma" } })}
      />,
    );
    expect(screen.getByText("From app · Figma")).toBeTruthy();
  });

  /**
   * EI-312. The Raycast extension's Quick Add is the first writer of a
   * browser capture, and the URL is the whole point — a to-do that says
   * "From browser · Amazon" without a way back to the page is decorative.
   */
  describe("browser captures link back", () => {
    const browserSource = (url: string, pageTitle?: string) =>
      serializeSource({ v: 1, kind: "browser", at: AT, url, pageTitle });

    it("renders the page title as a link to the page", () => {
      render(<CaptureSourceBadge source={browserSource("https://example.test/thing", "A Thing")} />);

      const link = screen.getByRole("link");
      expect(link.getAttribute("href")).toBe("https://example.test/thing");
      expect(link.textContent).toContain("A Thing");
    });

    it("falls back to the URL as the label when there is no page title", () => {
      render(<CaptureSourceBadge source={browserSource("https://example.test/thing")} />);

      expect(screen.getByRole("link").textContent).toContain("https://example.test/thing");
    });

    it("opens in a new tab without leaking the referrer", () => {
      render(<CaptureSourceBadge source={browserSource("https://example.test/")} />);

      const link = screen.getByRole("link");
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noreferrer");
      expect(link.getAttribute("rel")).toContain("noopener");
    });

    /**
     * SECURITY. `url` is an open `z.string()` on a blob this build did not
     * write — it arrives over sync from the Raycast extension today and from
     * who-knows-what later. Rendering it into an `href` unchecked would make
     * `javascript:` a live XSS vector through a synced field.
     */
    it("REFUSES to link a non-http scheme, but still shows the text", () => {
      for (const url of ["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd"]) {
        cleanup();
        render(<CaptureSourceBadge source={browserSource(url, "Looks innocent")} />);

        expect(screen.queryByRole("link"), url).toBeNull();
        expect(screen.getByText(/Looks innocent/)).toBeTruthy();
      }
    });

    it("does not link an unparseable URL, and does not throw", () => {
      render(<CaptureSourceBadge source={browserSource("not a url", "Whatever")} />);

      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.getByText(/Whatever/)).toBeTruthy();
    });

    /** Only browser captures have somewhere to point. */
    it("leaves the other kinds as plain text", () => {
      render(
        <CaptureSourceBadge
          source={serializeSource({ v: 1, kind: "app", at: AT, app: { name: "Slack" } })}
        />,
      );

      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.getByText(/Slack/)).toBeTruthy();
    });
  });

});