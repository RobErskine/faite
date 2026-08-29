// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { List, Todo } from "@/lib/schema";
import type { PlacementContext } from "@/lib/scheduling";
import type { Verdict } from "@/lib/overdrive";

interface ToastCallOptions {
  id?: string;
  duration?: number;
  position?: string;
  action?: { label: string; onClick: () => void };
}
const toastSuccess = vi.fn<(message: string, options?: ToastCallOptions) => string>(
  () => "toast-id",
);
const toastDismiss = vi.fn();
vi.mock("sonner", () => ({ toast: { success: toastSuccess, dismiss: toastDismiss } }));

// Dynamic, after the mock and its backing spies above are already in place —
// a static top-level import here would get hoisted alongside `vi.mock`
// itself (vitest hoists every `vi.mock` above every static import in the
// file), reaching `overdrive-overlay.tsx`'s own `import { toast } from
// "sonner"` before `toastSuccess`/`toastDismiss` have been assigned. Same
// fix `developer-section.test.tsx` uses for the same reason.
const { OverdriveOverlay } = await import("./overdrive-overlay");

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  toastSuccess.mockClear();
  toastDismiss.mockClear();
  // Scoped to setTimeout/clearTimeout only — leaves Base UI's own
  // Sheet/Popover open-close machinery (RAF/CSS-transition driven) alone,
  // and fakes exactly what `triggerFlick` (overdrive-overlay.tsx) uses to
  // gate the queue advance behind the flick animation (round 3).
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const ctx: PlacementContext = {
  today: "2026-08-10",
  visibleWindow: ["2026-08-10"],
  workdaysOnly: false,
  workdays: [1, 2, 3, 4, 5],
  overflowAfterDays: 3,
};

const todo = (overrides: Partial<Todo> & { id: string }): Todo => ({
  ownerId: "local-user",
  createdAt: "2026-08-01T09:00:00.000Z",
  updatedAt: "2026-08-01T09:00:00.000Z",
  deletedAt: null,
  title: overrides.id,
  description: null,
  status: "open",
  priority: null,
  scheduledDate: "2026-08-01",
  scheduledAt: null,
  deadline: null,
  listId: "list-1",
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
  source: null,
  ...overrides,
});

const list = (id: string, name: string): List => ({
  id,
  ownerId: "local-user",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  deletedAt: null,
  name,
  isBacklog: false,
  archivedAt: null,
  archivedWithTabId: null,
  position: "a0",
  tabId: "tab-1",
  defaultReminderPresetId: null,
  description: null,
  color: null,
  emoji: null,
  iconUrl: null,
});

const TODOS = [todo({ id: "t1", listId: "list-1" }), todo({ id: "t2", listId: null })];
const LISTS = [list("list-1", "Brain Dump"), { ...list("list-backlog", "Backlog"), isBacklog: true }];

interface HarnessOptions {
  onClose?: () => void;
  onVerdict?: (todo: Todo, verdict: Verdict) => { undoId: string; label: string };
  /** EI-103 — omitted (undefined) exercises the component's own `= 0`
   * default, same as every caller that predates this prop. */
  autoConfirmMs?: number;
}

function renderOverlay({ onClose = vi.fn(), onVerdict, autoConfirmMs }: HarnessOptions = {}) {
  const todosById = new Map(TODOS.map((t) => [t.id, t]));
  const listsById = new Map(LISTS.map((l) => [l.id, l]));
  const verdictSpy = onVerdict ?? vi.fn(() => ({ undoId: "undo-1", label: "Decided" }));

  render(
    <TooltipProvider>
      <OverdriveOverlay
        open
        todos={TODOS}
        todosById={todosById}
        listsById={listsById}
        backlogListId="list-backlog"
        labels={[]}
        ctx={ctx}
        onClose={onClose}
        onVerdict={verdictSpy}
        autoConfirmMs={autoConfirmMs}
      />
    </TooltipProvider>,
  );

  return { onClose, verdictSpy };
}

const dialog = () => screen.getByRole("dialog");
const press = (key: string, opts: Partial<KeyboardEvent> = {}) =>
  fireEvent.keyDown(dialog(), { key, ...opts });
