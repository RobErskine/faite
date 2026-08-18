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
});
