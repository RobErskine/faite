// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserAvatar } from "./user-avatar";

vi.mock("@/lib/use-identity", () => ({ useIdentity: () => undefined }));

afterEach(cleanup);

/**
 * Inside the header's "Account" trigger the initials are decoration, not a
 * label (EI-377). Hiding them from assistive tech was not enough for
 * Lighthouse: axe's `label-content-name-mismatch` takes visible text from the
 * screen, so "LU" still failed WCAG 2.5.3 against "Account" in the fourth
 * critique (EI-391). Decorative, the glyph is CSS-generated content — no
 * text node at all.
 */
describe("UserAvatar", () => {
  it("draws decorative initials with CSS, leaving the trigger no text to mismatch", () => {
    render(
      <button type="button" aria-label="Account">
        <UserAvatar settings={undefined} decorative />
      </button>,
    );
    const trigger = screen.getByRole("button", { name: "Account" });
    expect(trigger.textContent).toBe("");
    const glyph = trigger.querySelector<HTMLElement>("[data-glyph]")!;
    expect(glyph.dataset.glyph).toBe("LU");
    expect(glyph.className).toContain("before:content-[attr(data-glyph)]");
    expect(glyph.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("writes them as text otherwise, as on the profile preview", () => {
    render(<UserAvatar settings={undefined} />);
    const initials = screen.getByText("LU");
    expect(initials.closest("[aria-hidden]")).toBeNull();
    expect(initials.hasAttribute("data-glyph")).toBe(false);
  });
});