/**
 * The flick (round 3) is a genuine blocking transition: pressing a verdict
 * key shows the OUTGOING card mid-flight and `session` does not advance —
 * nor does the toast's Undo, `⌫`, or `⌘Z` do anything — until this fires.
 * Every test that commits a verdict and then wants to see the RESULT calls
 * this in between.
 *
 * **This drives the FALLBACK path, not the normal one.** In a real browser
 * the flick ends on the card's own `animationend` (round 4 — see
 * `FLICK_FALLBACK_MS`); jsdom runs no CSS animations, so that event never
 * arrives here and `FLICK_FALLBACK_MS` (1000) is what completes it. `1100`
 * clears that with room to spare. `endFlickByAnimation()` below is what
 * covers the path real users actually get.
 */
const flushFlick = () =>
  act(() => {
    vi.advanceTimersByTime(1100);
  });
/**
 * The NORMAL completion path: fire the `animationend` the browser would.
 * Dispatched on the flicking wrapper itself, since `onAnimationEnd` ignores
 * anything that merely bubbled up from a child.
 */
const endFlickByAnimation = () => {
  const card = dialog().querySelector(".animate-out");
  if (!card) throw new Error("no flicking card found");
  act(() => {
    fireEvent.animationEnd(card);
  });
};
// Two <h2>s can legitimately coexist for the flick window doesn't actually
// arise any more (only one card is ever mounted at a time, round 3) — but
// `getByRole` stays the right tool regardless, since it's also what
// excludes the sr-only "Overdrive" `SheetTitle` heading.
const titleHeading = (name: string) => screen.getByRole("heading", { name });

