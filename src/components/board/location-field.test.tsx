// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PLACE_SEARCH_DEBOUNCE_MS } from "@/components/places/use-place-search";
import { fetchPlaceDetails, fetchPlaceSuggestions } from "@/lib/places/transport";
import { createPlace } from "@/lib/store/repositories";
import { LocationField } from "./location-field";
import type { Place, Todo } from "@/lib/schema";

/**
 * `docs/PICKERS.md` §4 noted this file did not exist. It does now, because
 * EI-83 gave `LocationField` a list with three different kinds of row and a
 * network call sitting behind one of them — and the most important assertion
 * here is a NEGATIVE one: recall-by-nickname must never reach Google.
 */

vi.mock("@/lib/places/transport", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/places/transport")>("@/lib/places/transport");
  return { ...actual, fetchPlaceSuggestions: vi.fn(), fetchPlaceDetails: vi.fn() };
});
vi.mock("@/lib/store/repositories", () => ({ createPlace: vi.fn(async () => "new-place-id") }));

const suggest = vi.mocked(fetchPlaceSuggestions);
const details = vi.mocked(fetchPlaceDetails);
const create = vi.mocked(createPlace);

beforeAll(() => {
  // Base UI's Autocomplete positioner reaches for this, same as every other
  // floating-ui-backed popup stubbed elsewhere in this suite.
  Element.prototype.scrollIntoView = () => {};
});

const todo = (overrides: Partial<Todo> = {}): Todo => ({
  id: "t1",
  ownerId: "local-user",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  title: "Pick up the parcel",
  description: null,
  status: "open",
  priority: null,
  scheduledDate: null,
  scheduledAt: null,
  deadline: null,
  listId: null,
  projectId: null,
  labelIds: [],
  location: null,
  parentId: null,
  position: "a0",
  recurrenceRule: null,
  recurrenceParentId: null,
  completedAt: null,
  reminderTime: null,
  placeId: null,
  ...overrides,
});

const mkPlace = (id: string, name: string, address: string, googlePlaceId: string | null = null): Place => ({
  id,
  ownerId: "local-user",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  name,
  address,
  googlePlaceId,
  lat: null,
  lng: null,
});

const HOME = mkPlace("p1", "Home", "12 Elm St, Brooklyn, NY");
const SUGGESTION = { placeId: "ChIJ_1", primary: "Blue Bottle Coffee", secondary: "300 Webster St" };
const RESOLVED = {
  placeId: "ChIJ_1",
  address: "300 Webster St, Oakland, CA 94607, USA",
  lat: 37.8,
  lng: -122.2,
};

const input = () => document.getElementById("todo-location-input")!;

/** Base UI's Item only commits a click that started with a pointerdown on the
 * item itself — a bare `fireEvent.click()` is ignored. */
function selectOption(option: HTMLElement) {
  fireEvent.pointerDown(option, { pointerType: "mouse" });
  fireEvent.click(option);
}

/**
 * Base UI's Autocomplete only opens on a genuine typed `input` event: it reads
 * `nativeEvent.inputType`, which `fireEvent.change` never sets. See
 * `docs/PICKERS.md` §4.
 */
function type(el: HTMLElement, value: string) {
  fireEvent.input(el, { target: { value }, inputType: "insertText" });
}

/** Past the debounce, then a pass for the promise chain the effect started. */
async function settle(ms = PLACE_SEARCH_DEBOUNCE_MS) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
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

describe("recall by nickname stays free", () => {
  it("REGRESSION: typing a prefix of a saved nickname never calls Google", async () => {
    // The whole point of saving a place: reusing it is a local Dexie read,
    // costing nothing and working offline (docs/LOCATION.md §5).
    render(<LocationField todo={todo()} places={[HOME]} onSave={vi.fn()} />);

    type(input(), "Ho");
    await settle();

    expect(suggest).not.toHaveBeenCalled();
    expect(screen.getByText("Home")).toBeTruthy();
  });

  it("matches the nickname case-insensitively", async () => {
    render(<LocationField todo={todo()} places={[HOME]} onSave={vi.fn()} />);
    type(input(), "hOm");
    await settle();
    expect(suggest).not.toHaveBeenCalled();
  });

  it("DOES call Google for text that only matches a saved ADDRESS", async () => {
    // Deliberately not "any local match". The list filter also matches on
    // address, and an address-substring hit is exactly the case where the user
    // is typing a real address and does want suggestions.
    render(<LocationField todo={todo()} places={[HOME]} onSave={vi.fn()} />);

    type(input(), "12 Elm");
    await settle();

    expect(suggest).toHaveBeenCalledTimes(1);
  });
});

