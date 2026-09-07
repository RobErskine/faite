/**
 * The homepage story, one row per beat.
 *
 * Four separate things read this table and they must never disagree: the
 * camera frames the object a beat is about (EI-276), the copy states what the
 * research found (EI-277), the sub-task ticks off in the product panel beside
 * it (EI-278), and the hero board opens with that same list. A beat, an
 * object, a claim and a sub-task are one unit, so they live on one row — the
 * alternative is four parallel arrays kept in step by hand, and the failure
 * mode there is silent: the room shows the shelf while the copy talks about
 * paint.
 *
 * # The sub-tasks are the argument, not set dressing
 *
 * The first draft of this table invented five plausible renovation chores —
 * pick a paint color, measure for the couch, sort the shelf — and they had
 * nothing to do with the studies beside them. That is backwards. Each row's
 * sub-task now DEMONSTRATES its finding: the beat about scheduling carries a
 * task with a date and a time on it, the beat about recurrence carries a
 * genuinely recurring one, and the beat about letting go carries the thing
 * that gets dropped.
 *
 * Read down the `subtask` column and you get one plan for one move. Read
 * across a row and the room, the study and the to-do are all making the same
 * point.
 *
 * # Where the copy comes from
 *
 * `docs/RESEARCH.md`, and nowhere else. Its §2 evidence tables are the only
 * source, §3 maps each Faite feature to the section that argues for it, and
 * §4 lists the claims we deliberately do not make — no Zeigarnik, no 21 days,
 * no 41%, no 42%. Every number below traces to a §2 row.
 *
 * Quotes are NOT reproduced verbatim here. `docs/RESEARCH.md`'s own rule 1
 * allows either an exact quote or a paraphrase with the quotation marks
 * dropped, and these are paraphrases — partly for length, and partly because
 * `src/lib/spelling.test.ts` scans string literals for British spellings and
 * one of the source quotes contains "behaviour". A verbatim quote would be
 * exempt from that rule (`docs/CONTENT.md` §3) but the test cannot know that,
 * so the honest fix is to not put a quotation mark around a paraphrase.
 */

/**
 * What the camera frames for a beat, named rather than positioned.
 *
 * A name, not a vector, because this module is content: it is imported by
 * `page.tsx`, by the hero board, and by an e2e spec, and none of them has any
 * business carrying metres. `room-camera.ts` resolves these to a framing
 * against `room-layout.ts`, which is the one place the room's geometry lives.
 */
export type BeatFocus = "room" | "swatches" | "plant" | "couch" | "shelf" | "tv";

export interface StoryBeat {
  /** The human line, in the product's voice. */
  headline: string;
  /** What it means for the person reading it. */
  body: string;
  /**
   * The finding, in plain language, printed in front of the citation.
   *
   * The point of EI-277: a bare "Masicampo & Baumeister (2011)" is a claim
   * nobody can check and most people will not look up. Saying what the study
   * found, and then who found it, is the whole disclosure.
   */
  claim: string;
  /** The study, named. */
  cite: string;
  /** Which `docs/RESEARCH.md` §2 table this row's evidence comes from. */
  section: string;
  /**
   * This beat's line in the "Plan living room move" card.
   *
   * In order: the reader is `n` beats in, so `n` sub-tasks are done. That
   * identity is what lets `story-ticks.tsx` drive the check-offs from scroll
   * progress alone.
   */
  subtask: string;
  /**
   * A place attached to this beat's sub-task, if it has one.
   *
   * Faite's Location field, shown on the one to-do in the story that is
   * genuinely about going somewhere. `docs/RESEARCH.md` §2.3 is the evidence
   * for the field itself (Smith & Vela on context-dependent memory; Einstein
   * et al. on event cues beating time cues) — but the beat's own citation
   * stays Emmons & King, because a beat can only make one argument at a time.
   * The pin is the product showing itself, not a second claim.
   */
  subtaskLocation?: string;
  /**
   * A recurrence summary, if this beat's sub-task repeats.
   *
   * The card shows Faite's repeat glyph and puts this in its tooltip, exactly
   * as `TitleMarkers` does — rather than spelling the schedule out in the
   * title. A real recurring to-do does not carry "— every Wednesday" in its
   * text; it carries a marker you can interrogate.
   */
  subtaskRepeat?: string;
  /**
   * The days this sub-task lands on as it rolls forward, in order.
   *
   * The Faite Loop in three dates: scheduled, missed and rolled, missed and
   * rolled again — at which point it crosses into Overflow. Only the recurring
   * beat has these, because it is the only to-do in the story that is allowed
   * to not get done for a while.
   */
  subtaskRolls?: string[];
  /** The thing in the room this beat is about (EI-276). */
  focus: BeatFocus;
}