describe("OverdriveOverlay", () => {
  it("renders nothing when closed", () => {
    render(
      <TooltipProvider>
        <OverdriveOverlay
          open={false}
          todos={TODOS}
          todosById={new Map()}
          listsById={new Map()}
          backlogListId="list-backlog"
          labels={[]}
          ctx={ctx}
          onClose={vi.fn()}
          onVerdict={vi.fn()}
        />
      </TooltipProvider>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the first card in board order, with a progress readout", () => {
    renderOverlay();
    expect(titleHeading("t1")).toBeTruthy();
    expect(screen.getByText("1 of 2")).toBeTruthy();
  });

  it("← commits a dropped verdict; the next card is ready once the flick finishes", () => {
    const { verdictSpy } = renderOverlay();
    press("ArrowLeft");
    expect(verdictSpy).toHaveBeenCalledWith(TODOS[0], { kind: "dropped" }, null);
    flushFlick();
    expect(titleHeading("t2")).toBeTruthy();
    expect(screen.getByText("2 of 2")).toBeTruthy();
  });

  it("↑ commits a done verdict", () => {
    const { verdictSpy } = renderOverlay();
    press("ArrowUp");
    expect(verdictSpy).toHaveBeenCalledWith(TODOS[0], { kind: "done" }, null);
  });

  it("↓ commits the todo's own list", () => {
    const { verdictSpy } = renderOverlay();
    press("ArrowDown");
    expect(verdictSpy).toHaveBeenCalledWith(TODOS[0], { kind: "listed", listId: "list-1" }, null);
  });

  it("⇧↓ forces Backlog even though the todo has a list", () => {
    const { verdictSpy } = renderOverlay();
    press("ArrowDown", { shiftKey: true });
    expect(verdictSpy).toHaveBeenCalledWith(TODOS[0], { kind: "listed", listId: "list-backlog" }, null);
  });

  it("→ stages a day and writes nothing until Enter", () => {
    const { verdictSpy } = renderOverlay();
    press("ArrowRight");
    expect(verdictSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/schedule for/i)).toBeTruthy();
    expect(screen.getByText("Today")).toBeTruthy();
  });

  it("→ → then Enter schedules tomorrow, not today", () => {
    const { verdictSpy } = renderOverlay();
    press("ArrowRight");
    press("ArrowRight");
    expect(screen.getByText("Tomorrow")).toBeTruthy();
    press("Enter");
    expect(verdictSpy).toHaveBeenCalledWith(TODOS[0], { kind: "scheduled", date: "2026-08-11" }, null);
  });

  it("Enter with nothing staged writes nothing", () => {
    const { verdictSpy } = renderOverlay();
    press("Enter");
    expect(verdictSpy).not.toHaveBeenCalled();
    expect(titleHeading("t1")).toBeTruthy();
  });

  it("Escape clears a staged ramp instead of exiting", () => {
    const { onClose } = renderOverlay();
    press("ArrowRight");
    expect(screen.getByText(/schedule for/i)).toBeTruthy();
    press("Escape");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText(/schedule for/i)).toBeNull();
  });

  describe("auto-confirm delay (EI-103)", () => {
    it("is off by default — no auto-commit no matter how long a stage sits", () => {
      const { verdictSpy } = renderOverlay();
      press("ArrowRight");
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(verdictSpy).not.toHaveBeenCalled();
    });

    it("commits the staged day on its own once the configured delay elapses", () => {
      const { verdictSpy } = renderOverlay({ autoConfirmMs: 2000 });
      press("ArrowRight"); // stages "Today"
      expect(verdictSpy).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(verdictSpy).toHaveBeenCalledWith(TODOS[0], { kind: "scheduled", date: "2026-08-10" }, null);
    });

    it("further ramp input restarts the countdown rather than stacking with it", () => {
      const { verdictSpy } = renderOverlay({ autoConfirmMs: 2000 });
      press("ArrowRight"); // stages "Today"
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(verdictSpy).not.toHaveBeenCalled();
      press("ArrowRight"); // re-stages "Tomorrow" — restarts the timer
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      // The ORIGINAL 2000ms window would have elapsed by now (1500 + 1500),
      // but the restage reset the clock, so only 1500ms has passed since.
      expect(verdictSpy).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(verdictSpy).toHaveBeenCalledWith(TODOS[0], { kind: "scheduled", date: "2026-08-11" }, null);
    });

    it("clearing the stage (Escape) cancels the pending auto-confirm", () => {
      const { verdictSpy } = renderOverlay({ autoConfirmMs: 2000 });
      press("ArrowRight");
      press("Escape");
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(verdictSpy).not.toHaveBeenCalled();
    });

    it("shows the auto-confirm hint only when a delay is configured", () => {
      renderOverlay({ autoConfirmMs: 2000 });
      press("ArrowRight");
      expect(screen.getByText(/auto-confirms/i)).toBeTruthy();
    });

    it("shows no auto-confirm hint when the delay is off", () => {
      renderOverlay();
      press("ArrowRight");
      expect(screen.queryByText(/auto-confirms/i)).toBeNull();
    });
  });

  it("shows a finish state once the queue is exhausted", () => {
    renderOverlay();
    press("ArrowLeft"); // t1
    flushFlick();
    press("ArrowLeft"); // t2
    flushFlick();
    expect(screen.getByText(/cleared 2/i)).toBeTruthy();
  });

  it("the finish screen breaks the tally down by verdict", () => {
    renderOverlay();
    press("ArrowLeft"); // t1 -> won't do
    flushFlick();
    press("ArrowUp"); // t2 -> done
    flushFlick();
    expect(screen.getByText(/1 won’t do/i)).toBeTruthy();
    expect(screen.getByText(/1 done/i)).toBeTruthy();
  });

  it("Done on the finish screen closes the overlay", () => {
    const { onClose } = renderOverlay();
    press("ArrowLeft");
    flushFlick();
    press("ArrowLeft");
    flushFlick();
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("Enter on the finish screen also closes the overlay (round 4)", () => {
    const { onClose } = renderOverlay();
    press("ArrowLeft");
    flushFlick();
    press("ArrowLeft");
    flushFlick();
    expect(screen.getByText(/cleared 2/i)).toBeTruthy();
    press("Enter");
    expect(onClose).toHaveBeenCalled();
  });

  it("⌫ still works from the finish screen — Enter's new close behavior doesn't shadow it", () => {
    renderOverlay();
    press("ArrowLeft"); // t1
    flushFlick();
    press("ArrowLeft"); // t2
    flushFlick();
    expect(screen.getByText(/cleared 2/i)).toBeTruthy();

    press("Backspace");
    expect(titleHeading("t2")).toBeTruthy();
    expect(screen.getByText("2 of 2")).toBeTruthy();
  });

  it("⌫ steps back to the previous card and reverses its verdict", () => {
    const { verdictSpy } = renderOverlay();
    press("ArrowLeft"); // t1 dropped
    flushFlick(); // ... and only now is t2 current
    expect(titleHeading("t2")).toBeTruthy();

    press("Backspace"); // step-back is instant, no flick of its own
    expect(titleHeading("t1")).toBeTruthy();
    expect(screen.getByText("1 of 2")).toBeTruthy();

    // Stepping back again with nothing left decided is a no-op.
    press("Backspace");
    expect(titleHeading("t1")).toBeTruthy();
    expect(verdictSpy).toHaveBeenCalledTimes(1);
  });

  it("clamps the ramp at RAMP_MAX instead of wrapping back to today", () => {
    renderOverlay();
    for (let i = 0; i < 40; i++) press("ArrowRight");
    expect(screen.queryByText("Today")).toBeNull();
    expect(screen.getByText(/schedule for/i)).toBeTruthy();
  });

  it("D opens the date picker", () => {
    renderOverlay();
    press("d");
    expect(screen.getByRole("dialog", { name: /overdrive/i })).toBeTruthy();
    // react-day-picker renders a grid; its presence is the picker having opened.
    expect(document.querySelector(".rdp-root, [data-slot='calendar']")).toBeTruthy();
  });

  it("clicking the date picker button opens it too", () => {
    renderOverlay();
    fireEvent.click(screen.getByRole("button", { name: /pick a date/i }));
    expect(document.querySelector(".rdp-root, [data-slot='calendar']")).toBeTruthy();
  });
});

describe("stage-aware wontDo (round 2 — overshoot fix)", () => {
  it("← while a ramp is staged decrements it instead of committing", () => {
    const { verdictSpy } = renderOverlay();
    press("ArrowRight");
    press("ArrowRight"); // staged: Tomorrow
    press("ArrowLeft");
    expect(verdictSpy).not.toHaveBeenCalled();
    expect(screen.getByText("Today")).toBeTruthy();
  });

  it("← at the first staged step clears the stage entirely, not negative", () => {
    const { verdictSpy } = renderOverlay();
    press("ArrowRight"); // staged: Today (offset 0)
    press("ArrowLeft");
    expect(verdictSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/schedule for/i)).toBeNull();
  });

  it("the Won't do BUTTON, not just the key, also steps back while staged", () => {
    const { verdictSpy } = renderOverlay();
    press("ArrowRight"); // staged: Today
    fireEvent.click(screen.getByRole("button", { name: /won.t do/i }));
    expect(verdictSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/schedule for/i)).toBeNull();
  });

  it("← with nothing staged still commits wontDo, exactly as before", () => {
    const { verdictSpy } = renderOverlay();
    press("ArrowLeft");
    expect(verdictSpy).toHaveBeenCalledWith(TODOS[0], { kind: "dropped" }, null);
  });
});