describe("the three kinds of row", () => {
  it("offers saved places, then Google suggestions, then the create row", async () => {
    render(<LocationField todo={todo()} places={[HOME]} onSave={vi.fn()} />);

    type(input(), "12 Elm");
    await settle();

    const rows = screen.getAllByRole("option").map((el) => el.textContent ?? "");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("Home");
    expect(rows[1]).toContain("Blue Bottle Coffee");
    expect(rows[2]).toContain("Save “12 Elm” as a place…");
  });

  it("REGRESSION: does not offer a suggestion that is already saved", async () => {
    // Offering it twice would be a worse version of the saved row, which at
    // least carries the user's own nickname.
    const saved = mkPlace("p2", "The coffee place", "300 Webster St", "ChIJ_1");
    render(<LocationField todo={todo()} places={[saved]} onSave={vi.fn()} />);

    type(input(), "300 Web");
    await settle();

    const rows = screen.getAllByRole("option").map((el) => el.textContent ?? "");
    expect(rows.filter((r) => r.includes("Blue Bottle Coffee"))).toHaveLength(0);
    expect(rows[0]).toContain("The coffee place");
  });

  it("shows no create row until something has been typed", async () => {
    render(<LocationField todo={todo()} places={[HOME]} onSave={vi.fn()} />);
    fireEvent.click(input());
    await settle();
    expect(screen.queryByText(/as a place/)).toBeNull();
  });
});

describe("picking a Google suggestion", () => {
  it("commits the optimistic label immediately, then the canonical address", async () => {
    const onSave = vi.fn();
    render(<LocationField todo={todo()} places={[]} onSave={onSave} />);

    type(input(), "300 Web");
    await settle();

    await act(async () => {
      selectOption(screen.getByText("Blue Bottle Coffee").closest("[role=option]") as HTMLElement);
    });
    await act(async () => {});

    // Base UI fills the input synchronously, so the optimistic value must be
    // committed too — a failed Details call must still leave usable text.
    expect(onSave.mock.calls[0]).toEqual([
      "t1",
      { location: "Blue Bottle Coffee, 300 Webster St", placeId: null },
    ]);
    expect(onSave).toHaveBeenLastCalledWith("t1", {
      location: RESOLVED.address,
      placeId: null,
    });
  });

  it("opens the nickname prompt pre-filled from the suggestion, not from displayName", async () => {
    // This pre-fill is why the Place Details field mask can stay on the
    // Essentials SKU — `displayName` would promote every call to Pro.
    render(<LocationField todo={todo()} places={[]} onSave={vi.fn()} />);

    type(input(), "300 Web");
    await settle();
    await act(async () => {
      selectOption(screen.getByText("Blue Bottle Coffee").closest("[role=option]") as HTMLElement);
    });
    await act(async () => {});

    const nickname = document.getElementById("todo-location-nickname") as HTMLInputElement;
    expect(nickname.value).toBe("Blue Bottle Coffee");
  });

  it("marks saving-as-a-place as optional, and lets you skip it", async () => {
    // The prompt appears unbidden after a pick, so it has to be obvious that
    // ignoring it is fine — the address is already on the todo by this point.
    const onSave = vi.fn();
    render(<LocationField todo={todo()} places={[]} onSave={onSave} />);

    type(input(), "300 Web");
    await settle();
    await act(async () => {
      selectOption(screen.getByText("Blue Bottle Coffee").closest("[role=option]") as HTMLElement);
    });
    await act(async () => {});

    const label = document.querySelector('label[for="todo-location-nickname"]')!;
    expect(label.textContent).toContain("(optional)");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    // Skipping saves no place, but the resolved address stays on the todo.
    expect(create).not.toHaveBeenCalled();
    expect(document.getElementById("todo-location-nickname")).toBeNull();
    expect(onSave).toHaveBeenLastCalledWith("t1", {
      location: RESOLVED.address,
      placeId: null,
    });
  });

  it("saves the place with googlePlaceId, lat and lng in ONE write", async () => {
    const onSave = vi.fn();
    render(<LocationField todo={todo()} places={[]} onSave={onSave} />);

    type(input(), "300 Web");
    await settle();
    await act(async () => {
      selectOption(screen.getByText("Blue Bottle Coffee").closest("[role=option]") as HTMLElement);
    });
    await act(async () => {});

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith("Blue Bottle Coffee", RESOLVED.address, {
      googlePlaceId: "ChIJ_1",
      lat: 37.8,
      lng: -122.2,
    });
  });

  it("keeps the optimistic text and skips the prompt when Details fails", async () => {
    details.mockRejectedValue(new Error("boom"));
    const onSave = vi.fn();
    render(<LocationField todo={todo()} places={[]} onSave={onSave} />);

    type(input(), "300 Web");
    await settle();
    await act(async () => {
      selectOption(screen.getByText("Blue Bottle Coffee").closest("[role=option]") as HTMLElement);
    });
    await act(async () => {});

    expect(onSave).toHaveBeenCalledWith("t1", {
      location: "Blue Bottle Coffee, 300 Webster St",
      placeId: null,
    });
    expect(document.getElementById("todo-location-nickname")).toBeNull();
  });
});