/**
 * How far into a beat's band its sub-task ticks, as a fraction of the band.
 *
 * Shared between `story-ticks.tsx` (which checks the line off) and the scene's
 * beat animations (`components/scene/beat-animations.ts`), because the two are
 * in a strict order: a beat's decisive moment in the room — the wall taking
 * its color, the old TV leaving — must land BEFORE its line ticks, or the card
 * claims something the room has not done yet. A unit test holds each
 * animation's commit point under this number.
 *
 * 0.4 rather than 0.5 for the reason recorded in `story-ticks.tsx`: exactly on
 * the band centre is a knife edge, and a whole-pixel scroll rounding was
 * enough to land either side of it.
 */
export const TICK_AT = 0.4;

export const STORY_BEATS: StoryBeat[] = [
  {
    headline: "You wrote it down. That is most of it.",
    body: "An unfinished task interrupts work that has nothing to do with it. Faite gives it somewhere to go the moment you think of it.",
    claim:
      "Unfinished goals caused intrusive thoughts during unrelated tasks — and letting people write a specific plan eliminated the effect. Not doing the task. Planning it.",
    cite: "Masicampo & Baumeister (2011)",
    section: "§2.1",
    subtask: "Get the whole move out of my head",
    focus: "room",
  },
  {
    headline: "A date and a time. Not just a date.",
    body: "Drag a card onto a day and it has a when. Add a time and it has an appointment.",
    claim:
      "Prompted to write down a date, people did no better than the control group. Prompted to write down a date and a time, vaccination rates rose 4.2 percentage points.",
    cite: "Milkman et al. (2011)",
    section: "§2.3",
    subtask: "Painter comes Saturday, 9:00am",
    focus: "swatches",
  },
  {
    headline: "Miss one. There is no streak to break.",
    body: "Repeating to-dos come back on their own schedule. Faite never counts how many you have kept in a row, because nothing in the evidence says it should.",
    claim:
      "In a twelve-week study of real daily habits, missing a single opportunity did not materially affect how the habit formed.",
    cite: "Lally et al. (2010)",
    section: "§2.5",
    subtask: "Water the plants",
    subtaskRepeat: "Every Wednesday",
    subtaskRolls: ["Wed, Sep 9", "Thu, Sep 10", "Fri, Sep 11"],
    focus: "plant",
  },
  {
    headline: "You were never going to finish on Tuesday.",
    body: "So a missed day rolls forward instead of turning red. Your order was right; only the date was optimistic.",
    claim:
      "Asked for their best guess, students said they would finish in 33.9 days and took 55.5. Fewer than a third finished inside their own most accurate estimate.",
    cite: "Buehler, Griffin & Ross (1994)",
    section: "§2.4",
    subtask: "Measure the room before ordering the couch",
    focus: "couch",
  },
  {
    headline: "The things you keep not doing are the things you keep thinking about.",
    body: "After a few rolls a card moves to Overflow — not to shame it, but because leaving it undecided is the expensive part.",
    claim:
      "People acted least on the goals they felt most torn about, and spent the most time thinking about exactly those.",
    cite: "Emmons & King (1988)",
    section: "§2.4",
    subtask: "Drop books at the donation center",
    subtaskLocation: "Donation Center",
    focus: "shelf",
  },
  {
    headline: "Letting go helps. Sending it back helps twice as much.",
    body: "Every card gets one of three honest endings: you do it, you send it back to its list, or you let it go.",
    claim:
      "Across 31 samples, dropping an unreachable goal was linked to better quality of life (r = 0.08) — and redirecting to a new one more than twice as strongly (r = 0.19).",
    cite: "Barlow, Wrosch & McGrath (2020)",
    section: "§1, §2.8",
    subtask: "Upgrade TV",
    focus: "tv",
  },
];