describe("⌘Z (round 2)", () => {
  it("steps back the most recent decision, same as ⌫", () => {
    renderOverlay();
    press("ArrowLeft"); // t1 dropped
    flushFlick(); // now on t2
    expect(titleHeading("t2")).toBeTruthy();
    press("z", { metaKey: true });
    expect(titleHeading("t1")).toBeTruthy();
    expect(screen.getByText("1 of 2")).toBeTruthy();
  });

  it("Ctrl+Z works too", () => {
    renderOverlay();
    press("ArrowLeft");
    flushFlick();
    press("z", { ctrlKey: true });
    expect(titleHeading("t1")).toBeTruthy();
  });

  it("ignores Ctrl+Meta+Z — not a valid chord", () => {
    renderOverlay();
    press("ArrowLeft");
    flushFlick();
    press("z", { metaKey: true, ctrlKey: true });
    expect(titleHeading("t2")).toBeTruthy(); // unchanged
  });

  it("is ignored entirely while a flick is in flight, same as any other key", () => {
    renderOverlay();
    press("ArrowLeft"); // now mid-flick, t1 still technically "current"
    press("z", { metaKey: true }); // must not step back a decision that hasn't landed yet
    flushFlick();
    // If ⌘Z had gone through, decided.length would be 0 and t1 would still
    // be showing. It went through to t2 instead — proof the ⌘Z was dropped.
    expect(titleHeading("t2")).toBeTruthy();
  });
});

