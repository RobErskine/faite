// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BoardEmptyBanner } from "./board-empty-banner";

afterEach(cleanup);

describe("BoardEmptyBanner", () => {
  it("announces the empty board as a status region, not an alert", () => {
    render(<BoardEmptyBanner />);
    expect(screen.getByRole("status").textContent).toMatch(/nothing on the board yet/i);
  });
});
