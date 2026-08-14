// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PLACE_SEARCH_DEBOUNCE_MS } from "@/components/places/use-place-search";
import { fetchPlaceDetails, fetchPlaceSuggestions } from "@/lib/places/transport";
import { createPlace } from "@/lib/store/repositories";
import { PlacesSection } from "./places-section";

vi.mock("@/lib/places/transport", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/places/transport")>("@/lib/places/transport");
  return { ...actual, fetchPlaceSuggestions: vi.fn(), fetchPlaceDetails: vi.fn() };
});
vi.mock("@/lib/store/repositories", () => ({
  createPlace: vi.fn(async () => "new-place-id"),
  deletePlace: vi.fn(),
}));
vi.mock("@/lib/store/hooks", () => ({ usePlaces: () => [] }));

const suggest = vi.mocked(fetchPlaceSuggestions);
const details = vi.mocked(fetchPlaceDetails);
const create = vi.mocked(createPlace);

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

const SUGGESTION = { placeId: "ChIJ_1", primary: "Blue Bottle Coffee", secondary: "300 Webster St" };
const RESOLVED = {
  placeId: "ChIJ_1",
  address: "300 Webster St, Oakland, CA 94607, USA",
  lat: 37.8,
  lng: -122.2,
};

const nameInput = () => document.getElementById("place-name") as HTMLInputElement;
const addressInput = () => document.getElementById("place-address") as HTMLInputElement;

function type(el: HTMLElement, value: string) {
  fireEvent.input(el, { target: { value }, inputType: "insertText" });
}

function selectOption(option: HTMLElement) {
  fireEvent.pointerDown(option, { pointerType: "mouse" });
  fireEvent.click(option);
}

/**
 * While the Autocomplete popup is open, Base UI hides the rest of the document
 * from the accessibility tree — so `getByRole("button", {name: "Add"})` cannot
 * see the submit button at all. Picking a suggestion closes the popup on its
 * own; a test that leaves a query sitting in the field has to close it the way
 * a user would, or it fails with a confusing "unable to find an accessible
 * element" rather than anything about the popup.
 */
function closePopup() {
  fireEvent.keyDown(addressInput(), { key: "Escape" });
}

async function settle(ms = PLACE_SEARCH_DEBOUNCE_MS) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await act(async () => {});
}

async function pickTheSuggestion() {
  type(addressInput(), "300 Web");
  await settle();
  await act(async () => {
    selectOption(screen.getByText("Blue Bottle Coffee").closest("[role=option]") as HTMLElement);
  });
  await act(async () => {});
}

beforeEach(() => {
  vi.useFakeTimers();
  suggest.mockResolvedValue([SUGGESTION]);
  details.mockResolvedValue(RESOLVED);
  create.mockResolvedValue("new-place-id");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("PlacesSection address lookup", () => {
  it("saves the resolved address with googlePlaceId, lat and lng", async () => {
    render(<PlacesSection />);
    await pickTheSuggestion();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
    });

    expect(create).toHaveBeenCalledWith("Blue Bottle Coffee", RESOLVED.address, {
      googlePlaceId: "ChIJ_1",
      lat: 37.8,
      lng: -122.2,
    });
  });

  it("pre-fills the nickname from the suggestion when it is still blank", async () => {
    render(<PlacesSection />);
    await pickTheSuggestion();
    expect(nameInput().value).toBe("Blue Bottle Coffee");
  });

  it("never overwrites a nickname the user already typed", async () => {
    render(<PlacesSection />);
    fireEvent.change(nameInput(), { target: { value: "The good coffee" } });
    await pickTheSuggestion();
    expect(nameInput().value).toBe("The good coffee");
  });

  it("REGRESSION: drops the Google link once the address is edited by hand", async () => {
    // Same rule LocationField applies to `placeId`: a stale link must never
    // outlive the text it was derived from, or a place gets saved with
    // coordinates that point somewhere else entirely.
    render(<PlacesSection />);
    await pickTheSuggestion();

    type(addressInput(), "somewhere else entirely");
    closePopup();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
    });

    expect(create).toHaveBeenCalledWith("Blue Bottle Coffee", "somewhere else entirely", {});
  });

  it("still saves a hand-typed address with no lookup at all", async () => {
    // Signed out, offline, or just a place not worth looking up.
    suggest.mockRejectedValue(new Error("offline"));
    render(<PlacesSection />);

    fireEvent.change(nameInput(), { target: { value: "The shed" } });
    type(addressInput(), "out back, past the compost");
    await settle();
    closePopup();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
    });

    expect(create).toHaveBeenCalledWith("The shed", "out back, past the compost", {});
  });

  it("requires a nickname before it will save", async () => {
    render(<PlacesSection />);
    type(addressInput(), "12 Elm St");
    await settle();
    closePopup();
    expect(screen.getByRole("button", { name: "Add" }).hasAttribute("disabled")).toBe(true);
  });
});