describe("the persistent decision toast (round 2)", () => {
  it("shows a toast with an Undo action after a commit", () => {
    renderOverlay();
    press("ArrowLeft");
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    const [message, options] = toastSuccess.mock.calls[0];
    expect(message).toBe("Decided");
    expect(options).toMatchObject({
      duration: Infinity,
      position: "bottom-center",
      action: { label: "Undo" },
    });
  });

  it("replaces the toast in place across decisions — one toast, not a stack", () => {
    renderOverlay();
    press("ArrowLeft");
    flushFlick(); // the second press needs the first flick clear to register at all
    press("ArrowUp");
    expect(toastSuccess).toHaveBeenCalledTimes(2);
    const [, firstOptions] = toastSuccess.mock.calls[0];
    const [, secondOptions] = toastSuccess.mock.calls[1];
    expect(firstOptions?.id).toBeDefined();
    expect(firstOptions?.id).toBe(secondOptions?.id);
  });

  it("the toast's own Undo action steps back exactly like ⌫", () => {
    renderOverlay();
    press("ArrowLeft"); // t1 dropped
    flushFlick(); // now on t2
    expect(titleHeading("t2")).toBeTruthy();

    // Invoked directly (this is a plain captured callback, not a DOM node),
    // so — unlike `press()`, which goes through `fireEvent` and gets `act()`
    // wrapping for free — the resulting `setSession` needs an explicit
    // `act()` here or the update lands a tick after this assertion checks.
    const [, lastOptions] = toastSuccess.mock.calls.at(-1)!;
    act(() => lastOptions?.action?.onClick());

    expect(titleHeading("t1")).toBeTruthy();
    expect(screen.getByText("1 of 2")).toBeTruthy();
  });

  it("dismisses the toast when the overlay unmounts", () => {
    renderOverlay();
    press("ArrowLeft");
    expect(toastDismiss).not.toHaveBeenCalled();
    cleanup();
    expect(toastDismiss).toHaveBeenCalled();
  });
});

/**
 * The flick (round 3): a verdict no longer advances the queue on the spot.
 * It stages the OUTGOING card mid-animation, blocks every other action
 * (`dispatch`'s own guard), and only swaps to the next card — genuinely
 * interactive, buttons re-enabled — once the timer fires. This replaces
 * round 2's "ghost overlay on an already-interactive next card" design.
 */