describe("clearing the location", () => {
  const clearButton = () => screen.queryByRole("button", { name: "Clear location" });

  it("offers no clear button on an empty field", () => {
    // A control that does nothing is worse than no control.
    render(<LocationField todo={todo()} places={[]} onSave={vi.fn()} />);
    expect(clearButton()).toBeNull();
  });

  it("offers one as soon as there is something to clear", () => {
    render(<LocationField todo={todo({ location: "12 Elm St" })} places={[]} onSave={vi.fn()} />);
    expect(clearButton()).toBeTruthy();
  });

  it("clears the text and drops both location and placeId", async () => {
    const onSave = vi.fn();
    render(
      <LocationField
        todo={todo({ location: HOME.address, placeId: "p1" })}
        places={[HOME]}
        onSave={onSave}
      />,
    );

    await act(async () => {
      fireEvent.click(clearButton()!);
    });

    expect(onSave).toHaveBeenCalledWith("t1", { location: null, placeId: null });
    expect((input() as HTMLInputElement).value).toBe("");
    expect(clearButton()).toBeNull();
  });

  it("REGRESSION: commits immediately rather than waiting for blur", async () => {
    // Typing commits on blur, but clicking the button does not reliably blur
    // the input — deferring would leave the field looking empty while the todo
    // still carried its old location.
    const onSave = vi.fn();
    render(<LocationField todo={todo({ location: "12 Elm St" })} places={[]} onSave={onSave} />);

    await act(async () => {
      fireEvent.click(clearButton()!);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("does not write when there was nothing stored to begin with", async () => {
    // Text typed but never committed: clearing it is a no-op for the todo.
    const onSave = vi.fn();
    render(<LocationField todo={todo()} places={[]} onSave={onSave} />);

    type(input(), "half-typed");
    // Typing opens the popup, and Base UI then hides the rest of the document
    // from the accessibility tree — so the clear button is unreachable by role
    // until the popup closes. See docs/PICKERS.md §4.
    fireEvent.keyDown(input(), { key: "Escape" });

    await act(async () => {
      fireEvent.click(clearButton()!);
    });

    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("hand entry never depends on the network", () => {
  it("the create row still saves a hand-typed address with no google fields", async () => {
    // The ticket's second acceptance criterion: hand entry still works with no
    // network. This is the path a signed-out or offline user takes.
    suggest.mockRejectedValue(new Error("offline"));
    const onSave = vi.fn();
    render(<LocationField todo={todo()} places={[]} onSave={onSave} />);

    type(input(), "the shed out back");
    await settle();

    await act(async () => {
      selectOption(screen.getByText(/as a place/).closest("[role=option]") as HTMLElement);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(create).toHaveBeenCalledWith("the shed out back", "the shed out back", {});
    expect(onSave).toHaveBeenLastCalledWith("t1", {
      placeId: "new-place-id",
      location: "the shed out back",
    });
  });

  it("picking a saved place links it without any network call", async () => {
    const onSave = vi.fn();
    render(<LocationField todo={todo()} places={[HOME]} onSave={onSave} />);

    type(input(), "Ho");
    await settle();
    await act(async () => {
      selectOption(screen.getByText("Home").closest("[role=option]") as HTMLElement);
    });

    expect(onSave).toHaveBeenCalledWith("t1", { placeId: "p1", location: HOME.address });
    expect(suggest).not.toHaveBeenCalled();
    expect(details).not.toHaveBeenCalled();
  });
});