describe("the flick transition (round 3)", () => {
  const flickCard = () => dialog().querySelector(".animate-out");

  it("← flicks left — the outgoing card animates, the queue hasn't moved yet", () => {
    renderOverlay();
    press("ArrowLeft");
    const card = flickCard();
    expect(card?.className).toContain("slide-out-to-left");
    expect(card?.textContent).toContain("t1"); // still the OUTGOING card
  });

  it("↑ flicks up, ↓ flicks down, → (confirmed) flicks right", () => {
    renderOverlay();
    press("ArrowUp");
    expect(flickCard()?.className).toContain("slide-out-to-top");
    cleanup();

    renderOverlay();
    press("ArrowDown");
    expect(flickCard()?.className).toContain("slide-out-to-bottom");
    cleanup();

    renderOverlay();
    press("ArrowRight");
    press("Enter");
    expect(flickCard()?.className).toContain("slide-out-to-right");
  });

  it("staging a ramp alone triggers no flick — nothing was decided yet", () => {
    renderOverlay();
    press("ArrowRight");
    expect(flickCard()).toBeNull();
  });

  it("blocks every action until the flick finishes, then unblocks", () => {
    const { verdictSpy } = renderOverlay();
    press("ArrowLeft"); // t1 dropped, flick starts
    expect(verdictSpy).toHaveBeenCalledTimes(1);

    // None of these should do anything while `transitioning` — a second
    // verdict, a step-back, or the date-picker key.
    press("ArrowUp");
    press("Backspace");
    press("d");
    expect(verdictSpy).toHaveBeenCalledTimes(1); // still just the one
    expect(document.querySelector(".rdp-root, [data-slot='calendar']")).toBeNull();

    flushFlick();
    expect(titleHeading("t2")).toBeTruthy();

    // Now that it's clear, the SAME keys work again.
    press("d");
    expect(document.querySelector(".rdp-root, [data-slot='calendar']")).toBeTruthy();
  });

  it("hides and disables the button row for the duration of the flick", () => {
    renderOverlay();
    const wontDo = () => screen.getByRole("button", { name: /won.t do/i }) as HTMLButtonElement;
    expect(wontDo().disabled).toBe(false);

    press("ArrowLeft");
    expect(wontDo().disabled).toBe(true);
    expect(wontDo().closest(".invisible")).toBeTruthy();

    flushFlick();
    expect(wontDo().disabled).toBe(false);
    expect(wontDo().closest(".invisible")).toBeFalsy();
  });

  it("clicking a button mid-flick does nothing — disabled, not just styled that way", () => {
    const { verdictSpy } = renderOverlay();
    press("ArrowLeft");
    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));
    expect(verdictSpy).toHaveBeenCalledTimes(1); // only the original wontDo
  });

  it("under prefers-reduced-motion, the queue advances immediately — no flick, no block", () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal("matchMedia", matchMedia);
    try {
      const { verdictSpy } = renderOverlay();
      press("ArrowLeft");
      // No `flushFlick()` — if this needs one, reduced motion isn't skipping
      // the transition, it's just skipping the animation classes.
      expect(titleHeading("t2")).toBeTruthy();
      expect(flickCard()).toBeNull();
      expect(verdictSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  /**
   * Round 4. The flick used to end on a wall-clock timer started at
   * `dispatch` time — but the CSS animation starts whenever the browser next
   * paints, which measured 31–111ms later depending on how much work the
   * verdict's write and the toast had just queued. The animation was
   * therefore cut off at a different point every time (travel ranged
   * 957–1945px on identical input), which is what read as "sometimes it
   * flies off, sometimes it moves 20px." Ending on the animation's OWN
   * `animationend` is what makes the two impossible to desync.
   */
  describe("ends on animationend, not a clock (round 4)", () => {
    it("animationend advances the queue — without waiting out the fallback", () => {
      renderOverlay();
      press("ArrowLeft");
      expect(titleHeading("t1")).toBeTruthy(); // still mid-flick

      endFlickByAnimation();
      // No timer advanced at all: the animation alone finished the flick.
      expect(titleHeading("t2")).toBeTruthy();
      expect(flickCard()).toBeNull();
    });

    it("the card holds its final position until unmount — fill-mode-forwards", () => {
      renderOverlay();
      press("ArrowLeft");
      // Without this the card snaps back to dead center at full opacity for
      // the frames between animationend and React unmounting it.
      expect(flickCard()?.className).toContain("fill-mode-forwards");
    });

    it("an animation bubbling up from INSIDE the card does not end the flick", () => {
      renderOverlay();
      press("ArrowLeft");
      const inner = flickCard()?.firstElementChild;
      expect(inner).toBeTruthy();

      act(() => {
        fireEvent.animationEnd(inner!);
      });
      // `e.target !== e.currentTarget`, so it was ignored: still flicking.
      expect(titleHeading("t1")).toBeTruthy();
      expect(flickCard()).toBeTruthy();
    });

    it("the fallback timer still completes a flick whose animationend never arrives", () => {
      renderOverlay();
      press("ArrowLeft");
      expect(titleHeading("t1")).toBeTruthy();

      flushFlick(); // no animationend ever fired — jsdom runs no animations
      expect(titleHeading("t2")).toBeTruthy();
    });

    it("animationend then the fallback firing is harmless — the queue advances once", () => {
      const { verdictSpy } = renderOverlay();
      press("ArrowLeft");
      endFlickByAnimation();
      expect(titleHeading("t2")).toBeTruthy();

      // The fallback is cancelled on finish, but even a stray one must not
      // advance a second time (`pendingAdvance` is the idempotency guard).
      flushFlick();
      expect(titleHeading("t2")).toBeTruthy();
      expect(verdictSpy).toHaveBeenCalledTimes(1);
    });
  });
});
